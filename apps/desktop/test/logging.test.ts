import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createDesktopLoggers,
  installConsoleFileLogging,
  logRendererConsole,
  rendererConsoleLogLevel,
  resolveLogLevel,
  type LogLevelName,
  type LogWriter,
  type TerminalLogWriter
} from "../src/main/logging";

interface LogEntry {
  level: LogLevelName;
  fields: Record<string, unknown>;
  message: string;
}

function createMockLogger(): { logger: LogWriter; entries: LogEntry[] } {
  const entries: LogEntry[] = [];
  const logger: LogWriter = {
    debug: (fields, message) => entries.push({ level: "debug", fields, message }),
    info: (fields, message) => entries.push({ level: "info", fields, message }),
    warn: (fields, message) => entries.push({ level: "warn", fields, message }),
    error: (fields, message) => entries.push({ level: "error", fields, message })
  };
  return { logger, entries };
}

describe("desktop logging", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("defaults to info logs and enables debug logs only through the environment", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "cxb-logs-"));
    tempDirs.push(tempDir);

    const infoLoggers = createDesktopLoggers({
      logDir: join(tempDir, "info"),
      level: resolveLogLevel({})
    });
    infoLoggers.main.debug({ marker: "debug-default" }, "debug default");
    infoLoggers.main.info({ marker: "info-default" }, "info default");
    await infoLoggers.flush();

    const infoLog = await readFile(join(tempDir, "info", "main.log"), "utf8");
    expect(infoLog).toContain("info default");
    expect(infoLog).not.toContain("debug default");

    const debugLoggers = createDesktopLoggers({
      logDir: join(tempDir, "debug"),
      level: resolveLogLevel({ CHENGXIAOBANG_LOG_LEVEL: "debug" })
    });
    debugLoggers.main.debug({ marker: "debug-enabled" }, "debug enabled");
    await debugLoggers.flush();

    const debugLog = await readFile(join(tempDir, "debug", "main.log"), "utf8");
    expect(debugLog).toContain("debug enabled");
  });

  it("maps Chromium renderer console levels to file log levels", () => {
    expect(rendererConsoleLogLevel(0)).toBe("debug");
    expect(rendererConsoleLogLevel(1)).toBe("info");
    expect(rendererConsoleLogLevel(2)).toBe("warn");
    expect(rendererConsoleLogLevel(3)).toBe("error");
    expect(rendererConsoleLogLevel(99)).toBe("error");
  });

  it("writes renderer console metadata to the renderer logger", () => {
    const { logger, entries } = createMockLogger();

    logRendererConsole(logger, {
      level: 2,
      message: "组件加载失败",
      line: 42,
      sourceId: "src/App.tsx"
    });

    expect(entries).toEqual([
      {
        level: "warn",
        fields: {
          chromiumLevel: 2,
          line: 42,
          sourceId: "src/App.tsx"
        },
        message: "组件加载失败"
      }
    ]);
  });

  it("wraps console output while preserving terminal output", () => {
    const { logger, entries } = createMockLogger();
    const terminalCalls: Array<{ level: LogLevelName; args: unknown[] }> = [];
    const terminal: TerminalLogWriter = {
      debug: (...args) => terminalCalls.push({ level: "debug", args }),
      info: (...args) => terminalCalls.push({ level: "info", args }),
      warn: (...args) => terminalCalls.push({ level: "warn", args }),
      error: (...args) => terminalCalls.push({ level: "error", args })
    };

    const restore = installConsoleFileLogging(logger, terminal);
    terminal.info("hello", { id: 1 });

    expect(terminalCalls).toEqual([{ level: "info", args: ["hello", { id: 1 }] }]);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.level).toBe("info");
    expect(entries[0]?.message).toContain("hello");
    expect(entries[0]?.fields.args).toEqual(["hello", "{ id: 1 }"]);

    restore();
    terminal.info("after restore");

    expect(entries).toHaveLength(1);
    expect(terminalCalls).toEqual([
      { level: "info", args: ["hello", { id: 1 }] },
      { level: "info", args: ["after restore"] }
    ]);
  });
});
