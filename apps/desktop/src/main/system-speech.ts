import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { TrustedIpcRegistrar } from "./trusted-ipc";

const DEFAULT_LANGUAGE = "zh-CN";
const MAX_RECOGNITION_SECONDS = 120;
const HELPER_READY_TIMEOUT_MS = 15_000;
const HELPER_STOP_TIMEOUT_MS = 10_000;

export interface SystemSpeechRuntimeOptions {
  appPath: string;
  resourcesPath: string;
  isPackaged: boolean;
  platform?: NodeJS.Platform;
  darwinHelperPath?: string;
  darwinHelperArgsPrefix?: string[];
  darwinHelperAppBundle?: string;
  readyTimeoutMs?: number;
  stopTimeoutMs?: number;
}

export type SystemSpeechAvailability = {
  ok: true;
  platform: NodeJS.Platform;
  language: string;
  available: boolean;
  reason?: string;
};

export type SystemSpeechStartResult =
  | { ok: true; sessionId: string }
  | { ok: false; error: string; available?: false };

export type SystemSpeechStopResult =
  | { ok: true; sessionId: string; text: string; elapsedMs: number }
  | { ok: false; sessionId?: string; error: string; text?: string; elapsedMs?: number };

export type SystemSpeechCancelResult = { ok: true } | { ok: false; error: string };

export type SystemSpeechRendererEvent = {
  type: "level";
  sessionId: string;
  level: number;
  elapsedMs: number;
};

type HelperCommand = {
  command: string;
  args: string[];
  appBundle?: string;
};

type HelperEvent = {
  type: string;
  language?: string;
  available?: boolean;
  reason?: string;
  text?: string;
  error?: string;
  level?: number;
  elapsedMs?: number;
};

interface ActiveSpeechSession {
  id: string;
  language: string;
  helperPath: string;
  launchMode: "direct" | "appBundle";
  child: ChildProcess;
  startedAt: number;
  ready: Promise<void>;
  done: Promise<SystemSpeechStopResult>;
  stopRequested: boolean;
  lastText: string;
  stderrTail: string;
  stop(): void;
  cancel(): void;
  dispose(delayMs?: number): void;
}

interface LaunchedHelper {
  child: ChildProcess;
  helperPath: string;
  launchMode: "direct" | "appBundle";
  outputFile?: string;
  controlFile?: string;
  send(command: "stop" | "cancel"): void;
  terminate(): void;
  cleanup(): Promise<void>;
}

export function registerSystemSpeechIpc(
  ipcMain: TrustedIpcRegistrar,
  options: SystemSpeechRuntimeOptions
): void {
  const manager = new SystemSpeechManager(options);
  ipcMain.handle("speech:availability", (_event, input: unknown) =>
    manager.availability(normalizeSpeechInput(input).language)
  );
  ipcMain.handle("speech:start", (_event, input: unknown) =>
    manager.start(normalizeSpeechInput(input).language, (event) => {
      _event.sender.send("speech:event", event);
    })
  );
  ipcMain.handle("speech:stop", (_event, input: unknown) =>
    manager.stop(normalizeSessionInput(input).sessionId)
  );
  ipcMain.handle("speech:cancel", (_event, input: unknown) =>
    manager.cancel(normalizeSessionInput(input).sessionId)
  );
}

export class SystemSpeechManager {
  private activeSession: ActiveSpeechSession | undefined;

  constructor(private readonly options: SystemSpeechRuntimeOptions) {}

  async availability(language = DEFAULT_LANGUAGE): Promise<SystemSpeechAvailability> {
    const platform = this.platform();
    if (platform !== "darwin") {
      const reason =
        platform === "win32"
          ? "Windows 系统语音输入适配尚未随当前构建启用"
          : "当前平台暂不支持系统语音输入";
      console.info("[system-speech] 系统语音可用性检查完成", {
        platform,
        language,
        available: false,
        reason
      });
      return { ok: true, platform, language, available: false, reason };
    }

    const helper = resolveDarwinHelperCommand(this.options, "recognize", language);
    if (!helper) {
      const reason = "未找到 macOS 系统语音 helper";
      console.warn("[system-speech] 系统语音 helper 缺失", { platform, language });
      return { ok: true, platform, language, available: false, reason };
    }

    console.info("[system-speech] 系统语音可用性检查完成", {
      platform,
      language,
      available: true,
      helper: helper.appBundle ?? helper.command
    });
    return { ok: true, platform, language, available: true };
  }

