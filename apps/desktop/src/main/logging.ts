import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
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

export const LOG_ROTATION_HOURS = 3;

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
  now?: () => Date;
} = {}): DesktopLoggers {
  const logDir = options.logDir ?? defaultLogDir();
  const level = options.level ?? resolveLogLevel();
  const now = options.now ?? (() => new Date());
  mkdirSync(logDir, { recursive: true });

  const main = createFileLogger("main", logDir, level, now);
  const renderer = createFileLogger("renderer", logDir, level, now);
  const backend = createFileLogger("backend", logDir, level, now);

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

export function logDateSegment(date: Date): string {
  return [
    String(date.getFullYear()),
    padTwoDigits(date.getMonth() + 1),
    padTwoDigits(date.getDate())
  ].join("-");
}

export function logTimeSegmentLabel(date: Date): string {
  const startHour = Math.floor(date.getHours() / LOG_ROTATION_HOURS) * LOG_ROTATION_HOURS;
  return `${padTwoDigits(startHour)}-${padTwoDigits(startHour + LOG_ROTATION_HOURS)}`;
}

export function logFilePath(source: LogSource, logDir: string, date: Date): string {
  return join(logDir, logDateSegment(date), logTimeSegmentLabel(date), LOG_FILE_NAMES[source]);
}

function createFileLogger(
  source: LogSource,
  logDir: string,
  level: LogLevelName,
  now: () => Date
): Logger {
  return pino(
    {
      level,
      base: {
        pid: process.pid,
        source
      },
      timestamp: pino.stdTimeFunctions.isoTime
    },
    new RotatingLogDestination(source, logDir, now)
  );
}

type PinoFileDestination = ReturnType<typeof pino.destination>;

class RotatingLogDestination {
  private active:
    | {
        path: string;
        destination: PinoFileDestination;
      }
    | undefined;

  private readonly closingDestinations = new Set<PinoFileDestination>();

  constructor(
    private readonly source: LogSource,
    private readonly logDir: string,
    private readonly now: () => Date
  ) {}

  write(message: string): void {
    const destination = this.resolveActiveDestination();
    destination.write(message);
  }

  flush(callback?: (err?: Error) => void): void {
    const destinations = [
      ...(this.active ? [this.active.destination] : []),
      ...Array.from(this.closingDestinations)
    ];
    if (destinations.length === 0) {
      callback?.();
      return;
    }

    let pending = destinations.length;
    let firstError: Error | undefined;
    const done = (error?: Error) => {
      firstError ??= error;
      pending -= 1;
      if (pending === 0) {
        callback?.(firstError);
      }
    };

    for (const destination of destinations) {
      try {
        destination.flush(done);
      } catch (error) {
        done(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  private resolveActiveDestination(): PinoFileDestination {
    const nextPath = logFilePath(this.source, this.logDir, this.now());
    if (this.active?.path === nextPath) {
      return this.active.destination;
    }

    const previous = this.active;
    try {
      mkdirSync(dirname(nextPath), { recursive: true });
      const destination = pino.destination({
        dest: nextPath,
        minLength: 0,
        sync: false
      });
      // 成功创建新分片目标后再关闭旧目标:避免新目标创建失败时旧目标已被关闭、无处可写。
      if (previous) {
        this.closeDestination(previous.destination);
      }
      this.active = { path: nextPath, destination };
      return destination;
    } catch (error) {
      // 切片目录创建/打开失败(如磁盘满):退回上一个目标继续写并告警,而不是抛错丢日志。
      writeTerminalLog(
        "error",
        "[logging] 切换日志分片失败，继续沿用上一个日志目标",
        { source: this.source, nextPath, error: error instanceof Error ? error.message : String(error) }
      );
      if (previous) {
        return previous.destination;
      }
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  private closeDestination(destination: PinoFileDestination): void {
    this.closingDestinations.add(destination);
    const finish = () => {
      this.closingDestinations.delete(destination);
      destination.end();
    };
    try {
      destination.flush(finish);
    } catch {
      finish();
    }
  }
}

function padTwoDigits(value: number): string {
  return String(value).padStart(2, "0");
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
