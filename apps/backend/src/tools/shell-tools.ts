import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { resolve } from "node:path";
import {
  DEFAULT_SHELL_BACKGROUND_AFTER_MS,
  cancelBackgroundShellCommand,
  getBackgroundShellCommand,
  resolvePowerShellCommand,
  runShellCommand,
  type BackgroundShellCommandSnapshot,
  type ResolvedShellCommand
} from "./shell";
import { getLogger } from "../logging/logger";
import { resolveToolPath } from "./workspace";
import { textResult } from "./tool-result";

const SHELL_BLOCKING_DEFAULT_WAIT_MS = 120_000;
const SHELL_BLOCKING_MAX_WAIT_MS = 600_000;
const COMMAND_LOG_MAX_CHARS = 200;
const log = getLogger({ module: "shell-tools" });

type ShellExecutionMode = "async" | "background" | "blocking";

const shellParams = Type.Object({
  action: Type.Union([Type.Literal("run"), Type.Literal("status"), Type.Literal("cancel")], {
    description: "run 执行命令；status 查询后台命令；cancel 终止后台命令"
  }),
  command: Type.Optional(Type.String({ description: "action=run 时要执行的本机命令" })),
  timeout: Type.Optional(
    Type.Number({
      description:
        "前台等待毫秒数。默认短等待 15000ms；测试、构建等较慢命令可用 120000；最大 600000。超过等待窗口后命令转后台继续执行。",
      minimum: 1,
      maximum: SHELL_BLOCKING_MAX_WAIT_MS
    })
  ),
  description: Type.Optional(Type.String({ description: "本次命令的简短说明，仅用于展示和日志" })),
  run_in_background: Type.Optional(
    Type.Boolean({
      description: "true 时立即转入后台执行，适合长驻服务、监听进程或没有明确结束点的命令"
    })
  ),
  dangerouslyDisableSandbox: Type.Optional(
    Type.Boolean({ description: "仅为 schema 对齐保留，不会绕过审批和安全规则" })
  ),
  id: Type.Optional(Type.String({ description: "action=status 或 action=cancel 时的后台命令 ID" }))
});

export interface ShellToolOptions {
  backgroundAfterMs?: number;
  shellOutputDir?: string;
  runId?: string;
  platform?: NodeJS.Platform;
}

interface ShellRunRequestOptions {
  runInBackground?: boolean;
  timeout?: number;
  // 检查类命令(如 git diff --check)非零退出属正常结果,不应抛错;开启后把退出码与输出一并返回。
  allowNonZeroExit?: boolean;
  shell?: ResolvedShellCommand;
  toolName?: "Shell";
}

interface NormalizedShellRunOptions {
  mode: ShellExecutionMode;
  backgroundAfterMs: number;
}

async function runShell(
  command: string,
  cwd: string,
  workspacePath: string,
  signal?: AbortSignal,
  options: ShellToolOptions = {},
  requestOptions: ShellRunRequestOptions = {}
): Promise<string> {
  const normalized = normalizeShellRunOptions(command, cwd, options, requestOptions);
  const toolName = requestOptions.toolName ?? "Shell";
  log.info("准备执行 shell 命令", {
    action: "shell_tool.run",
    toolName,
    mode: normalized.mode,
    timeoutMs: normalized.backgroundAfterMs,
    cwd,
    command: commandForLog(command)
  });
  const result = await runShellCommand(command, cwd, {
    signal,
    backgroundAfterMs: normalized.backgroundAfterMs,
    ...(options.shellOutputDir ? { outputDir: options.shellOutputDir } : {}),
    ...(options.runId ? { scopeId: options.runId } : {}),
    ...(requestOptions.shell ? { shell: requestOptions.shell } : {})
  });
  if (result.kind === "background") {
    return renderBackgroundStarted(result.command, normalized, workspacePath);
  }
  const { output, exitCode } = result;
  if (exitCode !== 0) {
    if (requestOptions.allowNonZeroExit) {
      // 把退出码与输出一并返回给模型分析(例如 git diff --check 发现空白错误时退出码为 1/2)。
      return output
        ? `${output}\n(命令退出码 ${exitCode})`
        : `（命令无输出，退出码 ${exitCode}）`;
    }
    throw new Error(output || `命令退出码 ${exitCode}`);
  }
  return output || "（命令无输出）";
}

export function createShellTools(
  workspacePath: string,
  options: ShellToolOptions = {}
): AgentTool<any>[] {
  const platform = options.platform ?? process.platform;
  const shellTool: AgentTool<typeof shellParams> = {
    name: "Shell",
    label: "执行命令",
    description:
      "执行本机命令并管理后台命令。action=run 在当前工作目录执行 command；后端会按平台自动选择本机命令运行器。默认前台等待 15000ms，未结束会转后台且不会强杀；run_in_background=true 会立即后台；timeout 最长 600000ms。action=status 用 id 查询后台命令；action=cancel 用 id 终止后台命令。",
    parameters: shellParams,
    execute: async (_id, params, signal) => {
      if (params.action === "status") {
        const id = requireBackgroundCommandId(params.id, params.action);
        const snapshot = getBackgroundShellCommand(id);
        if (!snapshot) {
          throw new Error(`后台命令不存在或已丢失: ${id}`);
        }
        return textResult(renderBackgroundStatus(snapshot, workspacePath));
      }
      if (params.action === "cancel") {
        const id = requireBackgroundCommandId(params.id, params.action);
        const snapshot = cancelBackgroundShellCommand(id);
        if (!snapshot) {
          throw new Error(`后台命令不存在或已丢失: ${id}`);
        }
        return textResult(renderBackgroundStatus(snapshot, workspacePath));
      }

      const command = requireShellCommand(params.command);
      if (params.dangerouslyDisableSandbox) {
        log.warn("Shell 收到 dangerouslyDisableSandbox，但不会绕过审批或安全规则", {
          action: "shell_tool.sandbox_flag_ignored",
          toolName: "Shell",
          command: commandForLog(command)
        });
      }
      const cwd = resolveShellCwd(workspacePath, "Shell", ".");
      return textResult(
        await runShell(command, cwd, workspacePath, signal, options, {
          runInBackground: params.run_in_background,
          timeout: params.timeout,
          ...(platform === "win32" ? { shell: resolvePowerShellCommand() } : {}),
          toolName: "Shell"
        })
      );
    }
  };

  return [shellTool];
}

