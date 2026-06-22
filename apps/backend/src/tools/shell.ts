import { execFileSync, spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, posix } from "node:path";
import type { TerminalExecResult } from "@chengxiaobang/shared";
import { errorToLogFields, getLogger } from "../logging/logger";

export const DEFAULT_COMMAND_TIMEOUT_MS = 120_000;

/** 命令因超时被终止时使用的约定退出码。 */
export const TIMEOUT_EXIT_CODE = 124;

/** 命令因外部中止被终止时使用的约定退出码。 */
export const ABORT_EXIT_CODE = 130;

const FORCE_KILL_AFTER_MS = 1_000;
const COMMAND_LOG_MAX_CHARS = 200;
const SHELL_CAPTURE_MAX_BYTES = 256 * 1024;
export const DEFAULT_SHELL_BACKGROUND_AFTER_MS = 15_000;
export const SHELL_BACKGROUND_OUTPUT_DIR = ".chengxiaobang/shell-outputs";
const log = getLogger({ module: "shell" });

export interface RunCommandOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface RunShellCommandOptions {
  backgroundAfterMs?: number;
  signal?: AbortSignal;
}

export interface BackgroundShellCommandSnapshot {
  id: string;
  command: string;
  cwd: string;
  outputPath: string;
  relativeOutputPath: string;
  status: "running" | "completed" | "failed" | "aborted";
  startedAt: string;
  updatedAt: string;
  pid?: number;
  exitCode?: number;
  finishedAt?: string;
  error?: string;
}

export type ShellCommandResult =
  | ({ kind: "completed"; outputPath: string; relativeOutputPath: string } & TerminalExecResult)
  | { kind: "background"; command: BackgroundShellCommandSnapshot };

export interface ResolvedShellCommand {
  command: string;
  args: string[];
}

interface BackgroundShellCommandRecord {
  snapshot: BackgroundShellCommandSnapshot;
  child: ChildProcessWithoutNullStreams;
  terminationReason?: "abort" | "cancel";
  forceKillTimer?: ReturnType<typeof setTimeout>;
}

export function resolveShellCommand(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): ResolvedShellCommand {
  if (platform === "win32") {
    return {
      command: env.ComSpec ?? "cmd.exe",
      args: ["/d", "/s", "/c"]
    };
  }
  return {
    command: env.SHELL ?? "/bin/zsh",
    args: ["-lc"]
  };
}

/**
 * 在 `cwd` 中执行 shell 命令，并合并捕获 stdout 与 stderr。
 * 普通非零退出码会作为结果返回，便于调用方自行展示；只有启动失败会 reject。
 * 超时或外部中止会终止整个进程组，避免只杀掉外层 shell 后留下子进程。
 */
export function runCommand(
  command: string,
  cwd: string,
  optionsOrTimeoutMs: RunCommandOptions | number = DEFAULT_COMMAND_TIMEOUT_MS
): Promise<TerminalExecResult> {
  const options = normalizeRunCommandOptions(optionsOrTimeoutMs);
  const timeoutMs = options.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
  if (options.signal?.aborted) {
    log.info("命令启动前已收到中止信号", {
      action: "shell.command_aborted_before_start",
      cwd,
      command: commandForLog(command)
    });
    return Promise.resolve(interruptedResult("abort", ""));
  }

  return new Promise((resolvePromise, reject) => {
    const shell = resolveShellCommand();
    const child = spawn(shell.command, [...shell.args, command], {
      cwd,
      env: process.env,
      detached: process.platform !== "win32"
    });
    const stdout = createOutputCapture();
    const stderr = createOutputCapture();
    let terminationReason: "timeout" | "abort" | undefined;
    let settled = false;
    let forceKillTimer: ReturnType<typeof setTimeout> | undefined;
    let abortListener: (() => void) | undefined;

    const timeout = setTimeout(() => {
      terminateChildProcessGroup(child, "timeout", command, cwd, "SIGTERM");
      terminationReason = terminationReason ?? "timeout";
    }, timeoutMs);

    if (options.signal) {
      abortListener = () => {
        terminateChildProcessGroup(child, "abort", command, cwd, "SIGTERM");
        terminationReason = terminationReason ?? "abort";
      };
      options.signal.addEventListener("abort", abortListener, { once: true });
    }

    const cleanup = () => {
      clearTimeout(timeout);
      if (forceKillTimer) {
        clearTimeout(forceKillTimer);
      }
      if (options.signal && abortListener) {
        options.signal.removeEventListener("abort", abortListener);
      }
    };

    const scheduleForceKill = () => {
      if (forceKillTimer) {
        return;
      }
      forceKillTimer = setTimeout(() => {
        if (settled || !terminationReason) {
          return;
        }
        terminateChildProcessGroup(child, terminationReason, command, cwd, "SIGKILL");
      }, FORCE_KILL_AFTER_MS);
    };

    const terminateChildProcessGroup = (
      target: ChildProcessWithoutNullStreams,
      reason: "timeout" | "abort",
      originalCommand: string,
      workingDirectory: string,
      signal: NodeJS.Signals
    ) => {
      if (!terminationReason) {
        terminationReason = reason;
      }
      log.warn("命令需要终止，准备发送信号", {
        action: "shell.terminate_signal",
        cwd: workingDirectory,
        command: commandForLog(originalCommand),
        pid: target.pid,
        reason,
        signal
      });
      sendSignalToProcessGroup(target, signal, reason);
      if (signal !== "SIGKILL") {
        scheduleForceKill();
      }
    };

    child.stdout.on("data", (chunk) => {
      appendCapturedOutput(stdout, chunk);
    });
    child.stderr.on("data", (chunk) => {
      appendCapturedOutput(stderr, chunk);
    });
    child.on("error", (error) => {
      settled = true;
      cleanup();
      reject(error);
    });
    child.on("close", (code) => {
      settled = true;
      cleanup();
      const { output, truncated } = combineCapturedOutput(stdout, stderr);
      if (terminationReason) {
        resolvePromise(interruptedResult(terminationReason, output, truncated));
        return;
      }
      resolvePromise({ output, exitCode: code ?? -1, ...(truncated ? { truncated } : {}) });
    });

    if (options.signal?.aborted) {
      terminateChildProcessGroup(child, "abort", command, cwd, "SIGTERM");
    }
  });
}