  async start(
    language = DEFAULT_LANGUAGE,
    onEvent?: (event: SystemSpeechRendererEvent) => void
  ): Promise<SystemSpeechStartResult> {
    const platform = this.platform();
    if (this.activeSession) {
      console.warn("[system-speech] 拒绝重复开始语音输入", {
        activeSessionId: this.activeSession.id,
        platform,
        language
      });
      return { ok: false, error: "已有语音输入正在进行" };
    }

    const availability = await this.availability(language);
    if (!availability.available) {
      return {
        ok: false,
        available: false,
        error: availability.reason ?? "系统语音输入不可用"
      };
    }

    const helper = resolveDarwinHelperCommand(this.options, "recognize", language);
    if (!helper) {
      return { ok: false, available: false, error: "未找到系统语音 helper" };
    }

    const sessionId = `speech_${Date.now().toString(36)}_${randomBytes(4).toString("hex")}`;
    console.info("[system-speech] 开始系统语音输入", {
      sessionId,
      platform,
      language,
      helper: helper.command,
      appBundle: helper.appBundle
    });
    const launched = await launchHelper(helper, sessionId);
    const session = createActiveSession(
      sessionId,
      language,
      launched,
      (event) => onEvent?.(event),
      () => {
        if (this.activeSession?.id === sessionId) {
          this.activeSession = undefined;
        }
      }
    );
    this.activeSession = session;

    try {
      await withTimeout(
        session.ready,
        this.options.readyTimeoutMs ?? HELPER_READY_TIMEOUT_MS,
        () => {
          session.cancel();
          return new Error("系统语音 helper 启动超时");
        }
      );
      console.info("[system-speech] 系统语音输入已就绪", { sessionId, platform, language });
      return { ok: true, sessionId };
    } catch (error) {
      this.activeSession = undefined;
      session.dispose(1_000);
      const message = messageFromError(error);
      console.warn("[system-speech] 系统语音输入启动失败", {
        sessionId,
        platform,
        language,
        helper: session.helperPath,
        launchMode: session.launchMode,
        helperPid: session.child.pid,
        elapsedMs: Date.now() - session.startedAt,
        stderr: session.stderrTail.trim() || undefined,
        error: message
      });
      return { ok: false, error: message };
    }
  }

  async stop(sessionId?: string): Promise<SystemSpeechStopResult> {
    const session = this.requireActiveSession(sessionId);
    if (!session) {
      return { ok: false, error: "没有正在进行的语音输入" };
    }
    session.stopRequested = true;
    session.stop();
    console.info("[system-speech] 停止系统语音输入，等待最终转写", {
      sessionId: session.id,
      language: session.language
    });
    const result = await withTimeout(
      session.done,
      this.options.stopTimeoutMs ?? HELPER_STOP_TIMEOUT_MS,
      () => {
        session.cancel();
        return new Error("系统语音转写超时");
      }
    ).catch((error): SystemSpeechStopResult => {
      session.dispose(1_000);
      return {
        ok: false,
        sessionId: session.id,
        error: messageFromError(error),
        text: session.lastText,
        elapsedMs: Date.now() - session.startedAt
      };
    });
    console.info("[system-speech] 系统语音输入结束", {
      sessionId: session.id,
      ok: result.ok,
      textChars: result.ok ? result.text.length : (result.text?.length ?? 0),
      elapsedMs: result.elapsedMs
    });
    if (this.activeSession?.id === session.id) {
      this.activeSession = undefined;
    }
    return result;
  }

  async cancel(sessionId?: string): Promise<SystemSpeechCancelResult> {
    const session = this.requireActiveSession(sessionId);
    if (!session) {
      return { ok: true };
    }
    console.info("[system-speech] 取消系统语音输入", {
      sessionId: session.id,
      language: session.language
    });
    session.cancel();
    session.dispose(1_000);
    if (this.activeSession?.id === session.id) {
      this.activeSession = undefined;
    }
    return { ok: true };
  }

  private requireActiveSession(sessionId?: string): ActiveSpeechSession | undefined {
    if (!this.activeSession) {
      return undefined;
    }
    if (sessionId && this.activeSession.id !== sessionId) {
      console.warn("[system-speech] 收到非当前语音会话请求", {
        requestedSessionId: sessionId,
        activeSessionId: this.activeSession.id
      });
      return undefined;
    }
    return this.activeSession;
  }

