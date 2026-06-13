import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { resolve } from "node:path";
import {
  DEFAULT_SHELL_BACKGROUND_AFTER_MS,
  cancelBackgroundShellCommand,
  getBackgroundShellCommand,
  runShellCommand,
  type BackgroundShellCommandSnapshot
} from "./shell";
import { resolveToolPath } from "./workspace";
import { textResult } from "./tool-result";

const shellParams = Type.Object({
  command: Type.String({ description: "要执行的 shell 命令" }),
  cwd: Type.Optional(
    Type.String({ description: "可选，命令工作目录；可为相对当前工作目录的路径或显式绝对路径" })
  ),
  background: Type.Optional(
    Type.Boolean({
      description:
        "预计命令会长时间运行或持续监听时设为 true，工具会立即转入后台并返回输出文件路径"
    })
  )
});

const gitParams = Type.Object({
  path: Type.Optional(
    Type.String({ description: "可选，Git 仓库目录；可为相对当前工作目录的路径或显式绝对路径" })
  )
});

const shellCommandIdParams = Type.Object({
  id: Type.String({ description: "shell 工具返回的后台命令 ID" })
});

export interface ShellToolOptions {
  backgroundAfterMs?: number;
}

interface ShellRunRequestOptions {
  background?: boolean;
}

async function runShell(
  command: string,
  cwd: string,
  workspacePath: string,
  signal?: AbortSignal,
  options: ShellToolOptions = {},
  requestOptions: ShellRunRequestOptions = {}
): Promise<string> {
  const requestedBackground = requestOptions.background === true;
  const backgroundAfterMs = requestedBackground
    ? 0
    : (options.backgroundAfterMs ?? DEFAULT_SHELL_BACKGROUND_AFTER_MS);
  const result = await runShellCommand(command, cwd, {
    signal,
    backgroundAfterMs
  });
  if (result.kind === "background") {
    return renderBackgroundStarted(
      result.command,
      backgroundAfterMs,
      requestedBackground,
      workspacePath
    );
  }
  const { output, exitCode } = result;
  if (exitCode !== 0) {
    throw new Error(output || `命令退出码 ${exitCode}`);
  }
  return output || "（命令无输出）";
}

export function createShellTools(
  workspacePath: string,
  options: ShellToolOptions = {}
): AgentTool<any>[] {
  const shellTool: AgentTool<typeof shellParams> = {
    name: "shell",
    label: "执行命令",
    description: "在工作目录或指定 cwd 中执行一条 shell 命令并返回输出。用于构建、安装依赖、运行脚本等。",
    parameters: shellParams,
    execute: async (_id, params, signal) => {
      const cwd = resolveShellCwd(workspacePath, "shell", params.cwd || ".");
      return textResult(
        await runShell(params.command, cwd, workspacePath, signal, options, {
          background: params.background
        })
      );
    }
  };

  const gitStatus: AgentTool<typeof gitParams> = {
    name: "git_status",
    label: "Git 状态",
    description: "查看工作目录或指定 path 的 git 状态摘要。",
    parameters: gitParams,
    execute: async (_id, params, signal) => {
      const cwd = resolveShellCwd(workspacePath, "git_status", params.path || ".");
      return textResult(
        await runShell("git status --short --branch", cwd, workspacePath, signal, options)
      );
    }
  };

  const gitDiff: AgentTool<typeof gitParams> = {
    name: "git_diff",
    label: "Git 变更",
    description: "查看工作目录或指定 path 的 git 变更摘要与 diff 检查。",
    parameters: gitParams,
    execute: async (_id, params, signal) => {
      const cwd = resolveShellCwd(workspacePath, "git_diff", params.path || ".");
      return textResult(
        await runShell("git diff --stat && git diff --check", cwd, workspacePath, signal, options)
      );
    }
  };

  const shellStatus: AgentTool<typeof shellCommandIdParams> = {
    name: "shell_status",
    label: "命令状态",
    description: "查看一个已转入后台执行的 shell 命令状态和输出文件路径。",
    parameters: shellCommandIdParams,
    execute: async (_id, params) => {
      const snapshot = getBackgroundShellCommand(params.id);
      if (!snapshot) {
        throw new Error(`后台命令不存在或已丢失: ${params.id}`);
      }
      return textResult(renderBackgroundStatus(snapshot, workspacePath));
    }
  };

  const shellCancel: AgentTool<typeof shellCommandIdParams> = {
    name: "shell_cancel",
    label: "终止命令",
    description: "终止一个仍在后台执行的 shell 命令，仅能作用于 shell 工具返回的后台命令 ID。",
    parameters: shellCommandIdParams,
    execute: async (_id, params) => {
      const snapshot = cancelBackgroundShellCommand(params.id);
      if (!snapshot) {
        throw new Error(`后台命令不存在或已丢失: ${params.id}`);
      }
      return textResult(renderBackgroundStatus(snapshot, workspacePath));
    }
  };

  return [shellTool, gitStatus, gitDiff, shellStatus, shellCancel];
}

