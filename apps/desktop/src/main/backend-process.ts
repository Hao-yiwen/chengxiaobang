import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import {
  type LogWriter,
  type TerminalLogWriter,
  writeStructuredLog,
  writeTerminalLog
} from "./logging";

export interface BackendInfo {
  baseURL: string;
  token: string;
}

export interface BackendProcess {
  info: BackendInfo;
  child: ChildProcess;
  stop(): void;
}

export interface BackendCommand {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}

export type BackendLogStream = "stdout" | "stderr";

export interface BackendLogContext {
  logger?: LogWriter;
  terminal?: TerminalLogWriter;
  port?: number;
  pid?: number;
}

export interface BackendStartupDiagnostics {
  command: BackendCommand;
  port: number;
  dataDir: string;
  timeoutMs: number;
  stdout: string[];
  stderr: string[];
  lastHealthStatus?: string;
  lastHealthError?: string;
  spawnError?: string;
}

const DEFAULT_BACKEND_START_TIMEOUT_MS = 45_000;
const BACKEND_HEALTH_CHECK_TIMEOUT_MS = 1_500;
const BACKEND_HEALTH_CHECK_INTERVAL_MS = 200;
const BACKEND_OUTPUT_TAIL_LINES = 30;

export function resolveBackendCommand(options: {
  port: number;
  dataDir: string;
  token: string;
  resourcesPath: string;
  isPackaged: boolean;
}): BackendCommand {
  const backendEntry = options.isPackaged
    ? join(options.resourcesPath, "backend", "main.js")
    : resolve(projectRoot(), "apps/backend/src/main.ts");
  const commonArgs = [
    backendEntry,
    "--port",
    String(options.port),
    "--data-dir",
    options.dataDir,
    "--token",
    options.token
  ];
  const env = { ...process.env };
  const root = projectRoot();
  const bundledBun = join(options.resourcesPath, "bun");
  const devBun = join(root, "node_modules", "bun", "bin", "bun.exe");
  const devBunShim = resolve(root, "node_modules/.bin/bun");
  const bunBinary = process.env.BUN_BINARY ?? (options.isPackaged
    ? firstExisting([bundledBun])
    : firstExisting([devBun, devBunShim]));

  // 开发模式用 Bun watch 自动重启后端，避免每次改后端都重启 Electron。
  const dev = !options.isPackaged;

  if (!bunBinary) {
    throw new Error(
      options.isPackaged
        ? `后端运行时缺失：未找到 Bun binary（${bundledBun}）`
        : `后端运行时缺失：未找到 Bun binary，请先运行 pnpm install 或设置 BUN_BINARY（${devBun}）`
    );
  }

  const args = dev ? ["--no-orphans", "--watch", ...commonArgs] : commonArgs;
  return { command: bunBinary, args, env };
}

export async function startBackendProcess(options: {
  dataDir: string;
  resourcesPath: string;
  isPackaged: boolean;
  logger?: LogWriter;
}): Promise<BackendProcess> {
  const port = 30_000 + Math.floor(Math.random() * 20_000);
  const token = randomBytes(24).toString("hex");
  const command = resolveBackendCommand({
    port,
    dataDir: options.dataDir,
    token,
    resourcesPath: options.resourcesPath,
    isPackaged: options.isPackaged
  });
  const diagnostics = createBackendStartupDiagnostics({
    command,
    port,
    dataDir: options.dataDir,
    timeoutMs: resolveBackendStartTimeoutMs()
  });
  console.info(
    `[main] 启动后端 port=${port} dataDir=${options.dataDir} watch=${command.args.includes("--watch")} timeout=${diagnostics.timeoutMs}ms command=${command.command}`
  );
  const child = spawn(command.command, command.args, {
    env: command.env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32"
  });

  child.on("error", (error) => {
    diagnostics.spawnError = messageFromError(error);
  });

  child.stdout.on("data", (chunk) => {
    appendBackendStartupOutput(diagnostics, "stdout", chunk);
    logBackendChunk("stdout", chunk, {
      logger: options.logger,
      port,
      pid: child.pid
    });
  });

  child.stderr.on("data", (chunk) => {
    appendBackendStartupOutput(diagnostics, "stderr", chunk);
    logBackendChunk("stderr", chunk, {
      logger: options.logger,
      port,
      pid: child.pid
    });
  });

  await waitForBackend(child, port, token, diagnostics);
  console.info(`[main] 后端启动完成 port=${port}`);
  return {
    info: { baseURL: `http://127.0.0.1:${port}`, token },
    child,
    stop: () => stopBackendChild(child)
  };
}

