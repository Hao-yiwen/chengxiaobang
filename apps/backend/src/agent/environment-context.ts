import { arch, release } from "node:os";
import { posix, win32 } from "node:path";
import type { ModelInputModality, TerminalExecResult } from "@chengxiaobang/shared";
import { detectGitRepository, parsePorcelainStatus } from "../tools/git-changes";
import { runCommand } from "../tools/shell";

import { getLogger } from "../logging/logger";

const log = getLogger({ module: "agent/environment-context" });

/** 注入系统提示 `# 环境信息` 段的运行环境快照。 */
export interface EnvironmentContext {
  isGitRepo: boolean;
  shell: string;
  osVersion: string;
  model?: string;
  inputModalities?: ModelInputModality[];
  /** 已渲染好的 Git 状态块;仅在 Git 仓库且要求采集时存在。 */
  gitStatus?: string;
}

/** Git 子命令较快,给一个短超时,避免异常仓库拖住 run 启动。 */
const GIT_COMMAND_TIMEOUT_MS = 5_000;
const MAX_STATUS_ENTRIES = 10;

export function currentShell(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): string {
  const raw = platform === "win32" ? env.ComSpec : env.SHELL;
  if (!raw) {
    return platform === "win32" ? "cmd.exe" : "sh";
  }
  return (platform === "win32" ? win32 : posix).basename(raw);
}

export function osVersionLabel(platform: NodeJS.Platform = process.platform): string {
  return `${platform} ${release()} ${arch()}`;
}

/**
 * 采集环境信息。includeGitStatus 默认 true;上下文用量估算等高频路径可传 false,
 * 只判断是否仓库、跳过较重的 Git 快照采集。任何子步骤失败都降级,绝不阻断 run。
 */
export async function collectEnvironmentContext(input: {
  workspacePath: string;
  model?: string;
  inputModalities?: ModelInputModality[];
  includeGitStatus?: boolean;
}): Promise<EnvironmentContext> {
  const includeGitStatus = input.includeGitStatus ?? true;
  const git = await collectGitContext(input.workspacePath, includeGitStatus);
  return {
    isGitRepo: git.isRepo,
    shell: currentShell(),
    osVersion: osVersionLabel(),
    ...(input.model ? { model: input.model } : {}),
    ...(input.inputModalities ? { inputModalities: input.inputModalities } : {}),
    ...(git.block ? { gitStatus: git.block } : {})
  };
}

async function collectGitContext(
  workspacePath: string,
  includeStatus: boolean
): Promise<{ isRepo: boolean; block?: string }> {
  let isRepo = false;
  try {
    isRepo = await detectGitRepository(workspacePath);
  } catch (error) {
    log.warn("[environment-context] 探测 Git 仓库失败,按非仓库处理", {
      workspacePath,
      error: errorText(error)
    });
    return { isRepo: false };
  }
  if (!isRepo || !includeStatus) {
    return { isRepo };
  }
  try {
    const block = await renderGitStatusBlock(workspacePath);
    return { isRepo, ...(block ? { block } : {}) };
  } catch (error) {
    log.warn("[environment-context] 采集 Git 状态失败,跳过 Git 快照", {
      workspacePath,
      error: errorText(error)
    });
    return { isRepo };
  }
}

async function renderGitStatusBlock(workspacePath: string): Promise<string> {
  const [branch, mainBranch, user, status, log] = await Promise.all([
    runGit("git rev-parse --abbrev-ref HEAD", workspacePath),
    runGit("git symbolic-ref --short refs/remotes/origin/HEAD", workspacePath),
    runGit("git config user.name", workspacePath),
    runGit("git status --porcelain", workspacePath),
    runGit("git log --oneline -5", workspacePath)
  ]);
  const branchName = branch.exitCode === 0 ? lastNonEmptyLine(branch.output) : "";
  const mainBranchName =
    mainBranch.exitCode === 0 ? stripOriginPrefix(lastNonEmptyLine(mainBranch.output)) : "";
  const userName = user.exitCode === 0 ? lastNonEmptyLine(user.output) : "";
  const statusText = status.exitCode === 0 ? renderStatus(status.output) : "（无法读取）";
  const recentCommits = log.exitCode === 0 ? renderRecentCommits(log.output) : "";

  const lines = [
    "这是对话开始时的 Git 状态快照,对话过程中不会更新。",
    "",
    `当前分支: ${branchName || "（未知）"}`,
    `主分支(通常用于提交 PR): ${mainBranchName || "main"}`,
    `Git 用户: ${userName || "（未配置）"}`,
    `状态: ${statusText}`
  ];
  if (recentCommits) {
    lines.push("最近提交:", recentCommits);
  }
  return lines.join("\n");
}

function renderStatus(porcelain: string): string {
  const entries = parsePorcelainStatus(porcelain);
  if (entries.length === 0) {
    return "(clean)";
  }
  const shown = entries.slice(0, MAX_STATUS_ENTRIES).map((entry) => `  ${entry.status} ${entry.path}`);
  const extra = entries.length - MAX_STATUS_ENTRIES;
  return ["", ...shown, ...(extra > 0 ? [`  … 其余 ${extra} 项`] : [])].join("\n");
}

function renderRecentCommits(log: string): string {
  return log
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^[0-9a-f]{7,40}\s/.test(line))
    .slice(0, 5)
    .map((line) => `  ${line}`)
    .join("\n");
}

function runGit(command: string, cwd: string): Promise<TerminalExecResult> {
  return runCommand(command, cwd, { timeoutMs: GIT_COMMAND_TIMEOUT_MS });
}

function lastNonEmptyLine(output: string): string {
  const lines = output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.at(-1) ?? "";
}

function stripOriginPrefix(value: string): string {
  return value.startsWith("origin/") ? value.slice("origin/".length) : value;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