function renderBackgroundStarted(
  snapshot: BackgroundShellCommandSnapshot,
  backgroundAfterMs: number,
  requestedBackground: boolean,
  workspacePath: string
): string {
  const outputPath = shellOutputPathForRead(snapshot, workspacePath);
  const firstLine = requestedBackground
    ? "命令已按 background=true 请求转入后台继续运行；本次工具调用不会等待它结束。"
    : `命令已执行超过 ${formatDuration(backgroundAfterMs)}，已转入后台继续运行；本次工具调用不会继续等待它结束。`;
  return [
    firstLine,
    `后台命令 ID：${snapshot.id}`,
    `输出文件：${outputPath}`,
    `进程 PID：${snapshot.pid ?? "未知"}`,
    "",
    "完整 stdout/stderr 会持续写入输出文件，不会直接放入本次工具结果。",
    `- 查看输出：调用 read_file，参数为 {"path":"${outputPath}","startLine":1,"lineLimit":200}`,
    `- 查看状态：调用 shell_status，参数为 {"id":"${snapshot.id}"}`,
    `- 如果命令没有进展或不再需要：调用 shell_cancel，参数为 {"id":"${snapshot.id}"}`
  ].join("\n");
}

function renderBackgroundStatus(snapshot: BackgroundShellCommandSnapshot, workspacePath: string): string {
  const outputPath = shellOutputPathForRead(snapshot, workspacePath);
  return [
    `后台命令 ID：${snapshot.id}`,
    `状态：${snapshot.status}`,
    `输出文件：${outputPath}`,
    `进程 PID：${snapshot.pid ?? "未知"}`,
    snapshot.exitCode !== undefined ? `退出码：${snapshot.exitCode}` : undefined,
    snapshot.finishedAt ? `结束时间：${snapshot.finishedAt}` : undefined,
    snapshot.error ? `错误：${snapshot.error}` : undefined,
    "",
    `查看输出：调用 read_file，参数为 {"path":"${outputPath}","startLine":1,"lineLimit":200}`
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

function resolveShellCwd(
  workspacePath: string,
  toolName: "shell" | "git_status" | "git_diff",
  path: string
): string {
  const resolved = resolveToolPath(workspacePath, path);
  if (resolved.outsideWorkspace) {
    console.info("[shell-tools] 工具使用工作目录外 cwd", {
      toolName,
      path,
      cwd: resolved.target
    });
  }
  return resolved.target;
}

function shellOutputPathForRead(
  snapshot: BackgroundShellCommandSnapshot,
  workspacePath: string
): string {
  return resolve(snapshot.cwd) === resolve(workspacePath)
    ? snapshot.relativeOutputPath
    : snapshot.outputPath;
}

function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms} 毫秒`;
  }
  return `${Math.round(ms / 1000)} 秒`;
}
