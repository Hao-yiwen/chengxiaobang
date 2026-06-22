import type { WebContents } from "electron";
import { execFileSync } from "node:child_process";
import { chmod, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { hostname, platform, userInfo } from "node:os";
import { dirname, join } from "node:path";
import * as nodePty from "node-pty";
import type { TrustedIpcRegistrar } from "./trusted-ipc";

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
const MIN_COLS = 20;
const MIN_ROWS = 5;
const MAX_COLS = 500;
const MAX_ROWS = 200;
const FORCE_KILL_AFTER_MS = 1500;

export interface TerminalStartRequest {
  id: string;
  cwd: string;
  cols?: number;
  rows?: number;
}

export type TerminalIpcResult =
  | { ok: true; id?: string }
  | { ok: false; error: string };

type PtyProcess = ReturnType<typeof nodePty.spawn>;
type PtyModule = Pick<typeof nodePty, "spawn">;
type Disposable = { dispose(): void };
type KillProcess = (pid: number, signal: NodeJS.Signals | 0) => void;
type KillProcessTree = (pid: number, force: boolean) => void;
const require = createRequire(import.meta.url);

export interface TerminalSessionManagerOptions {
  platform?: NodeJS.Platform;
  killProcess?: KillProcess;
  killProcessTree?: KillProcessTree;
  forceKillAfterMs?: number;
}

interface TerminalSession {
  id: string;
  cwd: string;
  shell: string;
  owner: WebContents;
  pty: PtyProcess;
  dataDisposable: Disposable;
  exitDisposable: Disposable;
  cols: number;
  rows: number;
}

function normalizeDimension(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.floor(value)))
    : fallback;
}

export function resolveTerminalShell(
  env: NodeJS.ProcessEnv = process.env,
  currentPlatform: NodeJS.Platform = platform()
): string {
  if (currentPlatform === "win32") {
    return env.ComSpec ?? "cmd.exe";
  }
  return env.SHELL ?? "/bin/zsh";
}

function terminalEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") {
      env[key] = value;
    }
  }
  env.TERM = "xterm-256color";
  env.COLORTERM ??= "truecolor";
  return env;
}

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error
    ? String((error as NodeJS.ErrnoException).code)
    : undefined;
}

function ptyPid(pty: PtyProcess): number | undefined {
  const pid = (pty as { pid?: unknown }).pid;
  return typeof pid === "number" && Number.isFinite(pid) && pid > 0 ? pid : undefined;
}

async function assertDirectory(path: string): Promise<void> {
  const info = await stat(path);
  if (!info.isDirectory()) {
    throw new Error("项目路径不是目录");
  }
}