export async function runShellCommand(
  command: string,
  cwd: string,
  options: RunShellCommandOptions = {}
): Promise<ShellCommandResult> {
  const backgroundAfterMs = options.backgroundAfterMs ?? DEFAULT_SHELL_BACKGROUND_AFTER_MS;
  const id = `shell_${randomUUID()}`;
  const relativeOutputPath = posix.join(SHELL_BACKGROUND_OUTPUT_DIR, `${sanitizePathPart(id)}.log`);
  const outputPath = join(cwd, relativeOutputPath);
  await mkdir(join(cwd, SHELL_BACKGROUND_OUTPUT_DIR), { recursive: true });
  await writeFile(outputPath, "", "utf8");

  if (options.signal?.aborted) {
    log.info("命令启动前已收到中止信号", {
      action: "shell.command_aborted_before_start",
      cwd,
      command: commandForLog(command)
    });
    return {
      kind: "completed",
      outputPath,
      relativeOutputPath,
      ...interruptedResult("abort", "")
    };
  }

  return new Promise((resolvePromise, reject) => {
    const startedAt = nowIso();
    const outputStream = createWriteStream(outputPath, { flags: "w" });
    const shell = resolveShellCommand();
    const child = spawn(shell.command, [...shell.args, command], {
      cwd,
      env: process.env,
      detached: process.platform !== "win32"
    });
    const snapshot: BackgroundShellCommandSnapshot = {
      id,
      command,
      cwd,
      outputPath,
      relativeOutputPath,
      status: "running",
      startedAt,
      updatedAt: startedAt,
      ...(child.pid ? { pid: child.pid } : {})
    };
    const record: BackgroundShellCommandRecord = { snapshot, child };
    const stdout = createOutputCapture();
    const stderr = createOutputCapture();
    let releasedToBackground = false;
    let settled = false;
    let abortListener: (() => void) | undefined;

    outputStream.on("error", (error) => {
      const errorText = error instanceof Error ? error.message : String(error);
      snapshot.error = errorText;
      snapshot.updatedAt = nowIso();
      log.error("命令输出文件写入失败", {
        action: "shell.output_write_failed",
        id,
        cwd,
        command: commandForLog(command),
        outputPath,
        ...errorToLogFields(error)
      });
    });

    const backgroundTimer = setTimeout(() => {
      if (settled || record.terminationReason) {
        return;
      }
      releasedToBackground = true;
      backgroundShellCommands.set(id, record);
      cleanupAbortListener();
      log.info("命令超过前台等待阈值，已转入后台继续执行", {
        action: "shell.background_released",
        id,
        cwd,
        command: commandForLog(command),
        pid: child.pid,
        backgroundAfterMs,
        outputPath
      });
      resolvePromise({ kind: "background", command: cloneSnapshot(snapshot) });
    }, backgroundAfterMs);

    const cleanupAbortListener = () => {
      if (options.signal && abortListener) {
        options.signal.removeEventListener("abort", abortListener);
        abortListener = undefined;
      }
    };

    if (options.signal) {
      abortListener = () => {
        if (releasedToBackground) {
          return;
        }
        record.terminationReason = "abort";
        terminateTrackedProcess(record, "abort", command, cwd, "SIGTERM");
      };
      options.signal.addEventListener("abort", abortListener, { once: true });
    }

    child.stdout.on("data", (chunk) => {
      const text = String(chunk);
      appendCapturedOutput(stdout, text);
      outputStream.write(text);
    });
    child.stderr.on("data", (chunk) => {
      const text = String(chunk);
      appendCapturedOutput(stderr, text);
      outputStream.write(text);
    });
    child.on("error", (error) => {
      settled = true;
      clearTimeout(backgroundTimer);
      cleanupAbortListener();
      const errorText = error instanceof Error ? error.message : String(error);
      snapshot.status = record.terminationReason ? "aborted" : "failed";
      snapshot.error = errorText;
      snapshot.updatedAt = nowIso();
      snapshot.finishedAt = snapshot.updatedAt;
      outputStream.end(`\n[程小帮] 命令启动失败：${errorText}\n`);
      if (releasedToBackground) {
        log.error("后台命令启动失败", {
          action: "shell.background_start_failed",
          id,
          cwd,
          command: commandForLog(command),
          ...errorToLogFields(error)
        });
        return;
      }
      reject(error);
    });
    child.on("close", (code) => {
      settled = true;
      clearTimeout(backgroundTimer);
      cleanupAbortListener();
      clearBackgroundForceKill(record);
      const { output, truncated } = combineCapturedOutput(stdout, stderr);
      const at = nowIso();
      snapshot.exitCode = record.terminationReason ? ABORT_EXIT_CODE : (code ?? -1);
      snapshot.status = record.terminationReason
        ? "aborted"
        : snapshot.exitCode === 0
          ? "completed"
          : "failed";
      snapshot.updatedAt = at;
      snapshot.finishedAt = at;
      outputStream.end();
      if (releasedToBackground) {
        log.info("后台命令已结束", {
          action: "shell.background_finished",
          id,
          cwd,
          command: commandForLog(command),
          status: snapshot.status,
          exitCode: snapshot.exitCode,
          outputPath
        });
        return;
      }
      if (record.terminationReason) {
        resolvePromise({
          kind: "completed",
          outputPath,
          relativeOutputPath,
          ...interruptedResult("abort", output, truncated)
        });
        return;
      }
      resolvePromise({
        kind: "completed",
        outputPath,
        relativeOutputPath,
        output,
        exitCode: code ?? -1,
        ...(truncated ? { truncated } : {})
      });
    });

    if (options.signal?.aborted) {
      record.terminationReason = "abort";
      terminateTrackedProcess(record, "abort", command, cwd, "SIGTERM");
    }
  });
}

