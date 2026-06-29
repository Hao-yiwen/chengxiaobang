import { randomBytes } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  execFileSync,
  spawn,
  type ChildProcess,
  type ChildProcessWithoutNullStreams
} from "node:child_process";
import { once } from "node:events";
import {
  type LogLevelName,
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
  /** 停止后端并等待其真正退出(带硬超时兜底),供应用退出时使用,避免后端孤儿进程。 */
  stopAndWait(): Promise<void>;
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
  runtimeCheck?: BackendRuntimeCheckDiagnostics;
  stdout: string[];
  stderr: string[];
  lastHealthStatus?: string;
  lastHealthError?: string;
  spawnError?: string;
}

export interface BackendRuntimeCheckDiagnostics {
  timeoutMs: number;
  durationMs?: number;
  version?: string;
  error?: string;
}

export interface BackendRuntimeCheckResult {
  version: string;
  durationMs: number;
}

export interface BackendStopOptions {
  forceKillAfterMs?: number;
  killProcess?: (pid: number, signal: NodeJS.Signals) => void;
  killProcessTree?: (pid: number, force: boolean) => void;
  platform?: NodeJS.Platform;
}

const DEFAULT_BACKEND_START_TIMEOUT_MS = 45_000;
const BACKEND_RUNTIME_CHECK_TIMEOUT_MS = 10_000;
const BACKEND_HEALTH_CHECK_TIMEOUT_MS = 1_500;
const BACKEND_HEALTH_CHECK_INTERVAL_MS = 200;
const BACKEND_OUTPUT_TAIL_LINES = 30;
const BACKEND_STOP_FORCE_KILL_AFTER_MS = 1_500;

export function resolveBackendCommand(options: {
  port: number;
  dataDir: string;
  token: string;
  resourcesPath: string;
  isPackaged: boolean;
  ocrService?: { url: string; token: string };
  platform?: NodeJS.Platform;
}): BackendCommand {
  const platform = options.platform ?? process.platform;
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
    options.token,
    ...(options.ocrService
      ? ["--ocr-service-url", options.ocrService.url, "--ocr-service-token", options.ocrService.token]
      : []),
    "--parent-pid",
    String(process.pid)
  ];
  const env = { ...process.env };
  const root = projectRoot();
  const bundledBun = join(options.resourcesPath, backendRuntimeResourceName(platform));
  const bundledRg = join(options.resourcesPath, searchRuntimeResourceName(platform));
  const devBun = join(root, "node_modules", "bun", "bin", "bun.exe");
  const devBunShim = resolve(root, "node_modules/.bin/bun");
  const devBunWinShims = [
    resolve(root, "node_modules/.bin/bun.cmd"),
    resolve(root, "node_modules/.bin/bun.exe")
  ];
  const bunBinary = process.env.BUN_BINARY ?? (options.isPackaged
    ? firstExisting([bundledBun])
    : firstExisting([devBun, ...(platform === "win32" ? devBunWinShims : []), devBunShim]));
  const rgBinary =
    process.env.CHENGXIAOBANG_RG_PATH?.trim() ||
    (options.isPackaged
      ? firstExisting([bundledRg])
      : firstExisting(workspaceRipgrepCandidates(root, platform, process.arch)));

  // 开发模式用 Bun watch 自动重启后端，避免每次改后端都重启 Electron。
  const dev = !options.isPackaged;

  if (!bunBinary) {
    throw new Error(
      options.isPackaged
        ? `后端运行时缺失：未找到 Bun binary（${bundledBun}）`
        : `后端运行时缺失：未找到 Bun binary，请先运行 pnpm install 或设置 BUN_BINARY（${devBun}）`
    );
  }
  if (options.isPackaged && !rgBinary) {
    throw new Error(`搜索运行时缺失：未找到 ripgrep binary（${bundledRg}）`);
  }
  if (rgBinary) {
    env.CHENGXIAOBANG_RG_PATH = rgBinary;
  }

  const args = dev ? ["--no-orphans", "--watch", ...commonArgs] : commonArgs;
  if (dev) {
    env.CHENGXIAOBANG_MODEL_DEBUG = env.CHENGXIAOBANG_MODEL_DEBUG ?? "1";
  } else {
    delete env.CHENGXIAOBANG_MODEL_DEBUG;
  }
  return { command: bunBinary, args, env };
}

