import { spawn } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type {
  GitChangeScope,
  GitChangesResult,
  GitFileChange,
  GitInfo
} from "@chengxiaobang/shared";
import { changeStatsFromPatch } from "./file-change";
import { runCommand } from "./shell";

import { getLogger } from "../logging/logger";

const log = getLogger({ module: "tools/git-changes" });

const MAX_UNTRACKED_BYTES = 256 * 1024;
const GIT_CAPTURE_MAX_BYTES = 4 * 1024 * 1024;

/** runCommand 会合并登录 shell 的 stdout/stderr，所以只接收格式完整的行。 */
const PORCELAIN_LINE = /^([ MADRCUT?!]{2}) (.+)$/;

const GIT_BASE_ARGS = ["-c", "core.quotePath=false"];

/** 解析 `git status --porcelain` 输出；重命名/复制条目取新路径。 */
export function parsePorcelainStatus(text: string): Array<{ status: string; path: string }> {
  const entries: Array<{ status: string; path: string }> = [];
  let skipped = 0;
  for (const line of text.split("\n")) {
    if (line.trim().length === 0) {
      continue;
    }
    const match = PORCELAIN_LINE.exec(line);
    if (!match) {
      skipped += 1;
      continue;
    }
    const status = match[1];
    let path = match[2];
    const arrow = path.indexOf(" -> ");
    if (arrow !== -1 && (status.includes("R") || status.includes("C"))) {
      path = path.slice(arrow + 4);
    }
    entries.push({ status, path: unquoteGitPath(path) });
  }
  if (skipped > 0) {
    log.warn(`[git-changes] 跳过 ${skipped} 行非 porcelain 格式输出`);
  }
  return entries;
}

/** 将 unified diff 按文件拆块；无法定位路径的块（通常是二进制）直接丢弃。 */
export function splitUnifiedDiff(text: string): Map<string, string> {
  const blocks = new Map<string, string>();
  let blockLines: string[] = [];
  const flush = (): void => {
    if (blockLines.length === 0) {
      return;
    }
    const path = diffBlockPath(blockLines);
    if (path) {
      blocks.set(path, blockLines.join("\n"));
    }
    blockLines = [];
  };
  for (const line of text.split("\n")) {
    if (line.startsWith("diff --git ")) {
      flush();
      blockLines = [line];
    } else if (blockLines.length > 0) {
      blockLines.push(line);
    }
    // 第一个 "diff --git" 之前可能是 shell profile 噪音，直接忽略。
  }
  flush();
  return blocks;
}

/** 从 `+++ b/…` 读取目标路径；删除文件则退回 `--- a/…`。 */
function diffBlockPath(lines: string[]): string | undefined {
  const target = lines.find((line) => line.startsWith("+++ "))?.slice(4).trim();
  if (target && target !== "/dev/null") {
    return stripDiffPrefix(unquoteGitPath(target), "b/");
  }
  const source = lines.find((line) => line.startsWith("--- "))?.slice(4).trim();
  if (source && source !== "/dev/null") {
    return stripDiffPrefix(unquoteGitPath(source), "a/");
  }
  return undefined;
}

function stripDiffPrefix(path: string, prefix: string): string {
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

/** 去掉 git 对特殊路径添加的外层引号。 */
function unquoteGitPath(path: string): string {
  if (path.length >= 2 && path.startsWith('"') && path.endsWith('"')) {
    return path.slice(1, -1).replace(/\\(["\\tn])/g, (_, char: string) =>
      char === "t" ? "\t" : char === "n" ? "\n" : char
    );
  }
  return path;
}

function looksBinary(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, 8192);
  for (const byte of sample) {
    if (byte === 0) {
      return true;
    }
  }
  return false;
}

interface GitCommandResult {
  output: string;
  exitCode: number;
  truncated?: boolean;
}

function runGit(args: string[], cwd: string): Promise<GitCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", [...GIT_BASE_ARGS, ...args], {
      cwd,
      env: process.env
    });
    const chunks: Buffer[] = [];
    let bytes = 0;
    let truncated = false;
    const append = (chunk: Buffer) => {
      if (truncated) {
        return;
      }
      const remaining = GIT_CAPTURE_MAX_BYTES - bytes;
      if (chunk.byteLength <= remaining) {
        chunks.push(chunk);
        bytes += chunk.byteLength;
        return;
      }
      if (remaining > 0) {
        chunks.push(chunk.subarray(0, remaining));
        bytes = GIT_CAPTURE_MAX_BYTES;
      }
      truncated = true;
      log.warn("[git-changes] git 命令输出超过单文件捕获上限，已截断", {
        cwd,
        args: safeGitArgsForLog(args),
        maxBytes: GIT_CAPTURE_MAX_BYTES
      });
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({
        output: Buffer.concat(chunks).toString("utf8"),
        exitCode: code ?? -1,
        ...(truncated ? { truncated } : {})
      });
    });
  });
}

