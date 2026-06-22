import type { BackendLogLevel } from "../../src/logging/logger";
import {
  resetLogContextForTest,
  setBackendLoggerForTest
} from "../../src/logging/logger";

export interface CapturedBackendLog {
  level: BackendLogLevel;
  fields: Record<string, unknown>;
  message: string;
}

export function captureBackendLogs(): {
  entries: CapturedBackendLog[];
  restore: () => void;
} {
  const entries: CapturedBackendLog[] = [];
  const logger = {
    debug: (fields: Record<string, unknown>, message: string) => {
      entries.push({ level: "debug", fields, message });
    },
    info: (fields: Record<string, unknown>, message: string) => {
      entries.push({ level: "info", fields, message });
    },
    warn: (fields: Record<string, unknown>, message: string) => {
      entries.push({ level: "warn", fields, message });
    },
    error: (fields: Record<string, unknown>, message: string) => {
      entries.push({ level: "error", fields, message });
    }
  };
  const restoreLogger = setBackendLoggerForTest(
    logger as unknown as Parameters<typeof setBackendLoggerForTest>[0]
  );
  resetLogContextForTest();
  return {
    entries,
    restore: () => {
      restoreLogger();
      resetLogContextForTest();
    }
  };
}