export async function startBackendProcess(options: {
  dataDir: string;
  resourcesPath: string;
  isPackaged: boolean;
  ocrService?: { url: string; token: string };
  logger?: LogWriter;
}): Promise<BackendProcess> {
  const port = 30_000 + Math.floor(Math.random() * 20_000);
  const token = randomBytes(24).toString("hex");
  let command = resolveBackendCommand({
    port,
    dataDir: options.dataDir,
    token,
    resourcesPath: options.resourcesPath,
    isPackaged: options.isPackaged,
    ...(options.ocrService ? { ocrService: options.ocrService } : {})
  });
  command = prepareBackendRuntimeCommand(command, {
    dataDir: options.dataDir,
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
  console.info(
    `[main] 后端运行时自检开始 command=${command.command} platform=${process.platform} arch=${process.arch} timeout=${BACKEND_RUNTIME_CHECK_TIMEOUT_MS}ms`
  );
  try {
    const runtimeCheck = await checkBackendRuntime(command);
    diagnostics.runtimeCheck = {
      timeoutMs: BACKEND_RUNTIME_CHECK_TIMEOUT_MS,
      durationMs: runtimeCheck.durationMs,
      version: runtimeCheck.version
    };
    console.info(
      `[main] 后端运行时自检完成 command=${command.command} version=${runtimeCheck.version} durationMs=${runtimeCheck.durationMs}ms`
    );
  } catch (error) {
    diagnostics.runtimeCheck = {
      timeoutMs: BACKEND_RUNTIME_CHECK_TIMEOUT_MS,
      error: messageFromError(error)
    };
    const errorMessage = formatBackendStartupFailure("后端运行时自检失败", diagnostics);
    console.error(
      `[main] 后端运行时自检失败 port=${port} timeout=${BACKEND_RUNTIME_CHECK_TIMEOUT_MS}ms command=${command.command}\n${errorMessage}`
    );
    throw new Error(errorMessage);
  }

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

  let stopRequested = false;
  child.on("exit", (code, signal) => {
    const message = stopRequested ? "后端进程已退出" : "后端进程意外退出";
    const log = stopRequested ? console.info : console.warn;
    log(
      `[main] ${message} port=${port} pid=${child.pid ?? "unknown"} exitCode=${code ?? "unknown"} signal=${signal ?? "none"}`
    );
  });

  await waitForBackend(child, port, token, diagnostics);
  console.info(`[main] 后端启动完成 port=${port}`);
  return {
    info: { baseURL: `http://127.0.0.1:${port}`, token },
    child,
    stop: () => {
      stopRequested = true;
      stopBackendChild(child);
    },
    stopAndWait: async () => {
      stopRequested = true;
      if (hasBackendChildExited(child)) {
        return;
      }
      const exited = once(child, "exit").catch(() => undefined);
      stopBackendChild(child);
      // 硬超时兜底:即使进程拒绝退出也不让退出流程永久挂起(强杀定时器 1.5s,这里多留 1s)。
      let timer: ReturnType<typeof setTimeout> | undefined;
      const hardTimeout = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, BACKEND_STOP_FORCE_KILL_AFTER_MS + 1_000);
      });
      try {
        await Promise.race([exited, hardTimeout]);
      } finally {
        if (timer) {
          clearTimeout(timer);
        }
      }
    }
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

function workspaceRipgrepCandidates(
  root: string,
  platform: NodeJS.Platform,
  arch: string
): string[] {
  const binaryName = searchRuntimeResourceName(platform);
  const packageName = `ripgrep-${platform}-${arch}`;
  const candidates = [
    join(root, "node_modules", "@vscode", packageName, "bin", binaryName),
    join(root, "node_modules", ".bin", binaryName)
  ];
  const pnpmDir = join(root, "node_modules", ".pnpm");
  try {
    const prefix = `@vscode+${packageName}@`;
    for (const entry of readdirSync(pnpmDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith(prefix)) {
        continue;
      }
      candidates.push(
        join(pnpmDir, entry.name, "node_modules", "@vscode", packageName, "bin", binaryName)
      );
    }
  } catch {
    // pnpm 布局不存在时走上面的常规 node_modules / PATH 兜底。
  }
  return candidates;
}

export function prepareBackendRuntimeCommand(
  command: BackendCommand,
  options: { dataDir: string; isPackaged: boolean; signRuntime?: boolean; platform?: NodeJS.Platform }
): BackendCommand {
  if (options.isPackaged || process.env.BUN_BINARY || !isWorkspaceBunBinary(command.command)) {
    return command;
  }

  try {
    const sourceStat = statSync(command.command);
    if (!sourceStat.isFile()) {
      return command;
    }

    const runtimeDir = join(options.dataDir, "runtime");
    const platform = options.platform ?? process.platform;
    const extension = platform === "win32" ? ".exe" : "";
    const target = join(
      runtimeDir,
      `bun-dev-${platform}-${process.arch}-${sourceStat.size}${extension}`
    );
    mkdirSync(runtimeDir, { recursive: true });

    const targetNeedsCopy =
      !existsSync(target) || !isDevBunRuntimePreparedForSource(target, sourceStat);
    if (targetNeedsCopy) {
      copyFileSync(command.command, target);
      if (platform !== "win32") {
        chmodSync(target, 0o755);
      }
      console.info(
        `[main] 已准备开发态 Bun 运行时缓存 source=${command.command} target=${target} size=${sourceStat.size}`
      );
    } else {
      if (platform !== "win32") {
        chmodSync(target, 0o755);
      }
      console.info(
        `[main] 使用开发态 Bun 运行时缓存 source=${command.command} target=${target} size=${sourceStat.size}`
      );
    }
    signDevBunRuntime(target, sourceStat, options.signRuntime !== false);

    return { ...command, command: target };
  } catch (error) {
    console.warn(
      `[main] 准备开发态 Bun 运行时缓存失败 source=${command.command} dataDir=${options.dataDir} error=${messageFromError(error)}，回退原路径`
    );
    return command;
  }
}

function isWorkspaceBunBinary(command: string): boolean {
  return /(^|\/)node_modules\/bun\/bin\/bun\.exe$/.test(command.replaceAll("\\", "/"));
}

function isDevBunRuntimePreparedForSource(
  target: string,
  sourceStat: { size: number; mtimeMs: number }
): boolean {
  const marker = `${target}.adhoc-signature`;
  return existsSync(marker) && readFileSync(marker, "utf8") === devBunRuntimeMarkerContent(sourceStat);
}

function signDevBunRuntime(
  target: string,
  sourceStat: { size: number; mtimeMs: number },
  enabled: boolean
): void {
  if (!enabled || process.platform !== "darwin") {
    return;
  }

  const marker = `${target}.adhoc-signature`;
  const markerContent = devBunRuntimeMarkerContent(sourceStat);

  try {
    execFileSync("codesign", ["--force", "--sign", "-", target], {
      stdio: ["ignore", "pipe", "pipe"]
    });
    writeFileSync(marker, markerContent);
    console.info(`[main] 已对开发态 Bun 运行时缓存完成本地签名 target=${target}`);
  } catch (error) {
    console.warn(
      `[main] 开发态 Bun 运行时缓存本地签名失败 target=${target} error=${syncProcessErrorMessage(error)}`
    );
  }
}

function devBunRuntimeMarkerContent(sourceStat: { size: number; mtimeMs: number }): string {
  return `adhoc-v2:${sourceStat.size}:${sourceStat.mtimeMs}`;
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

export async function checkBackendRuntime(
  command: BackendCommand,
  options: { timeoutMs?: number } = {}
): Promise<BackendRuntimeCheckResult> {
  const timeoutMs = options.timeoutMs ?? BACKEND_RUNTIME_CHECK_TIMEOUT_MS;
  const startedAt = Date.now();

  return new Promise((resolveCheck, rejectCheck) => {
    let settled = false;
    let stdout = "";
    let stderr = "";
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(command.command, ["--version"], {
        env: command.env,
        stdio: ["ignore", "pipe", "pipe"]
      });
    } catch (error) {
      rejectCheck(new Error(`Bun 运行时自检启动失败: ${messageFromError(error)}`));
      return;
    }

    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback();
    };

    const timeout = setTimeout(() => {
      finish(() => {
        child.kill("SIGKILL");
        rejectCheck(
          new Error(
            `Bun 运行时自检超时 timeout=${timeoutMs}ms stdout=${formatOneLineOutput(stdout)} stderr=${formatOneLineOutput(stderr)}`
          )
        );
      });
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      finish(() => {
        rejectCheck(new Error(`Bun 运行时自检启动失败: ${messageFromError(error)}`));
      });
    });
    child.on("close", (code, signal) => {
      finish(() => {
        const durationMs = Date.now() - startedAt;
        if (code === 0) {
          const version = stdout.trim() || stderr.trim() || "unknown";
          resolveCheck({ version, durationMs });
          return;
        }
        rejectCheck(
          new Error(
            `Bun 运行时自检失败 exitCode=${code ?? "unknown"} signal=${signal ?? "none"} durationMs=${durationMs}ms stdout=${formatOneLineOutput(stdout)} stderr=${formatOneLineOutput(stderr)}`
          )
        );
      });
    });
  });
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
    `platform=${process.platform} arch=${process.arch}`,
    `dataDir=${diagnostics.dataDir}`,
    "可通过 CHENGXIAOBANG_BACKEND_START_TIMEOUT_MS=60000 临时调大启动等待时间"
  ];

  if (diagnostics.spawnError) {
    lines.push(`spawnError=${diagnostics.spawnError}`);
  }
  if (diagnostics.runtimeCheck) {
    lines.push(formatRuntimeCheckDiagnostic(diagnostics.runtimeCheck));
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
    const parsed = parseBackendPinoLogLine(line);
    const level = parsed?.level ?? (stream === "stderr" ? "warn" : "info");
    const fields = {
      stream,
      port: context.port,
      pid: context.pid,
      ...(parsed?.fields ?? {})
    };
    const message = parsed?.message ?? line;
    writeStructuredLog(
      context.logger,
      level,
      fields,
      message
    );
    if (context.terminal) {
      context.terminal[level](`[chengxiaobang-backend] ${message}`);
    } else {
      writeTerminalLog(level, `[chengxiaobang-backend] ${message}`);
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

function parseBackendPinoLogLine(
  line: string
): { level: LogLevelName; fields: Record<string, unknown>; message: string } | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return undefined;
  }
  const record = parsed as Record<string, unknown>;
  if (typeof record.msg !== "string" || !isPinoLevel(record.level)) {
    return undefined;
  }
  const { level, time, pid, hostname, msg, ...fields } = record;
  return {
    level: pinoLevelToLogLevel(level),
    message: msg,
    fields: {
      ...fields,
      ...(typeof time === "string" || typeof time === "number" ? { backendTime: time } : {}),
      ...(typeof pid === "number" ? { backendPid: pid } : {}),
      ...(typeof hostname === "string" ? { backendHostname: hostname } : {})
    }
  };
}