async function ensureNodePtySpawnHelperExecutable(): Promise<void> {
  if (platform() === "win32") {
    return;
  }
  const packageRoot = dirname(dirname(require.resolve("node-pty/lib/index.js")));
  const candidates = [
    join(packageRoot, "build", "Release", "spawn-helper"),
    join(packageRoot, "build", "Debug", "spawn-helper"),
    join(packageRoot, "prebuilds", `${process.platform}-${process.arch}`, "spawn-helper")
  ].map((path) =>
    path.replace("app.asar", "app.asar.unpacked").replace("node_modules.asar", "node_modules.asar.unpacked")
  );
  for (const helperPath of candidates) {
    try {
      const info = await stat(helperPath);
      if (!info.isFile()) {
        continue;
      }
      const executableMode = info.mode | 0o111;
      if ((info.mode & 0o111) === 0) {
        await chmod(helperPath, executableMode);
        console.info(`[terminal] 已修正 node-pty spawn-helper 执行位 path=${helperPath}`);
      }
      return;
    } catch {
      // 继续尝试下一个 node-pty 可能的 helper 位置。
    }
  }
  console.warn(`[terminal] 未找到 node-pty spawn-helper candidates=${candidates.join(",")}`);
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

export class TerminalSessionManager {
  private readonly sessions = new Map<string, TerminalSession>();
  private readonly ptyModule: PtyModule;
  private readonly shellResolver: () => string;
  private readonly currentPlatform: NodeJS.Platform;
  private readonly killProcess: KillProcess;
  private readonly killProcessTree: KillProcessTree;
  private readonly forceKillAfterMs: number;
  private runtimeReady?: Promise<void>;

  constructor(
    ptyModule: PtyModule = nodePty,
    shellResolver: () => string = resolveTerminalShell,
    options: TerminalSessionManagerOptions = {}
  ) {
    this.ptyModule = ptyModule;
    this.shellResolver = shellResolver;
    this.currentPlatform = options.platform ?? platform();
    this.killProcess = options.killProcess ?? process.kill;
    this.killProcessTree = options.killProcessTree ?? killWindowsProcessTree;
    this.forceKillAfterMs = options.forceKillAfterMs ?? FORCE_KILL_AFTER_MS;
  }

  async start(owner: WebContents, request: TerminalStartRequest): Promise<TerminalIpcResult> {
    const id = typeof request.id === "string" ? request.id.trim() : "";
    const cwd = typeof request.cwd === "string" ? request.cwd : "";
    const cols = normalizeDimension(request.cols, DEFAULT_COLS, MIN_COLS, MAX_COLS);
    const rows = normalizeDimension(request.rows, DEFAULT_ROWS, MIN_ROWS, MAX_ROWS);
    if (!id || !cwd) {
      console.error(`[terminal] 启动失败：参数无效 id=${id} cwd=${cwd}`);
      return { ok: false, error: "终端启动参数无效" };
    }
    const existingSession = this.sessions.get(id);
    if (existingSession) {
      if (existingSession.owner === owner && existingSession.cwd === cwd) {
        console.info(`[terminal] 复用已存在 PTY 会话 id=${id} cwd=${cwd} size=${cols}x${rows}`);
        this.resize(id, cols, rows);
        return { ok: true, id };
      }
      console.error(
        `[terminal] 启动失败：会话已存在且归属不匹配 id=${id} requestedCwd=${cwd} existingCwd=${existingSession.cwd} sameOwner=${existingSession.owner === owner}`
      );
      return { ok: false, error: "终端会话已存在" };
    }
    try {
      await assertDirectory(cwd);
      await this.ensureRuntimeReady();
      const shell = this.shellResolver();
      const pty = this.ptyModule.spawn(shell, [], {
        name: "xterm-256color",
        cols,
        rows,
        cwd,
        env: terminalEnv()
      });
      const dataDisposable = pty.onData((data) => {
        if (!owner.isDestroyed()) {
          owner.send("terminal:data", { id, data });
        }
      });
      const exitDisposable = pty.onExit(({ exitCode }) => {
        console.info(`[terminal] PTY 退出 id=${id} exitCode=${exitCode} cwd=${cwd}`);
        this.sessions.delete(id);
        if (!owner.isDestroyed()) {
          owner.send("terminal:exit", { id, exitCode });
        }
      });
      owner.once("destroyed", () => {
        this.closeOwnedBy(owner, "renderer-destroyed");
      });
      this.sessions.set(id, {
        id,
        cwd,
        shell,
        owner,
        pty,
        dataDisposable,
        exitDisposable,
        cols,
        rows
      });
      console.info(
        `[terminal] PTY 已启动 id=${id} platform=${platform()} cwd=${cwd} shell=${shell} size=${cols}x${rows}`
      );
      return { ok: true, id };
    } catch (error) {
      console.error(
        `[terminal] 启动失败 id=${id} platform=${platform()} cwd=${cwd}: ${messageFromError(error)}`
      );
      return { ok: false, error: messageFromError(error) };
    }
  }

  write(id: string, data: string): TerminalIpcResult {
    const session = this.sessions.get(id);
    if (!session) {
      console.warn(`[terminal] 写入失败：会话不存在 id=${id}`);
      return { ok: false, error: "终端会话不存在" };
    }
    session.pty.write(data);
    return { ok: true };
  }

  resize(id: string, cols: number, rows: number): TerminalIpcResult {
    const session = this.sessions.get(id);
    if (!session) {
      console.warn(`[terminal] 调整尺寸失败：会话不存在 id=${id}`);
      return { ok: false, error: "终端会话不存在" };
    }
    const nextCols = normalizeDimension(cols, session.cols, MIN_COLS, MAX_COLS);
    const nextRows = normalizeDimension(rows, session.rows, MIN_ROWS, MAX_ROWS);
    if (nextCols === session.cols && nextRows === session.rows) {
      return { ok: true };
    }
    session.cols = nextCols;
    session.rows = nextRows;
    session.pty.resize(nextCols, nextRows);
    console.info(`[terminal] PTY 尺寸更新 id=${id} size=${nextCols}x${nextRows}`);
    return { ok: true };
  }

  close(id: string, reason = "manual"): TerminalIpcResult {
    const session = this.sessions.get(id);
    if (!session) {
      return { ok: true };
    }
    this.sessions.delete(id);
    session.dataDisposable.dispose();
    session.exitDisposable.dispose();
    this.signalTerminalSession(session, "SIGTERM", reason);
    this.scheduleForceKill(session, reason);
    console.info(
      `[terminal] PTY 已关闭 id=${id} reason=${reason} cwd=${session.cwd} pid=${ptyPid(session.pty) ?? "unknown"}`
    );
    return { ok: true };
  }

  closeOwnedBy(owner: WebContents, reason: string): void {
    for (const session of [...this.sessions.values()]) {
      if (session.owner === owner) {
        this.close(session.id, reason);
      }
    }
  }

  disposeAll(): void {
    for (const id of [...this.sessions.keys()]) {
      this.close(id, "app-quit");
    }
  }

  private ensureRuntimeReady(): Promise<void> {
    if (this.ptyModule !== nodePty) {
      return Promise.resolve();
    }
    this.runtimeReady ??= ensureNodePtySpawnHelperExecutable();
    return this.runtimeReady;
  }

  private signalTerminalSession(
    session: TerminalSession,
    signal: NodeJS.Signals,
    reason: string
  ): void {
    const pid = ptyPid(session.pty);
    let signaledProcessTree = false;
    if (pid && this.currentPlatform === "win32") {
      try {
        this.killProcessTree(pid, signal === "SIGKILL");
        signaledProcessTree = true;
        console.info(
          `[terminal] 已向 PTY 进程树发送终止信号 id=${session.id} pid=${pid} signal=${signal} force=${signal === "SIGKILL"} reason=${reason}`
        );
      } catch (error) {
        const code = errorCode(error);
        console.warn(
          `[terminal] PTY 进程树终止失败，回退 node-pty kill id=${session.id} pid=${pid} signal=${signal} reason=${reason} code=${code ?? "unknown"} error=${messageFromError(error)}`
        );
      }
    }
    if (pid && this.currentPlatform !== "win32") {
      try {
        this.killProcess(-pid, signal);
        signaledProcessTree = true;
        console.info(
          `[terminal] 已向 PTY 进程组发送终止信号 id=${session.id} pid=${pid} signal=${signal} reason=${reason}`
        );
      } catch (error) {
        const code = errorCode(error);
        if (code !== "ESRCH") {
          console.warn(
            `[terminal] PTY 进程组终止失败，回退 node-pty kill id=${session.id} pid=${pid} signal=${signal} reason=${reason} code=${code ?? "unknown"} error=${messageFromError(error)}`
          );
        }
      }
    }
    try {
      if (this.currentPlatform === "win32") {
        session.pty.kill();
      } else {
        session.pty.kill(signal);
      }
      console.info(
        `[terminal] node-pty kill 已调用 id=${session.id} pid=${pid ?? "unknown"} signal=${this.currentPlatform === "win32" ? "default" : signal} reason=${reason} processTreeSignaled=${signaledProcessTree}`
      );
    } catch (error) {
      console.warn(
        `[terminal] node-pty kill 调用失败 id=${session.id} pid=${pid ?? "unknown"} signal=${signal} reason=${reason} error=${messageFromError(error)}`
      );
    }
  }

  private scheduleForceKill(session: TerminalSession, reason: string): void {
    const pid = ptyPid(session.pty);
    if (!pid || this.forceKillAfterMs <= 0) {
      return;
    }
    const timer = setTimeout(() => {
      if (!this.isPtyProcessAlive(pid)) {
        return;
      }
      console.warn(
        `[terminal] PTY 温和终止后仍存活，升级为强制终止 id=${session.id} pid=${pid} reason=${reason}`
      );
      this.signalTerminalSession(session, "SIGKILL", `${reason}:force`);
    }, this.forceKillAfterMs);
    timer.unref?.();
  }

  private isPtyProcessAlive(pid: number): boolean {
    try {
      this.killProcess(this.currentPlatform === "win32" ? pid : -pid, 0);
      return true;
    } catch (error) {
      return errorCode(error) === "EPERM";
    }
  }
}

function parseStartRequest(input: unknown): TerminalStartRequest {
  const value = input as Partial<TerminalStartRequest> | undefined;
  return {
    id: typeof value?.id === "string" ? value.id : "",
    cwd: typeof value?.cwd === "string" ? value.cwd : "",
    cols: typeof value?.cols === "number" ? value.cols : undefined,
    rows: typeof value?.rows === "number" ? value.rows : undefined
  };
}

export function registerTerminalIpc(
  ipc: TrustedIpcRegistrar,
  manager = new TerminalSessionManager()
): TerminalSessionManager {
  ipc.handle("terminal:start", (event, input) => manager.start(event.sender, parseStartRequest(input)));
  ipc.handle("terminal:write", (_event, id: unknown, data: unknown) =>
    manager.write(typeof id === "string" ? id : "", typeof data === "string" ? data : "")
  );
  ipc.handle("terminal:resize", (_event, id: unknown, cols: unknown, rows: unknown) =>
    manager.resize(
      typeof id === "string" ? id : "",
      typeof cols === "number" ? cols : DEFAULT_COLS,
      typeof rows === "number" ? rows : DEFAULT_ROWS
    )
  );
  ipc.handle("terminal:close", (_event, id: unknown) =>
    manager.close(typeof id === "string" ? id : "", "renderer-close")
  );
  // 终端 tab 标题用的 user@host;沙箱 preload 取不到 node:os,只能由主进程提供。
  ipc.handle("terminal:host-label", () => {
    try {
      const user = userInfo().username || "user";
      const host = (hostname() || "local").split(".")[0];
      return `${user}@${host}`;
    } catch (error) {
      console.warn("[terminal] 读取主机标签失败，使用回退值", error);
      return "terminal";
    }
  });
  return manager;
}
