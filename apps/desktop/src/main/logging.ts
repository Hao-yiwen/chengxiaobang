import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { inspect } from "node:util";
import pino, { type Logger } from "pino";
import { defaultLogDir } from "./paths";

export const LOG_FILE_NAMES = {
  main: "main.log",
  renderer: "renderer.log",
  backend: "backend.log"
} as const;

export type LogSource = keyof typeof LOG_FILE_NAMES;
export type LogLevelName = "debug" | "info" | "warn" | "error";

export interface LogWriter {
  debug(fields: Record<string, unknown>, message: string): void;
  info(fields: Record<string, unknown>, message: string): void;
  warn(fields: Record<string, unknown>, message: string): void;
  error(fields: Record<string, unknown>, message: string): void;
}

export type TerminalLogWriter = Pick<Console, "debug" | "info" | "warn" | "error">;

export interface DesktopLoggers {
  logDir: string;
  level: LogLevelName;
  main: Logger;
  renderer: Logger;
  backend: Logger;
  flush(): Promise<void>;
  restoreConsole(): void;
}

export interface RendererConsoleEvent {
  level: number;
  message: string;
  line: number;
  sourceId: string;
}

const terminalConsole: TerminalLogWriter = {
  debug: console.debug.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console)
};

let activeLoggers: DesktopLoggers | undefined;

export function resolveLogLevel(env: NodeJS.ProcessEnv = process.env): LogLevelName {
  return env.CHENGXIAOBANG_LOG_LEVEL === "debug" ? "debug" : "info";
}

export function createDesktopLoggers(options: {
  logDir?: string;
  level?: LogLevelName;
} = {}): DesktopLoggers {
  const logDir = options.logDir ?? defaultLogDir();
  const level = options.level ?? resolveLogLevel();
  mkdirSync(logDir, { recursive: true });

  const main = createFileLogger("main", logDir, level);
  const renderer = createFileLogger("renderer", logDir, level);
  const backend = createFileLogger("backend", logDir, level);

  return {
    logDir,
    level,
    main,
    renderer,
    backend,
    flush: () => flushLoggers([main, renderer, backend]),
    restoreConsole: () => undefined
  };
}

export function initializeDesktopLogging(options: {
  logDir?: string;
  env?: NodeJS.ProcessEnv;
} = {}): DesktopLoggers | undefined {
  if (activeLoggers) {
    return activeLoggers;
  }
  try {
    const loggers = createDesktopLoggers({
      logDir: options.logDir,
      level: resolveLogLevel(options.env)
    });
    const restoreConsole = installConsoleFileLogging(loggers.main);
    activeLoggers = { ...loggers, restoreConsole };
    return activeLoggers;
  } catch (error) {
    writeTerminalLog("error", "[main] 日志初始化失败:", error);
    return undefined;
  }
}

export function getDesktopLoggers(): DesktopLoggers | undefined {
  return activeLoggers;
}

export function installConsoleFileLogging(
  logger: LogWriter,
  target: TerminalLogWriter = console
): () => void {
  const mutableTarget = target as Record<keyof TerminalLogWriter, (...args: unknown[]) => void>;
  const originals: TerminalLogWriter = {
    debug: target.debug.bind(target),
    info: target.info.bind(target),
    warn: target.warn.bind(target),
    error: target.error.bind(target)
  };

  for (const level of ["debug", "info", "warn", "error"] as const) {
    mutableTarget[level] = (...args: unknown[]) => {
      originals[level](...args);
      writeStructuredLog(logger, level, { args: args.map(formatConsoleArg) }, formatConsoleArgs(args));
    };
  }

  return () => {
    mutableTarget.debug = originals.debug.bind(target);
    mutableTarget.info = originals.info.bind(target);
    mutableTarget.warn = originals.warn.bind(target);
    mutableTarget.error = originals.error.bind(target);
  };
}

export function writeTerminalLog(level: LogLevelName, ...args: unknown[]): void {
  terminalConsole[level](...args);
}

export function rendererConsoleLogLevel(level: number): LogLevelName {
  if (level >= 3) {
    return "error";
  }
  if (level === 2) {
    return "warn";
  }
  if (level === 0) {
    return "debug";
  }
  return "info";
}

export function logRendererConsole(
  logger: LogWriter | undefined,
  event: RendererConsoleEvent
): void {
  writeStructuredLog(
    logger,
    rendererConsoleLogLevel(event.level),
    {
      chromiumLevel: event.level,
      line: event.line,
      sourceId: event.sourceId
    },
    event.message
  );
}

export function writeStructuredLog(
  logger: LogWriter | undefined,
  level: LogLevelName,
  fields: Record<string, unknown>,
  message: string
): void {
  if (!logger) {
    return;
  }
  try {
    logger[level](fields, message);
  } catch (error) {
    writeTerminalLog("error", "[main] 写入日志失败:", error);
  }
}

export function formatConsoleArgs(args: unknown[]): string {
  return args.map(formatConsoleArg).join(" ");
}

export function formatConsoleArg(arg: unknown): string {
  if (typeof arg === "string") {
    return arg;
  }
  if (arg instanceof Error) {
    return arg.stack || arg.message;
  }
  return inspect(arg, { depth: 5, breakLength: Infinity });
}

function createFileLogger(source: LogSource, logDir: string, level: LogLevelName): Logger {
  return pino(
    {
      level,
      base: {
        pid: process.pid,
        source
      },
      timestamp: pino.stdTimeFunctions.isoTime
    },
    pino.destination({
      dest: join(logDir, LOG_FILE_NAMES[source]),
      minLength: 0,
      sync: false
    })
  );
}

async function flushLoggers(loggers: Logger[]): Promise<void> {
  await Promise.all(loggers.map((logger) => flushLogger(logger)));
}

function flushLogger(logger: Logger): Promise<void> {
  return new Promise((resolve) => {
    try {
      logger.flush(() => resolve());
    } catch {
      resolve();
    }
  });
}
