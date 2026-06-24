import { spawn } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type {
  GitChangeScope,
  GitBranchRef,
  GitCheckoutBranchInput,
  GitCommitInput,
  GitCommitResult,
  GitCreateBranchInput,
  GitEnvironment,
  GitGraphCommit,
  GitGraphRef,
  GitGraphResult,
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
const DEFAULT_GIT_GRAPH_LIMIT = 200;
const MAX_GIT_GRAPH_LIMIT = 500;

/** runCommand 会合并登录 shell 的 stdout/stderr，所以只接收格式完整的行。 */
const PORCELAIN_LINE = /^([ MADRCUT?!]{2}) (.+)$/;

const GIT_BASE_ARGS = ["-c", "core.quotePath=false"];
const GRAPH_FIELD_SEPARATOR = "\x1f";
const GRAPH_RECORD_SEPARATOR = "\x1e";

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

export function runGit(args: string[], cwd: string): Promise<GitCommandResult> {
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

/** 读取右上角 Git 环境卡片需要的完整状态。 */
export async function collectGitEnvironment(projectPath: string): Promise<GitEnvironment> {
  if (!(await detectGitRepository(projectPath))) {
    return emptyGitEnvironment(false);
  }
  const [info, changes, branches, upstream, aheadBehind] = await Promise.all([
    collectGitInfo(projectPath),
    collectGitChanges(projectPath),
    listGitBranches(projectPath),
    currentUpstream(projectPath),
    currentAheadBehind(projectPath)
  ]);
  const uniqueChangedFiles = new Set(changes.files.map((file) => file.path));
  const stagedFiles = new Set(
    changes.files.filter((file) => file.scope === "staged").map((file) => file.path)
  );
  const unstagedFiles = new Set(
    changes.files.filter((file) => file.scope === "unstaged").map((file) => file.path)
  );
  const environment: GitEnvironment = {
    isRepo: true,
    ...(info.branchName ? { branchName: info.branchName } : {}),
    ...(upstream ? { upstream } : {}),
    ahead: aheadBehind.ahead,
    behind: aheadBehind.behind,
    changedFileCount: uniqueChangedFiles.size,
    stagedFileCount: stagedFiles.size,
    unstagedFileCount: unstagedFiles.size,
    additions: changes.files.reduce((total, file) => total + (file.additions ?? 0), 0),
    deletions: changes.files.reduce((total, file) => total + (file.deletions ?? 0), 0),
    branches
  };
  log.info("[git-changes] Git 环境读取完成", {
    projectPath,
    branchName: environment.branchName,
    upstream: environment.upstream,
    ahead: environment.ahead,
    behind: environment.behind,
    changedFileCount: environment.changedFileCount,
    branchCount: environment.branches.length
  });
  return environment;
}

export async function collectGitGraph(
  projectPath: string,
  input: { limit?: number } = {}
): Promise<GitGraphResult> {
  if (!(await detectGitRepository(projectPath))) {
    return { isRepo: false, commits: [] };
  }
  const limit = normalizeGitGraphLimit(input.limit);
  const hasHead = await runGit(["rev-parse", "--verify", "HEAD"], projectPath);
  if (hasHead.exitCode !== 0) {
    log.info("[git-changes] Git 图谱读取完成：仓库暂无提交", { projectPath });
    return { isRepo: true, commits: [] };
  }
  const [info, logResult] = await Promise.all([
    collectGitInfo(projectPath),
    runGit(
      [
        "log",
        "--all",
        "--topo-order",
        "--parents",
        "--decorate=full",
        "--date=iso-strict",
        `--max-count=${limit}`,
        `--format=${GRAPH_FIELD_SEPARATOR}%H${GRAPH_FIELD_SEPARATOR}%P${GRAPH_FIELD_SEPARATOR}%an${GRAPH_FIELD_SEPARATOR}%ad${GRAPH_FIELD_SEPARATOR}%D${GRAPH_FIELD_SEPARATOR}%s${GRAPH_RECORD_SEPARATOR}`
      ],
      projectPath
    )
  ]);
  if (logResult.exitCode !== 0) {
    log.warn("[git-changes] Git 图谱读取失败", {
      projectPath,
      limit,
      exitCode: logResult.exitCode,
      output: logResult.output.slice(0, 400)
    });
    throw new Error(normalizeGitFailure(logResult.output, "读取 Git 图谱失败"));
  }
  const commits = parseGitGraphLog(logResult.output);
  log.info("[git-changes] Git 图谱读取完成", {
    projectPath,
    limit,
    commitCount: commits.length,
    branchName: info.branchName
  });
  return {
    isRepo: true,
    ...(info.branchName ? { head: info.branchName } : {}),
    commits
  };
}

export async function checkoutGitBranch(
  projectPath: string,
  input: GitCheckoutBranchInput
): Promise<{ environment: GitEnvironment }> {
  if (!(await detectGitRepository(projectPath))) {
    throw new Error("当前项目不是 Git 仓库");
  }
  const branches = await listGitBranches(projectPath);
  const target = branches.find(
    (branch) => branch.name === input.branchName && branch.type === input.branchType
  );
  if (!target) {
    throw new Error("分支不存在");
  }
  if (target.current) {
    return { environment: await collectGitEnvironment(projectPath) };
  }
  const args =
    target.type === "remote"
      ? ["switch", "--track", target.name]
      : ["switch", target.name];
  log.info("[git-changes] 开始切换 Git 分支", {
    projectPath,
    branchName: target.name,
    branchType: target.type
  });
  const result = await runGit(args, projectPath);
  if (result.exitCode !== 0) {
    log.warn("[git-changes] Git 分支切换失败", {
      projectPath,
      branchName: target.name,
      branchType: target.type,
      exitCode: result.exitCode,
      output: result.output.slice(0, 400)
    });
    throw new Error(normalizeGitFailure(result.output, "切换分支失败"));
  }
  return { environment: await collectGitEnvironment(projectPath) };
}

export async function createGitBranch(
  projectPath: string,
  input: GitCreateBranchInput
): Promise<{ environment: GitEnvironment }> {
  if (!(await detectGitRepository(projectPath))) {
    throw new Error("当前项目不是 Git 仓库");
  }
  await assertValidBranchName(projectPath, input.branchName);
  log.info("[git-changes] 开始创建并检出 Git 分支", {
    projectPath,
    branchName: input.branchName
  });
  const result = await runGit(["switch", "-c", input.branchName], projectPath);
  if (result.exitCode !== 0) {
    log.warn("[git-changes] 创建 Git 分支失败", {
      projectPath,
      branchName: input.branchName,
      exitCode: result.exitCode,
      output: result.output.slice(0, 400)
    });
    throw new Error(normalizeGitFailure(result.output, "创建分支失败"));
  }
  return { environment: await collectGitEnvironment(projectPath) };
}

export async function commitGitChanges(
  projectPath: string,
  input: GitCommitInput,
  options: {
    generateMessage?: (context: { status: string; diff: string }) => Promise<string | undefined>;
  } = {}
): Promise<GitCommitResult> {
  if (!(await detectGitRepository(projectPath))) {
    throw new Error("当前项目不是 Git 仓库");
  }
  if (input.includeUnstaged) {
    const add = await runGit(["add", "-A"], projectPath);
    if (add.exitCode !== 0) {
      log.warn("[git-changes] 暂存工作区变更失败", {
        projectPath,
        exitCode: add.exitCode,
        output: add.output.slice(0, 400)
      });
      throw new Error(normalizeGitFailure(add.output, "暂存变更失败"));
    }
  }
  const hasChanges = await hasStagedChanges(projectPath);
  if (!hasChanges) {
    throw new Error("没有可提交的暂存变更");
  }
  let message = input.message?.trim() ?? "";
  if (!message) {
    if (!options.generateMessage) {
      throw new Error("缺少提交信息");
    }
    const [status, diff] = await Promise.all([
      runGit(["status", "--short"], projectPath),
      runGit(["diff", "--cached", "--unified=3"], projectPath)
    ]);
    message = normalizeCommitMessage(
      await options.generateMessage({
        status: status.output,
        diff: diff.output
      })
    );
  }
  if (!message) {
    throw new Error("模型没有生成可用的提交信息");
  }
  log.info("[git-changes] 开始提交 Git 变更", {
    projectPath,
    includeUnstaged: input.includeUnstaged,
    messageLength: message.length,
    generatedMessage: !input.message?.trim()
  });
  const commit = await runGit(["commit", "-m", message], projectPath);
  if (commit.exitCode !== 0) {
    log.warn("[git-changes] Git commit 失败", {
      projectPath,
      includeUnstaged: input.includeUnstaged,
      exitCode: commit.exitCode,
      output: commit.output.slice(0, 400)
    });
    throw new Error(normalizeGitFailure(commit.output, "提交失败"));
  }
  const hash = await runGit(["rev-parse", "--short", "HEAD"], projectPath);
  return {
    commitHash: hash.exitCode === 0 ? hash.output.trim() : "HEAD",
    message,
    environment: await collectGitEnvironment(projectPath)
  };
}

export async function pushGitBranch(projectPath: string): Promise<{ environment: GitEnvironment }> {
  if (!(await detectGitRepository(projectPath))) {
    throw new Error("当前项目不是 Git 仓库");
  }
  const info = await collectGitInfo(projectPath);
  if (!info.branchName) {
    throw new Error("当前处于 detached HEAD，无法推送");
  }
  const upstream = await currentUpstream(projectPath);
  const args = upstream ? ["push"] : await pushArgsForNewUpstream(projectPath, info.branchName);
  log.info("[git-changes] 开始推送 Git 分支", {
    projectPath,
    branchName: info.branchName,
    upstream: upstream ?? "origin"
  });
  const result = await runGit(args, projectPath);
  if (result.exitCode !== 0) {
    log.warn("[git-changes] Git push 失败", {
      projectPath,
      branchName: info.branchName,
      exitCode: result.exitCode,
      output: result.output.slice(0, 400)
    });
    throw new Error(normalizeGitFailure(result.output, "推送失败"));
  }
  return { environment: await collectGitEnvironment(projectPath) };
}

function emptyGitEnvironment(isRepo: boolean): GitEnvironment {
  return {
    isRepo,
    ahead: 0,
    behind: 0,
    changedFileCount: 0,
    stagedFileCount: 0,
    unstagedFileCount: 0,
    additions: 0,
    deletions: 0,
    branches: []
  };
}

function normalizeGitGraphLimit(limit: number | undefined): number {
  if (!Number.isInteger(limit)) {
    return DEFAULT_GIT_GRAPH_LIMIT;
  }
  return Math.min(MAX_GIT_GRAPH_LIMIT, Math.max(1, Number(limit)));
}

export function parseGitGraphLog(text: string): GitGraphCommit[] {
  const commits: GitGraphCommit[] = [];
  for (const rawRecord of text.split(GRAPH_RECORD_SEPARATOR)) {
    const record = rawRecord.trim();
    if (!record) {
      continue;
    }
    const fields = record.startsWith(GRAPH_FIELD_SEPARATOR)
      ? record.slice(1).split(GRAPH_FIELD_SEPARATOR)
      : record.split(GRAPH_FIELD_SEPARATOR);
    const [hash, parentText = "", authorName = "", date = "", decorate = "", subject = ""] =
      fields;
    if (!hash) {
      continue;
    }
    commits.push({
      hash,
      shortHash: hash.slice(0, 7),
      parents: parentText.split(/\s+/).filter(Boolean),
      subject,
      authorName,
      date,
      refs: parseGitGraphRefs(decorate)
    });
  }
  return commits;
}

function parseGitGraphRefs(text: string): GitGraphRef[] {
  const refs: GitGraphRef[] = [];
  const seen = new Set<string>();
  const addRef = (ref: GitGraphRef): void => {
    const key = `${ref.type}:${ref.name}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    refs.push(ref);
  };
  for (const rawPart of text.split(",")) {
    const part = rawPart.trim();
    if (!part) {
      continue;
    }
    if (part === "HEAD") {
      addRef({ name: "HEAD", type: "head" });
      continue;
    }
    if (part.startsWith("HEAD -> ")) {
      addRef({ name: "HEAD", type: "head" });
      addDecoratedRef(part.slice("HEAD -> ".length), addRef);
      continue;
    }
    addDecoratedRef(part, addRef);
  }
  return refs;
}

function addDecoratedRef(text: string, addRef: (ref: GitGraphRef) => void): void {
  if (text.startsWith("tag: refs/tags/")) {
    addRef({ name: text.slice("tag: refs/tags/".length), type: "tag" });
    return;
  }
  if (text.startsWith("tag: ")) {
    addRef({ name: text.slice("tag: ".length), type: "tag" });
    return;
  }
  if (text.startsWith("refs/heads/")) {
    addRef({ name: text.slice("refs/heads/".length), type: "local" });
    return;
  }
  if (text.startsWith("refs/remotes/")) {
    addRef({ name: text.slice("refs/remotes/".length), type: "remote" });
    return;
  }
  addRef({ name: text, type: "other" });
}

async function listGitBranches(projectPath: string): Promise<GitBranchRef[]> {
  const current = await collectGitInfo(projectPath);
  const [locals, remotes] = await Promise.all([
    runGit(["for-each-ref", "--format=%(refname:short)%09%(upstream:short)", "refs/heads"], projectPath),
    runGit(["for-each-ref", "--format=%(refname:short)", "refs/remotes"], projectPath)
  ]);
  const branches: GitBranchRef[] = [];
  if (locals.exitCode === 0) {
    for (const line of locals.output.split("\n")) {
      const [name, upstream] = line.split("\t");
      const branchName = name?.trim();
      if (!branchName) {
        continue;
      }
      branches.push({
        name: branchName,
        type: "local",
        current: current.branchName === branchName,
        ...(upstream?.trim() ? { upstream: upstream.trim() } : {})
      });
    }
  } else {
    log.warn("[git-changes] 本地 Git 分支读取失败", {
      projectPath,
      exitCode: locals.exitCode,
      output: locals.output.slice(0, 200)
    });
  }
  const localNames = new Set(branches.map((branch) => branch.name));
  if (remotes.exitCode === 0) {
    for (const line of remotes.output.split("\n")) {
      const branchName = line.trim();
      if (!branchName || branchName.endsWith("/HEAD")) {
        continue;
      }
      const localName = remoteBranchLocalName(branchName);
      branches.push({
        name: branchName,
        type: "remote",
        current: false,
        ...(localName && localNames.has(localName) ? { upstream: localName } : {})
      });
    }
  } else {
    log.warn("[git-changes] 远程 Git 分支读取失败", {
      projectPath,
      exitCode: remotes.exitCode,
      output: remotes.output.slice(0, 200)
    });
  }
  return branches.sort((a, b) => {
    if (a.current !== b.current) {
      return a.current ? -1 : 1;
    }
    if (a.type !== b.type) {
      return a.type === "local" ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });
}

function remoteBranchLocalName(branchName: string): string | undefined {
  const slash = branchName.indexOf("/");
  if (slash === -1 || slash === branchName.length - 1) {
    return undefined;
  }
  return branchName.slice(slash + 1);
}

async function currentUpstream(projectPath: string): Promise<string | undefined> {
  const result = await runGit(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], projectPath);
  return result.exitCode === 0 && result.output.trim() ? result.output.trim() : undefined;
}

async function currentAheadBehind(projectPath: string): Promise<{ ahead: number; behind: number }> {
  const upstream = await currentUpstream(projectPath);
  if (!upstream) {
    return { ahead: 0, behind: 0 };
  }
  const result = await runGit(["rev-list", "--left-right", "--count", "HEAD...@{u}"], projectPath);
  if (result.exitCode !== 0) {
    log.warn("[git-changes] Git ahead/behind 读取失败", {
      projectPath,
      upstream,
      exitCode: result.exitCode,
      output: result.output.slice(0, 200)
    });
    return { ahead: 0, behind: 0 };
  }
  const [aheadRaw, behindRaw] = result.output.trim().split(/\s+/);
  const ahead = Number(aheadRaw);
  const behind = Number(behindRaw);
  return {
    ahead: Number.isFinite(ahead) && ahead > 0 ? ahead : 0,
    behind: Number.isFinite(behind) && behind > 0 ? behind : 0
  };
}

async function assertValidBranchName(projectPath: string, branchName: string): Promise<void> {
  if (branchName.startsWith("-")) {
    throw new Error("分支名不能以 - 开头");
  }
  const result = await runGit(["check-ref-format", "--branch", branchName], projectPath);
  if (result.exitCode !== 0) {
    throw new Error("分支名无效");
  }
}

async function hasStagedChanges(projectPath: string): Promise<boolean> {
  const result = await runGit(["diff", "--cached", "--quiet"], projectPath);
  if (result.exitCode === 0) {
    return false;
  }
  if (result.exitCode === 1) {
    return true;
  }
  log.warn("[git-changes] 检查暂存区变更失败", {
    projectPath,
    exitCode: result.exitCode,
    output: result.output.slice(0, 200)
  });
  throw new Error(normalizeGitFailure(result.output, "检查暂存区失败"));
}

function normalizeCommitMessage(message: string | undefined): string {
  const firstLine = (message ?? "")
    .trim()
    .split("\n")[0]
    ?.replace(/^["'“”‘’`]+/, "")
    .replace(/["'“”‘’`]+$/, "")
    .trim();
  if (!firstLine) {
    return "";
  }
  return firstLine.length > 72 ? firstLine.slice(0, 72).trimEnd() : firstLine;
}

async function pushArgsForNewUpstream(projectPath: string, branchName: string): Promise<string[]> {
  const remotes = await runGit(["remote"], projectPath);
  const hasOrigin =
    remotes.exitCode === 0 && remotes.output.split("\n").some((line) => line.trim() === "origin");
  if (!hasOrigin) {
    throw new Error("当前仓库没有 origin 远程仓库，无法自动设置 upstream");
  }
  return ["push", "-u", "origin", branchName];
}

function normalizeGitFailure(output: string, fallback: string): string {
  const message = output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-4)
    .join("\n")
    .trim();
  return message || fallback;
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
