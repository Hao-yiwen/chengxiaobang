import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { GitChangesResult, GitFileChange } from "@chengxiaobang/shared";
import { runCommand } from "./shell";

const MAX_UNTRACKED_BYTES = 256 * 1024;

/** runCommand merges stdout/stderr from a login shell, so only well-formed lines count. */
const PORCELAIN_LINE = /^([ MADRCUT?!]{2}) (.+)$/;

/** Disable path escaping so non-ASCII file names come back verbatim. */
const GIT = "git -c core.quotePath=false";

/** Parses `git status --porcelain` output; rename/copy entries yield the new path. */
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

/** Splits a unified diff into per-file blocks keyed by path; pathless blocks (binary) drop. */
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
    // Lines before the first "diff --git" (shell profile noise) are dropped.
  }
  flush();
  return blocks;
}

/** Reads the block's target path from `+++ b/…`, falling back to `--- a/…` for deletions. */
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

/** Strips surrounding quotes git adds for paths with special characters. */
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

/** Untracked files have no diff, so render the whole content as added lines. */
async function readUntrackedDiff(absolutePath: string): Promise<string> {
  try {
    const info = await stat(absolutePath);
    if (!info.isFile() || info.size > MAX_UNTRACKED_BYTES) {
      return "";
    }
    const buffer = await readFile(absolutePath);
    if (looksBinary(buffer)) {
      return "";
    }
    const lines = buffer.toString("utf8").split("\n");
    if (lines.at(-1) === "") {
      lines.pop();
    }
    return lines.map((line) => `+${line}`).join("\n");
  } catch (error) {
    console.warn(`[git-changes] 读取未跟踪文件失败 path=${absolutePath}:`, error);
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

/** 收集项目未提交变更：状态条目 + 每个文件的 unified diff。 */
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
    console.error(
      `[git-changes] git status 失败 exitCode=${status.exitCode} output=${status.output.slice(0, 200)}`
    );
    return { isRepo: true, files: [] };
  }
  const stagedBlocks = splitUnifiedDiff(staged.exitCode === 0 ? staged.output : "");
  const unstagedBlocks = splitUnifiedDiff(unstaged.exitCode === 0 ? unstaged.output : "");
  const files: GitFileChange[] = [];
  for (const entry of parsePorcelainStatus(status.output)) {
    if (entry.status === "??") {
      files.push({ ...entry, diff: await readUntrackedDiff(join(projectPath, entry.path)) });
      continue;
    }
    const diff = [stagedBlocks.get(entry.path), unstagedBlocks.get(entry.path)]
      .filter(Boolean)
      .join("\n");
    files.push({ ...entry, diff });
  }
  return { isRepo: true, files };
}