async function waitForBackend(
  child: ChildProcess,
  port: number,
  token: string,
  diagnostics: BackendStartupDiagnostics
): Promise<void> {
  const deadline = Date.now() + diagnostics.timeoutMs;
  while (Date.now() < deadline) {
    if (diagnostics.spawnError) {
      throw new Error(formatBackendStartupFailure("后端进程启动失败", diagnostics, child));
    }
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        formatBackendStartupFailure(
          child.signalCode
            ? `后端启动失败，信号 ${child.signalCode}`
            : `后端启动失败，退出码 ${child.exitCode}`,
          diagnostics,
          child
        )
      );
    }
    try {
      const response = await fetchWithTimeout(`http://127.0.0.1:${port}/api/health`, {
        headers: { "x-chengxiaobang-token": token }
      });
      if (response.ok) {
        return;
      }
      diagnostics.lastHealthStatus = await healthStatusMessage(response);
    } catch (error) {
      diagnostics.lastHealthError = messageFromError(error);
    }
    await new Promise((resolvePromise) =>
      setTimeout(resolvePromise, BACKEND_HEALTH_CHECK_INTERVAL_MS)
    );
  }
  const errorMessage = formatBackendStartupFailure("后端启动超时", diagnostics, child);
  console.error(
    `[main] 后端启动超时 port=${port} pid=${child.pid ?? "unknown"} timeout=${diagnostics.timeoutMs}ms，开始清理进程组\n${errorMessage}`
  );
  stopBackendChild(child);
  await once(child, "exit").catch(() => undefined);
  throw new Error(errorMessage);
}

function projectRoot(): string {
  // 从当前文件向上寻找 monorepo 根目录；dev 与 dist/main 打包后路径都覆盖。
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
}

function firstExisting(paths: string[]): string | undefined {
  return paths.find((path) => existsSync(path));
}

export function resolveBackendStartTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.CHENGXIAOBANG_BACKEND_START_TIMEOUT_MS;
  if (!raw) {
    return DEFAULT_BACKEND_START_TIMEOUT_MS;
  }
  const timeoutMs = Number(raw);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1_000) {
    console.warn(
      `[main] 忽略无效后端启动超时配置 CHENGXIAOBANG_BACKEND_START_TIMEOUT_MS=${raw}`
    );
    return DEFAULT_BACKEND_START_TIMEOUT_MS;
  }
  return timeoutMs;
}

export function createBackendStartupDiagnostics(options: {
  command: BackendCommand;
  port: number;
  dataDir: string;
  timeoutMs: number;
}): BackendStartupDiagnostics {
  return {
    command: options.command,
    port: options.port,
    dataDir: options.dataDir,
    timeoutMs: options.timeoutMs,
    stdout: [],
    stderr: []
  };
}

export function appendBackendStartupOutput(
  diagnostics: BackendStartupDiagnostics,
  stream: BackendLogStream,
  chunk: Buffer | string
): void {
  const lines = splitBackendLogLines(chunk);
  diagnostics[stream].push(...lines);
  if (diagnostics[stream].length > BACKEND_OUTPUT_TAIL_LINES) {
    diagnostics[stream].splice(0, diagnostics[stream].length - BACKEND_OUTPUT_TAIL_LINES);
  }
}