function safeGitArgsForLog(args: string[]): string[] {
  return args.map((arg) => (arg.length > 160 ? `${arg.slice(0, 160)}...` : arg));
}

/** 未跟踪文本文件没有 git diff 块，这里合成完整 unified patch 供前端解析。 */
async function readUntrackedDiff(projectPath: string, relativePath: string): Promise<string> {
  const absolutePath = join(projectPath, relativePath);
  try {
    const info = await stat(absolutePath);
    if (!info.isFile()) {
      log.debug("[git-changes] 未跟踪文件不生成文本 diff", {
        path: relativePath,
        reason: "not_file"
      });
      return "";
    }
    if (info.size > MAX_UNTRACKED_BYTES) {
      log.debug("[git-changes] 未跟踪文件不生成文本 diff", {
        path: relativePath,
        reason: "too_large",
        size: info.size,
        limit: MAX_UNTRACKED_BYTES
      });
      return "";
    }
    const buffer = await readFile(absolutePath);
    if (looksBinary(buffer)) {
      log.debug("[git-changes] 未跟踪文件不生成文本 diff", {
        path: relativePath,
        reason: "binary",
        size: info.size
      });
      return "";
    }
    return createUntrackedFilePatch(relativePath, buffer.toString("utf8"));
  } catch (error) {
    log.warn("[git-changes] 读取未跟踪文件失败", {
      path: relativePath,
      absolutePath,
      error: error instanceof Error ? error.message : String(error)
    });
    return "";
  }
}

/** 轻量判断项目是否位于 Git 工作树内，供菜单显隐等快速路径使用。 */
export async function detectGitRepository(projectPath: string): Promise<boolean> {
  const probe = await runCommand("git rev-parse --is-inside-work-tree", projectPath);
  const isRepo =
    probe.exitCode === 0 && probe.output.split("\n").some((line) => line.trim() === "true");
  if (!isRepo) {
    log.debug("[git-changes] 项目不是 Git 工作树", { projectPath, exitCode: probe.exitCode });
  }
  return isRepo;
}

/** 读取项目的轻量 Git 信息，供前端菜单与侧边栏提示使用。 */
export async function collectGitInfo(projectPath: string): Promise<GitInfo> {
  if (!(await detectGitRepository(projectPath))) {
    return { isRepo: false };
  }
  try {
    const branch = await runGit(["symbolic-ref", "--quiet", "--short", "HEAD"], projectPath);
    const branchName = branch.exitCode === 0 ? branch.output.trim() : "";
    if (!branchName) {
      log.debug("[git-changes] 未读取到当前分支名", {
        projectPath,
        exitCode: branch.exitCode
      });
      return { isRepo: true };
    }
    return { isRepo: true, branchName };
  } catch (error) {
    log.warn("[git-changes] 读取当前分支名失败", {
      projectPath,
      error: error instanceof Error ? error.message : String(error)
    });
    return { isRepo: true };
  }
}

function hasScopeChange(status: string, scope: GitChangeScope): boolean {
  if (status === "??") {
    return scope === "unstaged";
  }
  const code = scope === "staged" ? status[0] : status[1];
  return code !== undefined && code !== " " && code !== "?" && code !== "!";
}

function logGitCommandFailure(
  scope: GitChangeScope,
  result: GitCommandResult,
  projectPath: string
): void {
  if (result.exitCode === 0) {
    return;
  }
  log.error("[git-changes] git diff 失败", {
    projectPath,
    scope,
    exitCode: result.exitCode,
    output: result.output.slice(0, 200)
  });
}

function createScopedChangeSummary(
  entry: { status: string; path: string },
  scope: GitChangeScope,
  statsByPath: Map<string, GitChangeStats>
): GitFileChange {
  return {
    path: entry.path,
    scope,
    status: entry.status,
    diff: "",
    ...statsByPath.get(entry.path)
  };
}