function renderBackgroundStarted(
  snapshot: BackgroundShellCommandSnapshot,
  options: NormalizedShellRunOptions,
  workspacePath: string
): string {
  const outputPath = shellOutputPathForRead(snapshot, workspacePath);
  const firstLine = renderBackgroundStartLine(options);
  return [
    firstLine,
    `后台命令 ID：${snapshot.id}`,
    `输出文件：${outputPath}`,
    `进程 PID：${snapshot.pid ?? "未知"}`,
    "",
    "完整 stdout/stderr 会持续写入输出文件，不会直接放入本次工具结果。",
    `- 查看输出：调用 Read，参数为 ${JSON.stringify({ file_path: outputPath, offset: 1, limit: 200 })}`,
    `- 查看状态：调用 Shell，参数为 {"action":"status","id":"${snapshot.id}"}`,
    `- 如果命令没有进展或不再需要：调用 Shell，参数为 {"action":"cancel","id":"${snapshot.id}"}`
  ].join("\n");
}

function normalizeShellRunOptions(
  command: string,
  cwd: string,
  options: ShellToolOptions,
  requestOptions: ShellRunRequestOptions
): NormalizedShellRunOptions {
  const mode: ShellExecutionMode = requestOptions.runInBackground
    ? "background"
    : requestOptions.timeout !== undefined
      ? "blocking"
      : "async";
  if (!isShellExecutionMode(mode)) {
    log.warn("shell mode 参数非法", {
      action: "shell_tool.invalid_mode",
      command: commandForLog(command)
    });
    throw new Error("shell mode 参数非法，必须是 async、background 或 blocking");
  }

  if (mode === "background") {
    return { mode, backgroundAfterMs: 0 };
  }
  if (mode === "blocking") {
    const timeoutMs = normalizeBlockingWaitMs(
      requestOptions.timeout,
      command,
      cwd,
      requestOptions.toolName ?? "Shell"
    );
    return { mode, backgroundAfterMs: timeoutMs };
  }
  return {
    mode,
    backgroundAfterMs: options.backgroundAfterMs ?? DEFAULT_SHELL_BACKGROUND_AFTER_MS
  };
}

function normalizeBlockingWaitMs(
  timeoutMs: number | undefined,
  command: string,
  cwd: string,
  toolName: "Shell"
): number {
  const value = timeoutMs ?? SHELL_BLOCKING_DEFAULT_WAIT_MS;
  if (!Number.isInteger(value) || value < 1 || value > SHELL_BLOCKING_MAX_WAIT_MS) {
    log.warn("shell timeout 参数非法", {
      action: "shell_tool.invalid_timeout",
      toolName,
      timeout: value,
      maxTimeoutMs: SHELL_BLOCKING_MAX_WAIT_MS,
      cwd,
      command: commandForLog(command)
    });
    throw new Error(
      `${toolName} timeout 必须是 1 到 ${SHELL_BLOCKING_MAX_WAIT_MS} 之间的整数毫秒`
    );
  }
  return value;
}

function isShellExecutionMode(value: unknown): value is ShellExecutionMode {
  return value === "async" || value === "background" || value === "blocking";
}

function renderBackgroundStartLine(options: NormalizedShellRunOptions): string {
  if (options.mode === "background") {
    return "命令已按 run_in_background=true 请求转入后台继续运行；本次工具调用不会等待它结束。";
  }
  if (options.mode === "blocking") {
    return `命令等待超过 timeout=${options.backgroundAfterMs}ms 仍未结束，已转入后台继续运行；本次工具调用不会继续等待它结束。`;
  }
  return `命令已执行超过 ${formatDuration(options.backgroundAfterMs)}，已转入后台继续运行；本次工具调用不会继续等待它结束。`;
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
    `查看输出：调用 Read，参数为 ${JSON.stringify({ file_path: outputPath, offset: 1, limit: 200 })}`
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

function resolveShellCwd(
  workspacePath: string,
  toolName: "Shell",
  path: string
): string {
  const resolved = resolveToolPath(workspacePath, path);
  if (resolved.outsideWorkspace) {
    log.info("工具使用工作目录外 cwd", {
      action: "shell_tool.outside_workspace_cwd",
      toolName,
      path,
      cwd: resolved.target
    });
  }
  return resolved.target;
}

function requireShellCommand(command: unknown): string {
  if (typeof command !== "string" || command.trim().length === 0) {
    throw new Error("Shell action=run 必须提供 command");
  }
  return command;
}

function requireBackgroundCommandId(id: unknown, action: "status" | "cancel"): string {
  if (typeof id !== "string" || id.trim().length === 0) {
    throw new Error(`Shell action=${action} 必须提供后台命令 id`);
  }
  return id;
}

function shellOutputPathForRead(
  snapshot: BackgroundShellCommandSnapshot,
  workspacePath: string
): string {
  if (snapshot.readPath) {
    return snapshot.readPath;
  }
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

function commandForLog(command: string): string {
  return command.length > COMMAND_LOG_MAX_CHARS
    ? `${command.slice(0, COMMAND_LOG_MAX_CHARS)}...`
    : command;
}