export function getBackgroundShellCommand(
  id: string
): BackgroundShellCommandSnapshot | undefined {
  const record = backgroundShellCommands.get(id);
  return record ? cloneSnapshot(record.snapshot) : undefined;
}

export function cancelBackgroundShellCommand(
  id: string
): BackgroundShellCommandSnapshot | undefined {
  const record = backgroundShellCommands.get(id);
  if (!record) {
    log.warn("请求终止未知后台命令", { action: "shell.background_cancel_missing", id });
    return undefined;
  }
  if (record.snapshot.status !== "running") {
    log.info("请求终止后台命令，但命令已经结束", {
      action: "shell.background_cancel_already_finished",
      id,
      status: record.snapshot.status,
      exitCode: record.snapshot.exitCode
    });
    return cloneSnapshot(record.snapshot);
  }
  record.terminationReason = "cancel";
  record.snapshot.status = "aborted";
  record.snapshot.updatedAt = nowIso();
  terminateTrackedProcess(record, "cancel", record.snapshot.command, record.snapshot.cwd, "SIGTERM");
  return cloneSnapshot(record.snapshot);
}

function normalizeRunCommandOptions(options: RunCommandOptions | number): RunCommandOptions {
  if (typeof options === "number") {
    return { timeoutMs: options };
  }
  return options;
}

function interruptedResult(
  reason: "timeout" | "abort",
  output: string,
  truncated = false
): TerminalExecResult {
  const message = reason === "timeout" ? "（命令执行超时，已终止）" : "（命令执行已中止）";
  return {
    output: [output, message].filter(Boolean).join("\n"),
    exitCode: reason === "timeout" ? TIMEOUT_EXIT_CODE : ABORT_EXIT_CODE,
    ...(truncated ? { truncated } : {})
  };
}

interface OutputCapture {
  text: string;
  bytes: number;
  truncated: boolean;
}

function createOutputCapture(): OutputCapture {
  return { text: "", bytes: 0, truncated: false };
}

