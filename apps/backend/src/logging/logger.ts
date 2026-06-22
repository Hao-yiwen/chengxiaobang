import { AsyncLocalStorage } from "node:async_hooks";
import { inspect } from "node:util";
import pino, { type Logger } from "pino";
import { createId } from "@chengxiaobang/shared";

export type BackendLogLevel = "debug" | "info" | "warn" | "error";

export interface BackendLogContext {
  requestId?: string;
  sessionId?: string;
  runId?: string;
  clientRequestId?: string;
  toolCallId?: string;
  toolName?: string;
  providerId?: string;
  model?: string;
  method?: string;
  path?: string;
  module?: string;
  action?: string;
}

export type BackendLogFields = BackendLogContext & Record<string, unknown>;

export interface BackendLogger {
  debug(message: string, fields?: BackendLogFields): void;
  debug(...args: unknown[]): void;
  info(message: string, fields?: BackendLogFields): void;
  info(...args: unknown[]): void;
  warn(message: string, fields?: BackendLogFields): void;
  warn(...args: unknown[]): void;
  error(message: string, fields?: BackendLogFields): void;
  error(...args: unknown[]): void;
}

type PinoLikeLogger = Pick<Logger, BackendLogLevel>;

const contextStorage = new AsyncLocalStorage<BackendLogContext>();

const defaultPinoLogger = pino({
  level: resolveBackendLogLevel(),
  base: {
    source: "backend",
    pid: process.pid
  },
  timestamp: pino.stdTimeFunctions.isoTime
});

let activeLogger: PinoLikeLogger = defaultPinoLogger;

export function getLogger(defaultFields: BackendLogFields = {}): BackendLogger {
  const cleanedDefaults = cleanFields(defaultFields);
  return {
    debug: (...args) => writeLog("debug", cleanedDefaults, args),
    info: (...args) => writeLog("info", cleanedDefaults, args),
    warn: (...args) => writeLog("warn", cleanedDefaults, args),
    error: (...args) => writeLog("error", cleanedDefaults, args)
  };
}

export function withLogContext<T>(context: BackendLogContext, callback: () => T): T {
  return contextStorage.run(mergeContext(currentLogContext(), context), callback);
}

export function bindLogContext(context: BackendLogContext): void {
  const current = contextStorage.getStore();
  if (current) {
    Object.assign(current, cleanFields(context));
    return;
  }
  contextStorage.enterWith(cleanFields(context));
}

export function currentLogContext(): BackendLogContext {
  return { ...(contextStorage.getStore() ?? {}) };
}

export function createRequestId(): string {
  return createId("req");
}

export function errorToLogFields(error: unknown): BackendLogFields {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorMessage: error.message,
      ...(error.stack ? { errorStack: error.stack } : {})
    };
  }
  return { errorMessage: stringifyUnknown(error) };
}

export function setBackendLoggerForTest(logger: PinoLikeLogger): () => void {
  const previous = activeLogger;
  activeLogger = logger;
  return () => {
    activeLogger = previous;
  };
}

export function resetLogContextForTest(): void {
  contextStorage.enterWith({});
}

function writeLog(
  level: BackendLogLevel,
  defaultFields: BackendLogFields,
  args: unknown[]
): void {
  const { message, fields } = normalizeLogArgs(args);
  const payload = normalizeFields({
    ...currentLogContext(),
    ...defaultFields,
    ...fields
  });
  activeLogger[level](payload, message);
}

function normalizeLogArgs(args: unknown[]): { message: string; fields: BackendLogFields } {
  const [first, ...rest] = args;
  const message = typeof first === "string" ? first : stringifyUnknown(first);
  if (rest.length === 0) {
    return { message, fields: {} };
  }
  if (rest.length === 1 && isFieldRecord(rest[0])) {
    return { message, fields: rest[0] as BackendLogFields };
  }
  const fields: BackendLogFields = { args: rest.map((value) => stringifyUnknown(value)) };
  const error = rest.find((value) => value instanceof Error);
  if (error) {
    Object.assign(fields, errorToLogFields(error));
  }
  return { message, fields };
}

function resolveBackendLogLevel(): BackendLogLevel | "silent" {
  if (process.env.VITEST) {
    return "silent";
  }
  return process.env.CHENGXIAOBANG_LOG_LEVEL === "debug" ? "debug" : "info";
}

function mergeContext(
  current: BackendLogContext,
  next: BackendLogContext
): BackendLogContext {
  return {
    ...current,
    ...cleanFields(next)
  };
}

function cleanFields<T extends object>(fields: T): T {
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined)
  ) as T;
}

function isFieldRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && !(value instanceof Error);
}

function normalizeFields(fields: BackendLogFields): BackendLogFields {
  const normalized: BackendLogFields = {};
  for (const [key, value] of Object.entries(cleanFields(fields))) {
    if (key === "error") {
      Object.assign(normalized, errorToLogFields(value));
      continue;
    }
    normalized[key] = value instanceof Error ? errorToLogFields(value) : value;
  }
  return normalized;
}

function stringifyUnknown(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  return inspect(value, { depth: 5, breakLength: Infinity });
}