export function formatBackendStartupFailure(
  reason: string,
  diagnostics: BackendStartupDiagnostics,
  child?: Pick<ChildProcess, "pid" | "exitCode" | "signalCode">
): string {
  const lines = [
    `${reason}（port=${diagnostics.port}, pid=${child?.pid ?? "unknown"}, timeout=${diagnostics.timeoutMs}ms）`,
    `command=${diagnostics.command.command} ${diagnostics.command.args.join(" ")}`,
    `dataDir=${diagnostics.dataDir}`,
    "可通过 CHENGXIAOBANG_BACKEND_START_TIMEOUT_MS=60000 临时调大启动等待时间"
  ];

  if (diagnostics.spawnError) {
    lines.push(`spawnError=${diagnostics.spawnError}`);
  }
  if (child?.exitCode !== null && child?.exitCode !== undefined) {
    lines.push(`exitCode=${child.exitCode}`);
  }
  if (child?.signalCode) {
    lines.push(`signalCode=${child.signalCode}`);
  }
  if (diagnostics.lastHealthStatus) {
    lines.push(`lastHealthStatus=${diagnostics.lastHealthStatus}`);
  }
  if (diagnostics.lastHealthError) {
    lines.push(`lastHealthError=${diagnostics.lastHealthError}`);
  }
  if (diagnostics.stderr.length > 0) {
    lines.push(`backend stderr tail:\n${formatOutputTail(diagnostics.stderr)}`);
  }
  if (diagnostics.stdout.length > 0) {
    lines.push(`backend stdout tail:\n${formatOutputTail(diagnostics.stdout)}`);
  }
  return lines.join("\n");
}

export function logBackendChunk(
  stream: BackendLogStream,
  chunk: Buffer | string,
  context: BackendLogContext = {}
): void {
  for (const line of splitBackendLogLines(chunk)) {
    const level = stream === "stderr" ? "warn" : "info";
    writeStructuredLog(
      context.logger,
      level,
      {
        stream,
        port: context.port,
        pid: context.pid
      },
      line
    );
    if (context.terminal) {
      context.terminal[level](`[chengxiaobang-backend] ${line}`);
    } else {
      writeTerminalLog(level, `[chengxiaobang-backend] ${line}`);
    }
  }
}

async function fetchWithTimeout(url: string, options: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BACKEND_HEALTH_CHECK_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function healthStatusMessage(response: Response): Promise<string> {
  const body = await response.text().catch(() => "");
  const trimmedBody = body.trim();
  return trimmedBody
    ? `${response.status} ${response.statusText} body=${trimmedBody.slice(0, 500)}`
    : `${response.status} ${response.statusText}`;
}

function splitBackendLogLines(chunk: Buffer | string): string[] {
  const message = String(chunk).trim();
  return message ? message.split(/\r?\n/) : [];
}

function formatOutputTail(lines: string[]): string {
  return lines.map((line) => `  ${line}`).join("\n");
}

function messageFromError(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as Error & { cause?: unknown }).cause;
    if (cause) {
      return `${error.message}: ${messageFromError(cause)}`;
    }
    return error.message;
  }
  if (error && typeof error === "object") {
    const code = "code" in error ? String(error.code) : "";
    const message = "message" in error ? String(error.message) : "";
    return [code, message].filter(Boolean).join(" ") || String(error);
  }
  return String(error);
}

function stopBackendChild(child: ChildProcess): void {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  if (process.platform !== "win32" && child.pid) {
    try {
      process.kill(-child.pid, "SIGTERM");
      console.info(`[main] 已请求停止后端进程组 pid=${child.pid}`);
      return;
    } catch (error) {
      console.warn("[main] 停止后端进程组失败，回退为停止主进程", error);
    }
  }
  child.kill("SIGTERM");
}