function isPinoLevel(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function pinoLevelToLogLevel(level: number): LogLevelName {
  if (level >= 50) {
    return "error";
  }
  if (level >= 40) {
    return "warn";
  }
  if (level <= 20) {
    return "debug";
  }
  return "info";
}

function formatOutputTail(lines: string[]): string {
  return lines.map((line) => `  ${line}`).join("\n");
}

function formatRuntimeCheckDiagnostic(runtimeCheck: BackendRuntimeCheckDiagnostics): string {
  const fields = [`timeoutMs=${runtimeCheck.timeoutMs}`];
  if (runtimeCheck.durationMs !== undefined) {
    fields.push(`durationMs=${runtimeCheck.durationMs}`);
  }
  if (runtimeCheck.version) {
    fields.push(`version=${runtimeCheck.version}`);
  }
  if (runtimeCheck.error) {
    fields.push(`error=${runtimeCheck.error}`);
  }
  return `runtimeCheck=${fields.join(" ")}`;
}

function formatOneLineOutput(output: string): string {
  const text = output.replace(/\s+/g, " ").trim();
  return text ? text.slice(0, 500) : "<empty>";
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

function syncProcessErrorMessage(error: unknown): string {
  const base = messageFromError(error);
  if (!error || typeof error !== "object") {
    return base;
  }
  const stdout = "stdout" in error ? formatOneLineOutput(String(error.stdout ?? "")) : "";
  const stderr = "stderr" in error ? formatOneLineOutput(String(error.stderr ?? "")) : "";
  return [base, stdout ? `stdout=${stdout}` : "", stderr ? `stderr=${stderr}` : ""]
    .filter(Boolean)
    .join(" ");
}

export function stopBackendChild(child: ChildProcess, options: BackendStopOptions = {}): void {
  if (hasBackendChildExited(child)) {
    return;
  }
  const killProcess = options.killProcess ?? process.kill;
  const killProcessTree = options.killProcessTree ?? killBackendProcessTree;
  const forceKillAfterMs = options.forceKillAfterMs ?? BACKEND_STOP_FORCE_KILL_AFTER_MS;
  const target = signalBackendChild(
    child,
    "SIGTERM",
    killProcess,
    killProcessTree,
    options.platform ?? process.platform,
    "请求停止"
  );
  if (target === "none" || !Number.isFinite(forceKillAfterMs) || forceKillAfterMs <= 0) {
    return;
  }

  let forceTimer: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
    forceTimer = undefined;
    if (hasBackendChildExited(child)) {
      return;
    }
    console.warn(
      `[main] 后端进程在 ${forceKillAfterMs}ms 内未退出，开始强制清理 pid=${child.pid ?? "unknown"}`
    );
    signalBackendChild(
      child,
      "SIGKILL",
      killProcess,
      killProcessTree,
      options.platform ?? process.platform,
      "强制停止"
    );
  }, forceKillAfterMs);

  const clearForceTimer = () => {
    if (!forceTimer) {
      return;
    }
    clearTimeout(forceTimer);
    forceTimer = undefined;
  };
  child.once("exit", clearForceTimer);
  child.once("close", clearForceTimer);
}