  private platform(): NodeJS.Platform {
    return this.options.platform ?? process.platform;
  }
}

export function parseSpeechHelperLine(line: string): HelperEvent | undefined {
  const trimmed = line.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }
    const record = parsed as Record<string, unknown>;
    if (typeof record.type !== "string") {
      return undefined;
    }
    return {
      type: record.type,
      ...(typeof record.language === "string" ? { language: record.language } : {}),
      ...(typeof record.available === "boolean" ? { available: record.available } : {}),
      ...(typeof record.reason === "string" ? { reason: record.reason } : {}),
      ...(typeof record.text === "string" ? { text: record.text } : {}),
      ...(typeof record.error === "string" ? { error: record.error } : {}),
      ...(typeof record.level === "number" ? { level: record.level } : {}),
      ...(typeof record.elapsedMs === "number" ? { elapsedMs: record.elapsedMs } : {})
    };
  } catch {
    return undefined;
  }
}

function createActiveSession(
  id: string,
  language: string,
  launched: LaunchedHelper,
  onEvent: (event: SystemSpeechRendererEvent) => void,
  onDone: () => void
): ActiveSpeechSession {
  const { child } = launched;
  let stdoutBuffer = "";
  let stderrTail = "";
  let outputFileOffset = 0;
  let outputPollTimer: NodeJS.Timeout | undefined;
  let outputPollRunning = false;
  let readySettled = false;
  let doneSettled = false;
  let disposed = false;
  let cleanupStarted = false;
  let stopRequested = false;
  let lastText = "";
  const startedAt = Date.now();
  let resolveReady: () => void;
  let rejectReady: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  let resolveDone: (result: SystemSpeechStopResult) => void;
  const done = new Promise<SystemSpeechStopResult>((resolve) => {
    resolveDone = resolve;
  });

  const settleReady = (error?: Error) => {
    if (readySettled) {
      return;
    }
    readySettled = true;
    if (error) {
      rejectReady(error);
      return;
    }
    resolveReady();
  };
  const cleanupLaunched = (delayMs = 0) => {
    if (cleanupStarted) {
      return;
    }
    cleanupStarted = true;
    if (outputPollTimer) {
      clearInterval(outputPollTimer);
      outputPollTimer = undefined;
    }
    const runCleanup = () => {
      void launched.cleanup().catch((error) => {
        console.warn("[system-speech] 清理语音 helper 临时文件失败", {
          sessionId: id,
          error: messageFromError(error)
        });
      });
    };
    if (delayMs > 0) {
      setTimeout(runCleanup, delayMs);
      return;
    }
    runCleanup();
  };
  const settleDone = (result: SystemSpeechStopResult) => {
    if (doneSettled) {
      return;
    }
    doneSettled = true;
    cleanupLaunched();
    resolveDone(result);
    onDone();
  };

  const handleEvent = (event: HelperEvent) => {
    if (event.type === "level" && typeof event.level === "number") {
      onEvent({
        type: "level",
        sessionId: id,
        level: Math.max(0, Math.min(1, event.level)),
        elapsedMs: event.elapsedMs ?? Date.now() - startedAt
      });
      return;
    }
    if (typeof event.text === "string") {
      lastText = event.text;
    }
    if (event.type === "ready") {
      settleReady();
      return;
    }
    if (event.type === "partial") {
      console.debug("[system-speech] 收到系统语音中间结果", {
        sessionId: id,
        language,
        textChars: lastText.length,
        elapsedMs: event.elapsedMs
      });
      return;
    }
    if (event.type === "final") {
      settleReady();
      settleDone({
        ok: true,
        sessionId: id,
        text: lastText,
        elapsedMs: event.elapsedMs ?? Date.now() - startedAt
      });
      return;
    }
    if (event.type === "cancelled") {
      settleDone({
        ok: false,
        sessionId: id,
        error: "语音输入已取消",
        text: lastText,
        elapsedMs: event.elapsedMs ?? Date.now() - startedAt
      });
      return;
    }
    if (event.type === "error") {
      const error = new Error(event.error || "系统语音输入失败");
      settleReady(error);
      settleDone({
        ok: false,
        sessionId: id,
        error: error.message,
        text: lastText,
        elapsedMs: event.elapsedMs ?? Date.now() - startedAt
      });
    }
  };
  const handleOutputChunk = (chunk: string) => {
    stdoutBuffer += chunk;
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() ?? "";
    for (const line of lines) {
      const event = parseSpeechHelperLine(line);
      if (event) {
        handleEvent(event);
      }
    }
  };
  const pollOutputFile = async () => {
    if (!launched.outputFile || outputPollRunning || disposed) {
      return;
    }
    outputPollRunning = true;
    try {
      const text = await readFile(launched.outputFile, "utf8");
      if (text.length > outputFileOffset) {
        handleOutputChunk(text.slice(outputFileOffset));
        outputFileOffset = text.length;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        console.warn("[system-speech] 读取系统语音 helper 输出文件失败", {
          sessionId: id,
          outputFile: launched.outputFile,
          error: messageFromError(error)
        });
      }
    } finally {
      outputPollRunning = false;
    }
  };

  if (launched.outputFile) {
    outputPollTimer = setInterval(() => {
      void pollOutputFile();
    }, 50);
    void pollOutputFile();
  }

  child.stdout?.on("data", (chunk) => {
    handleOutputChunk(String(chunk));
  });
  child.stderr?.on("data", (chunk) => {
    stderrTail = `${stderrTail}${String(chunk)}`.slice(-2_000);
  });
  child.on("error", (error) => {
    if (disposed) {
      return;
    }
    settleReady(error);
    settleDone({
      ok: false,
      sessionId: id,
      error: error.message,
      text: lastText,
      elapsedMs: Date.now() - startedAt
    });
  });
  const handleChildExit = (code: number | null, signal: NodeJS.Signals | null) => {
    if (disposed) {
      return;
    }
    const pendingEvent = parseSpeechHelperLine(stdoutBuffer);
    if (pendingEvent) {
      handleEvent(pendingEvent);
    }
    if (!readySettled || !doneSettled) {
      const message =
        code === 0 && lastText
          ? "系统语音 helper 已退出"
          : `系统语音 helper 异常退出 code=${code ?? "null"} signal=${signal ?? "null"}`;
      const detail = stderrTail.trim();
      const error = detail ? `${message}: ${detail}` : message;
      console.debug("[system-speech] 系统语音 helper 子进程退出", {
        sessionId: id,
        launchMode: launched.launchMode,
        code,
        signal,
        elapsedMs: Date.now() - startedAt,
        stderr: detail || undefined
      });
      if (!readySettled) {
        settleReady(new Error(error));
      }
      if (!doneSettled) {
        settleDone({
          ok: code === 0 && stopRequested,
          sessionId: id,
          ...(code === 0 && stopRequested ? { text: lastText } : { error, text: lastText }),
          elapsedMs: Date.now() - startedAt
        } as SystemSpeechStopResult);
      }
    }
  };
  child.on("exit", (code, signal) => {
    if (launched.launchMode === "appBundle") {
      void pollOutputFile().finally(() => {
        if (disposed) {
          return;
        }
        if (code === 0 && signal === null) {
          console.debug("[system-speech] LaunchServices 已交出系统语音 helper，继续等待输出文件", {
            sessionId: id,
            helper: launched.helperPath,
            outputFile: launched.outputFile,
            elapsedMs: Date.now() - startedAt
          });
          return;
        }
        handleChildExit(code, signal);
      });
      return;
    }
    handleChildExit(code, signal);
  });

  return {
    id,
    language,
    helperPath: launched.helperPath,
    launchMode: launched.launchMode,
    child,
    startedAt,
    ready,
    done,
    get stopRequested() {
      return stopRequested;
    },
    set stopRequested(value: boolean) {
      stopRequested = value;
    },
    get lastText() {
      return lastText;
    },
    get stderrTail() {
      return stderrTail;
    },
    stop() {
      launched.send("stop");
    },
    cancel() {
      launched.send("cancel");
      setTimeout(() => {
        if (launched.launchMode === "direct") {
          launched.terminate();
        }
      }, 250);
    },
    dispose(delayMs = 0) {
      disposed = true;
      cleanupLaunched(delayMs);
    }
  };
}