function appendCapturedOutput(capture: OutputCapture, chunk: unknown): void {
  if (capture.truncated) {
    return;
  }
  const text = String(chunk);
  const bytes = Buffer.byteLength(text, "utf8");
  if (capture.bytes + bytes <= SHELL_CAPTURE_MAX_BYTES) {
    capture.text += text;
    capture.bytes += bytes;
    return;
  }
  const remaining = Math.max(0, SHELL_CAPTURE_MAX_BYTES - capture.bytes);
  if (remaining > 0) {
    capture.text += Buffer.from(text).subarray(0, remaining).toString("utf8");
    capture.bytes = SHELL_CAPTURE_MAX_BYTES;
  }
  capture.truncated = true;
  log.warn("前台命令输出超过捕获上限，已截断", {
    action: "shell.output_truncated",
    maxBytes: SHELL_CAPTURE_MAX_BYTES
  });
}

function combineCapturedOutput(
  stdout: OutputCapture,
  stderr: OutputCapture
): { output: string; truncated: boolean } {
  const truncated = stdout.truncated || stderr.truncated;
  const output = [stdout.text.trim(), stderr.text.trim()].filter(Boolean).join("\n");
  return {
    output: [output, truncated ? `（输出已截断，超过 ${formatBytes(SHELL_CAPTURE_MAX_BYTES)} 上限）` : ""]
      .filter(Boolean)
      .join("\n"),
    truncated
  };
}

function formatBytes(bytes: number): string {
  return `${Math.round(bytes / 1024)}KB`;
}

function sendSignalToProcessGroup(
  child: ChildProcessWithoutNullStreams,
  signal: NodeJS.Signals,
  reason: "timeout" | "abort"
): void {
  if (!child.pid) {
    return;
  }
  try {
    if (process.platform === "win32") {
      killWindowsProcessTree(child.pid, signal === "SIGKILL");
      return;
    }
    process.kill(-child.pid, signal);
  } catch (error) {
    const code = error instanceof Error && "code" in error ? String(error.code) : undefined;
    if (code === "ESRCH") {
      return;
    }
    log.warn("进程组信号发送失败，尝试仅终止 shell 进程", {
      action: "shell.group_signal_failed",
      pid: child.pid,
      signal,
      reason,
      ...errorToLogFields(error)
    });
    try {
      child.kill(signal);
    } catch (fallbackError) {
      const fallbackCode =
        fallbackError instanceof Error && "code" in fallbackError
          ? String(fallbackError.code)
          : undefined;
      if (fallbackCode !== "ESRCH") {
        log.warn("shell 进程信号发送也失败", {
          action: "shell.kill_fallback_failed",
          pid: child.pid,
          signal,
          reason,
          ...errorToLogFields(fallbackError)
        });
      }
    }
  }
}

function killWindowsProcessTree(pid: number, force: boolean): void {
  const args = ["/PID", String(pid), "/T"];
  if (force) {
    args.push("/F");
  }
  execFileSync("taskkill", args, {
    stdio: ["ignore", "pipe", "pipe"]
  });
}

const backgroundShellCommands = new Map<string, BackgroundShellCommandRecord>();

function terminateTrackedProcess(
  record: BackgroundShellCommandRecord,
  reason: "abort" | "cancel",
  command: string,
  cwd: string,
  signal: NodeJS.Signals
): void {
  log.warn("准备终止 shell 命令", {
    action: "shell.terminate",
    id: record.snapshot.id,
    cwd,
    command: commandForLog(command),
    pid: record.child.pid,
    reason,
    signal
  });
  sendSignalToProcessGroup(record.child, signal, reason === "cancel" ? "abort" : reason);
  if (signal === "SIGKILL" || record.forceKillTimer) {
    return;
  }
  record.forceKillTimer = setTimeout(() => {
    if (record.child.exitCode !== null) {
      return;
    }
    terminateTrackedProcess(record, reason, command, cwd, "SIGKILL");
  }, FORCE_KILL_AFTER_MS);
}

function clearBackgroundForceKill(record: BackgroundShellCommandRecord): void {
  if (!record.forceKillTimer) {
    return;
  }
  clearTimeout(record.forceKillTimer);
  record.forceKillTimer = undefined;
}

function cloneSnapshot(snapshot: BackgroundShellCommandSnapshot): BackgroundShellCommandSnapshot {
  return { ...snapshot };
}

function nowIso(): string {
  return new Date().toISOString();
}

function sanitizePathPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "unknown";
}

function commandForLog(command: string): string {
  return command.length > COMMAND_LOG_MAX_CHARS
    ? `${command.slice(0, COMMAND_LOG_MAX_CHARS)}...`
    : command;
}
