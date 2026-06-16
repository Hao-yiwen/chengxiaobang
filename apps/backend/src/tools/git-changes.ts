import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { GitChangeScope, GitChangesResult, GitFileChange } from "@chengxiaobang/shared";
import { runCommand } from "./shell";

const MAX_UNTRACKED_BYTES = 256 * 1024;

/** runCommand 会合并登录 shell 的 stdout/stderr，所以只接收格式完整的行。 */
const PORCELAIN_LINE = /^([ MADRCUT?!]{2}) (.+)$/;

/** 关闭路径转义，确保中文等非 ASCII 文件名按原样返回。 */
const GIT = "git -c core.quotePath=false";

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
    console.warn(`[git-changes] 跳过 ${skipped} 行非 porcelain 格式输出`);
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

/** 未跟踪文本文件没有 git diff 块，这里合成完整 unified patch 供前端解析。 */
async function readUntrackedDiff(projectPath: string, relativePath: string): Promise<string> {
  const absolutePath = join(projectPath, relativePath);
  try {
    const info = await stat(absolutePath);
    if (!info.isFile()) {
      console.debug("[git-changes] 未跟踪文件不生成文本 diff", {
        path: relativePath,
        reason: "not_file"
      });
      return "";
    }
    if (info.size > MAX_UNTRACKED_BYTES) {
      console.debug("[git-changes] 未跟踪文件不生成文本 diff", {
        path: relativePath,
        reason: "too_large",
        size: info.size,
        limit: MAX_UNTRACKED_BYTES
      });
      return "";
    }
    const buffer = await readFile(absolutePath);
    if (looksBinary(buffer)) {
      console.debug("[git-changes] 未跟踪文件不生成文本 diff", {
        path: relativePath,
        reason: "binary",
        size: info.size
      });
      return "";
    }
    return createUntrackedFilePatch(relativePath, buffer.toString("utf8"));
  } catch (error) {
    console.warn("[git-changes] 读取未跟踪文件失败", {
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
    console.debug("[git-changes] 项目不是 Git 工作树", { projectPath, exitCode: probe.exitCode });
  }
  return isRepo;
}

function hasScopeChange(status: string, scope: GitChangeScope): boolean {
  if (status === "??") {
    return scope === "unstaged";
  }
  const code = scope === "staged" ? status[0] : status[1];
  return code !== undefined && code !== " " && code !== "?" && code !== "!";
}

function logDiffCommandFailure(
  scope: GitChangeScope,
  result: Awaited<ReturnType<typeof runCommand>>,
  projectPath: string
): void {
  if (result.exitCode === 0) {
    return;
  }
  console.error("[git-changes] git diff 失败", {
    projectPath,
    scope,
    exitCode: result.exitCode,
    output: result.output.slice(0, 200)
  });
}

function createScopedChange(
  entry: { status: string; path: string },
  scope: GitChangeScope,
  blocks: Map<string, string>,
  projectPath: string
): GitFileChange {
  const diff = blocks.get(entry.path) ?? "";
  if (!diff) {
    console.debug("[git-changes] 未找到可展示的 diff 块", {
      projectPath,
      scope,
      path: entry.path,
      status: entry.status
    });
  }
  return {
    path: entry.path,
    scope,
    status: entry.status,
    diff
  };
}

/** 收集项目未提交变更：同一路径会按 staged/unstaged scope 拆成多条记录。 */
export async function collectGitChanges(projectPath: string): Promise<GitChangesResult> {
  if (!(await detectGitRepository(projectPath))) {
    return { isRepo: false, files: [] };
  }
  const [status, unstaged, staged] = await Promise.all([
    runCommand(`${GIT} status --porcelain`, projectPath),
    runCommand(`${GIT} diff`, projectPath),
    runCommand(`${GIT} diff --cached`, projectPath)
  ]);
  if (status.exitCode !== 0) {
    console.error("[git-changes] git status 失败", {
      projectPath,
      exitCode: status.exitCode,
      output: status.output.slice(0, 200)
    });
    return { isRepo: true, files: [] };
  }
  logDiffCommandFailure("unstaged", unstaged, projectPath);
  logDiffCommandFailure("staged", staged, projectPath);
  const stagedBlocks = splitUnifiedDiff(staged.exitCode === 0 ? staged.output : "");
  const unstagedBlocks = splitUnifiedDiff(unstaged.exitCode === 0 ? unstaged.output : "");
  const files: GitFileChange[] = [];
  const entries = parsePorcelainStatus(status.output);
  for (const entry of entries) {
    if (entry.status === "??") {
      files.push({
        ...entry,
        scope: "unstaged",
        diff: await readUntrackedDiff(projectPath, entry.path)
      });
      continue;
    }
    if (hasScopeChange(entry.status, "staged")) {
      files.push(createScopedChange(entry, "staged", stagedBlocks, projectPath));
    }
    if (hasScopeChange(entry.status, "unstaged")) {
      files.push(createScopedChange(entry, "unstaged", unstagedBlocks, projectPath));
    }
  }
  console.info("[git-changes] Git 变更收集完成", {
    projectPath,
    uniqueFileCount: new Set(entries.map((entry) => entry.path)).size,
    stagedCount: files.filter((file) => file.scope === "staged").length,
    unstagedCount: files.filter((file) => file.scope === "unstaged").length
  });
  return { isRepo: true, files };
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