function resolveDarwinHelperCommand(
  options: SystemSpeechRuntimeOptions,
  mode: "availability" | "recognize",
  language: string
): HelperCommand | undefined {
  const commonArgs =
    mode === "availability"
      ? [mode, "--lang", language]
      : [mode, "--lang", language, "--max-seconds", String(MAX_RECOGNITION_SECONDS)];
  if (options.darwinHelperPath) {
    return existsSync(options.darwinHelperPath)
      ? {
          command: options.darwinHelperPath,
          args: [...(options.darwinHelperArgsPrefix ?? []), ...commonArgs],
          appBundle: options.darwinHelperAppBundle
        }
      : undefined;
  }
  if (options.isPackaged) {
    const appBundle = join(
      options.resourcesPath,
      "system-speech",
      "darwin",
      "SystemSpeechHelper.app"
    );
    const binary = join(
      appBundle,
      "Contents",
      "MacOS",
      "system-speech-helper"
    );
    return existsSync(binary) ? { command: binary, args: commonArgs, appBundle } : undefined;
  }

  const root = projectRoot();
  const appBundle = join(
    root,
    "apps",
    "desktop",
    "build",
    "system-speech",
    "darwin",
    "SystemSpeechHelper.app"
  );
  const compiled = join(
    appBundle,
    "Contents",
    "MacOS",
    "system-speech-helper"
  );
  if (existsSync(compiled)) {
    return { command: compiled, args: commonArgs, appBundle };
  }
  return undefined;
}