function hasBackendChildExited(child: Pick<ChildProcess, "exitCode" | "signalCode">): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

function signalBackendChild(
  child: ChildProcess,
  signal: NodeJS.Signals,
  killProcess: (pid: number, signal: NodeJS.Signals) => void,
  killProcessTree: (pid: number, force: boolean) => void,
  platform: NodeJS.Platform,
  action: string
): "process-group" | "process-tree" | "process" | "none" {
  if (platform === "win32" && child.pid) {
    try {
      killProcessTree(child.pid, signal === "SIGKILL");
      console.info(
        `[main] ${action}后端进程树 pid=${child.pid} signal=${signal} force=${signal === "SIGKILL"}`
      );
      return "process-tree";
    } catch (error) {
      console.warn(
        `[main] ${action}后端进程树失败 pid=${child.pid} signal=${signal}，回退为停止主进程`,
        error
      );
    }
  }
  if (platform !== "win32" && child.pid) {
    try {
      killProcess(-child.pid, signal);
      console.info(`[main] ${action}后端进程组 pid=${child.pid} signal=${signal}`);
      return "process-group";
    } catch (error) {
      console.warn(
        `[main] ${action}后端进程组失败 pid=${child.pid} signal=${signal}，回退为停止主进程`,
        error
      );
    }
  }
  if (child.kill(signal)) {
    console.info(`[main] ${action}后端主进程 pid=${child.pid ?? "unknown"} signal=${signal}`);
    return "process";
  }
  console.warn(`[main] ${action}后端主进程失败 pid=${child.pid ?? "unknown"} signal=${signal}`);
  return "none";
}

function backendRuntimeResourceName(platform: NodeJS.Platform): string {
  return platform === "win32" ? "bun.exe" : "bun";
}

function searchRuntimeResourceName(platform: NodeJS.Platform): string {
  return platform === "win32" ? "rg.exe" : "rg";
}

function killBackendProcessTree(pid: number, force: boolean): void {
  const args = ["/PID", String(pid), "/T"];
  if (force) {
    args.push("/F");
  }
  execFileSync("taskkill", args, {
    stdio: ["ignore", "pipe", "pipe"]
  });
}
