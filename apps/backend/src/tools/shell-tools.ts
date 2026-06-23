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
  command: Type.String({ description: "要执行的 shell 命令" }),
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
  platform?: NodeJS.Platform;
}

interface ShellRunRequestOptions {
  runInBackground?: boolean;
  timeout?: number;
  // 检查类命令(如 git diff --check)非零退出属正常结果,不应抛错;开启后把退出码与输出一并返回。
  allowNonZeroExit?: boolean;
  shell?: ResolvedShellCommand;
  toolName?: "Bash" | "PowerShell";
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
  const toolName = requestOptions.toolName ?? "Bash";
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
    name: "Bash",
    label: "执行命令",
    description:
      "在工作目录中执行一条 shell 命令并返回输出。用于构建、安装依赖、运行脚本等。默认前台等待 15000ms，未结束会转后台且不会强杀；run_in_background=true 会立即后台；timeout 最长 600000ms。后台命令输出持续写入返回的文件路径，后续可读取输出文件、用 BashStatus 查看是否结束、用 BashCancel 终止。",
    parameters: shellParams,
    execute: async (_id, params, signal) => {
      if (params.dangerouslyDisableSandbox) {
        log.warn("Bash 收到 dangerouslyDisableSandbox，但不会绕过审批或安全规则", {
          action: "shell_tool.sandbox_flag_ignored",
          toolName: "Bash",
          command: commandForLog(params.command)
        });
      }
      const cwd = resolveShellCwd(workspacePath, "Bash", ".");
      return textResult(
        await runShell(params.command, cwd, workspacePath, signal, options, {
          runInBackground: params.run_in_background,
          timeout: params.timeout
        })
      );
    }
  };

  const powerShellTool: AgentTool<typeof shellParams> = {
    name: "PowerShell",
    label: "PowerShell",
    description:
      "在 Windows 原生 PowerShell 中执行一条命令并返回输出。适合 Get-ChildItem、Select-String、Test-Path 等 PowerShell 语法。等待、后台、timeout、输出文件、BashStatus 和 BashCancel 语义与 Bash 相同。",
    parameters: shellParams,
    execute: async (_id, params, signal) => {
      if (params.dangerouslyDisableSandbox) {
        log.warn("PowerShell 收到 dangerouslyDisableSandbox，但不会绕过审批或安全规则", {
          action: "shell_tool.sandbox_flag_ignored",
          toolName: "PowerShell",
          command: commandForLog(params.command)
        });
      }
      const cwd = resolveShellCwd(workspacePath, "PowerShell", ".");
      return textResult(
        await runShell(params.command, cwd, workspacePath, signal, options, {
          runInBackground: params.run_in_background,
          timeout: params.timeout,
          shell: resolvePowerShellCommand(),
          toolName: "PowerShell"
        })
      );
    }
  };

  const gitStatus: AgentTool<typeof gitParams> = {
    name: "GitStatus",
    label: "Git 状态",
    description: "查看工作目录或指定 path 的 git 状态摘要。",
    parameters: gitParams,
    execute: async (_id, params, signal) => {
      const cwd = resolveShellCwd(workspacePath, "GitStatus", params.path || ".");
      return textResult(
        await runShell("git status --short --branch", cwd, workspacePath, signal, options)
      );
    }
  };

  const gitDiff: AgentTool<typeof gitParams> = {
    name: "GitDiff",
    label: "Git 变更",
    description: "查看工作目录或指定 path 的 git 变更摘要与 diff 检查。",
    parameters: gitParams,
    execute: async (_id, params, signal) => {
      const cwd = resolveShellCwd(workspacePath, "GitDiff", params.path || ".");
      return textResult(
        await runShell("git diff --stat && git diff --check", cwd, workspacePath, signal, options, {
          // git diff --check 在仓库存在尾随空格/冲突标记时退出码为 1/2,这是检查结果而非失败。
          allowNonZeroExit: true
        })
      );
    }
  };

  const shellStatus: AgentTool<typeof shellCommandIdParams> = {
    name: "BashStatus",
    label: "命令状态",
    description:
      "查看一个已转入后台执行的 shell 命令状态和输出文件路径。只接受 Bash/PowerShell 返回的后台命令 ID。",
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
    name: "BashCancel",
    label: "终止命令",
    description:
      "终止一个仍在后台执行的 shell 命令，仅能作用于 Bash/PowerShell 返回的后台命令 ID；命令没进展、卡住或不再需要时使用。",
    parameters: shellCommandIdParams,
    execute: async (_id, params) => {
      const snapshot = cancelBackgroundShellCommand(params.id);
      if (!snapshot) {
        throw new Error(`后台命令不存在或已丢失: ${params.id}`);
      }
      return textResult(renderBackgroundStatus(snapshot, workspacePath));
    }
  };

  return [
    shellTool,
    ...(platform === "win32" ? [powerShellTool] : []),
    gitStatus,
    gitDiff,
    shellStatus,
    shellCancel
  ];
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
    `- 查看输出：调用 Read，参数为 {"file_path":"${outputPath}","offset":1,"limit":200}`,
    `- 查看状态：调用 BashStatus，参数为 {"id":"${snapshot.id}"}`,
    `- 如果命令没有进展或不再需要：调用 BashCancel，参数为 {"id":"${snapshot.id}"}`
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
      requestOptions.toolName ?? "Bash"
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
  toolName: "Bash" | "PowerShell"
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
    `查看输出：调用 Read，参数为 {"file_path":"${outputPath}","offset":1,"limit":200}`
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

function resolveShellCwd(
  workspacePath: string,
  toolName: "Bash" | "PowerShell" | "GitStatus" | "GitDiff",
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

function commandForLog(command: string): string {
  return command.length > COMMAND_LOG_MAX_CHARS
    ? `${command.slice(0, COMMAND_LOG_MAX_CHARS)}...`
    : command;
}