async function launchHelper(helper: HelperCommand, label: string): Promise<LaunchedHelper> {
  if (helper.appBundle) {
    const tempDir = await mkdtemp(join(tmpdir(), "cxb-system-speech-"));
    const outputFile = join(tempDir, "events.jsonl");
    const controlFile = join(tempDir, "control.txt");
    await writeFile(outputFile, "", "utf8");
    await writeFile(controlFile, "", "utf8");
    const openArgs = [
      "-n",
      helper.appBundle,
      "--args",
      ...helper.args,
      "--output-file",
      outputFile,
      "--control-file",
      controlFile
    ];
    const child = spawn("open", openArgs, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    console.debug("[system-speech] 通过 LaunchServices 启动系统语音 helper", {
      label,
      helper: helper.command,
      appBundle: helper.appBundle,
      outputFile,
      controlFile,
      pid: child.pid
    });
    return {
      child,
      helperPath: helper.command,
      launchMode: "appBundle",
      outputFile,
      controlFile,
      send(command) {
        void appendFile(controlFile, `${command}\n`, "utf8").catch((error) => {
          console.warn("[system-speech] 写入系统语音 helper 控制文件失败", {
            label,
            command,
            controlFile,
            error: messageFromError(error)
          });
        });
      },
      terminate() {
        if (!child.killed) {
          child.kill("SIGTERM");
        }
      },
      cleanup: async () => {
        await rm(tempDir, { recursive: true, force: true });
      }
    };
  }

  const child = spawn(helper.command, helper.args, {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true
  });
  console.debug("[system-speech] 启动系统语音 helper 子进程", {
    label,
    helper: helper.command,
    appBundle: helper.appBundle,
    pid: child.pid
  });
  return {
    child,
    helperPath: helper.command,
    launchMode: "direct",
    send(command) {
      if (child.stdin && !child.stdin.destroyed) {
        child.stdin.write(`${command}\n`);
      }
    },
    terminate() {
      if (!child.killed) {
        child.kill("SIGTERM");
      }
    },
    cleanup: async () => {}
  };
}

function normalizeSpeechInput(input: unknown): { language: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { language: DEFAULT_LANGUAGE };
  }
  const language = (input as Record<string, unknown>).language;
  return {
    language: typeof language === "string" && language.trim() ? language : DEFAULT_LANGUAGE
  };
}

function normalizeSessionInput(input: unknown): { sessionId?: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }
  const sessionId = (input as Record<string, unknown>).sessionId;
  return typeof sessionId === "string" && sessionId.trim() ? { sessionId } : {};
}

function projectRoot(): string {
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

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  createError: () => Error
): Promise<T> {
  return new Promise<T>((resolveTimeout, rejectTimeout) => {
    const timer = setTimeout(() => {
      rejectTimeout(createError());
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolveTimeout(value);
      },
      (error) => {
        clearTimeout(timer);
        rejectTimeout(error);
      }
    );
  });
}

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