/** 收集项目未提交变更：同一路径会按 staged/unstaged scope 拆成多条记录。 */
export async function collectGitChanges(projectPath: string): Promise<GitChangesResult> {
  if (!(await detectGitRepository(projectPath))) {
    return { isRepo: false, files: [] };
  }
  const [status, unstagedStats, stagedStats] = await Promise.all([
    runGit(["status", "--porcelain"], projectPath),
    runGit(["diff", "--numstat"], projectPath),
    runGit(["diff", "--cached", "--numstat"], projectPath)
  ]);
  if (status.exitCode !== 0) {
    log.error("[git-changes] git status 失败", {
      projectPath,
      exitCode: status.exitCode,
      output: status.output.slice(0, 200)
    });
    return { isRepo: true, files: [] };
  }
  logGitCommandFailure("unstaged", unstagedStats, projectPath);
  logGitCommandFailure("staged", stagedStats, projectPath);
  const stagedStatsByPath = parseGitNumstat(stagedStats.exitCode === 0 ? stagedStats.output : "");
  const unstagedStatsByPath = parseGitNumstat(
    unstagedStats.exitCode === 0 ? unstagedStats.output : ""
  );
  const files: GitFileChange[] = [];
  const entries = parsePorcelainStatus(status.output);
  for (const entry of entries) {
    if (entry.status === "??") {
      files.push({
        ...entry,
        scope: "unstaged",
        diff: ""
      });
      continue;
    }
    if (hasScopeChange(entry.status, "staged")) {
      files.push(createScopedChangeSummary(entry, "staged", stagedStatsByPath));
    }
    if (hasScopeChange(entry.status, "unstaged")) {
      files.push(createScopedChangeSummary(entry, "unstaged", unstagedStatsByPath));
    }
  }
  log.info("[git-changes] Git 变更收集完成", {
    projectPath,
    mode: "summary",
    uniqueFileCount: new Set(entries.map((entry) => entry.path)).size,
    stagedCount: files.filter((file) => file.scope === "staged").length,
    unstagedCount: files.filter((file) => file.scope === "unstaged").length,
    additions: files.reduce((total, file) => total + (file.additions ?? 0), 0),
    deletions: files.reduce((total, file) => total + (file.deletions ?? 0), 0)
  });
  return { isRepo: true, files };
}

export async function collectGitFileDiff(
  projectPath: string,
  input: { scope: GitChangeScope; path: string }
): Promise<GitFileChange | undefined> {
  if (!(await detectGitRepository(projectPath))) {
    return undefined;
  }
  const status = await runGit(["status", "--porcelain"], projectPath);
  if (status.exitCode !== 0) {
    log.error("[git-changes] git status 失败", {
      projectPath,
      exitCode: status.exitCode,
      output: status.output.slice(0, 200)
    });
    return undefined;
  }
  const entry = parsePorcelainStatus(status.output).find(
    (item) => item.path === input.path && hasScopeChange(item.status, input.scope)
  );
  if (!entry) {
    log.warn("[git-changes] 单文件 diff 请求未匹配到变更", {
      projectPath,
      path: input.path,
      scope: input.scope
    });
    return undefined;
  }

  let diff = "";
  let reason: string | undefined;
  if (entry.status === "??") {
    diff = await readUntrackedDiff(projectPath, input.path);
    if (!diff) {
      reason = "untracked_no_text_diff";
    }
  } else {
    const args =
      input.scope === "staged"
        ? ["diff", "--cached", "--", input.path]
        : ["diff", "--", input.path];
    const result = await runGit(args, projectPath);
    if (result.exitCode !== 0) {
      log.error("[git-changes] 单文件 git diff 失败", {
        projectPath,
        path: input.path,
        scope: input.scope,
        exitCode: result.exitCode,
        output: result.output.slice(0, 200)
      });
      throw new Error("git diff 失败");
    }
    diff = splitUnifiedDiff(result.output).get(input.path) ?? "";
    if (!diff) {
      reason = result.truncated ? "truncated" : "no_text_diff";
    }
  }

  const file: GitFileChange = {
    path: input.path,
    scope: input.scope,
    status: entry.status,
    diff,
    ...statsFromTextDiff(diff)
  };
  log.info("[git-changes] 单文件 Git diff 收集完成", {
    projectPath,
    path: input.path,
    scope: input.scope,
    status: entry.status,
    additions: file.additions,
    deletions: file.deletions,
    emptyDiff: diff.length === 0,
    reason
  });
  return file;
}

function statsFromTextDiff(diff: string): Pick<GitFileChange, "additions" | "deletions"> {
  if (!diff) {
    return {};
  }
  const stats = changeStatsFromPatch(diff);
  if (stats.additions === 0 && stats.deletions === 0) {
    return {};
  }
  return stats;
}

type GitChangeStats = { additions: number; deletions: number };

function parseGitNumstat(text: string): Map<string, GitChangeStats> {
  const stats = new Map<string, GitChangeStats>();
  for (const line of text.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    const [added, deleted, ...pathParts] = line.split("\t");
    const path = pathParts.join("\t");
    if (!path || added === "-" || deleted === "-") {
      continue;
    }
    const additions = Number(added);
    const deletions = Number(deleted);
    if (!Number.isFinite(additions) || !Number.isFinite(deletions)) {
      continue;
    }
    stats.set(unquoteGitPath(path), { additions, deletions });
  }
  return stats;
}

function createUntrackedFilePatch(relativePath: string, content: string): string {
  const lines = content.split("\n");
  if (lines.at(-1) === "") {
    lines.pop();
  }
  const header = [
    `diff --git a/${relativePath} b/${relativePath}`,
    "new file mode 100644",
    "--- /dev/null",
    `+++ b/${relativePath}`
  ];
  if (lines.length === 0) {
    return `${header.join("\n")}\n`;
  }
  return `${[
    ...header,
    `@@ -0,0 +1,${lines.length} @@`,
    ...lines.map((line) => `+${line}`)
  ].join("\n")}\n`;
}
