import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendBackendStartupOutput,
  createBackendStartupDiagnostics,
  formatBackendStartupFailure,
  logBackendChunk,
  resolveBackendCommand,
  resolveBackendStartTimeoutMs
} from "../src/main/backend-process";
import type { LogLevelName, LogWriter, TerminalLogWriter } from "../src/main/logging";

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

describe("resolveBackendCommand", () => {
  const previousBunBinary = process.env.BUN_BINARY;
  const tempDirs: string[] = [];

  afterEach(async () => {
    if (previousBunBinary === undefined) {
      delete process.env.BUN_BINARY;
    } else {
      process.env.BUN_BINARY = previousBunBinary;
    }
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("uses explicit Bun binary when provided", () => {
    process.env.BUN_BINARY = "/tmp/bun";

    const command = resolveBackendCommand({
      port: 3210,
      dataDir: "/tmp/data",
      token: "token",
      resourcesPath: "/tmp/resources",
      isPackaged: false
    });

    expect(command.command).toBe("/tmp/bun");
    expect(command.args).toContain("--watch");
    expect(command.args).toContain("--no-orphans");
    expect(command.args).toContain("--data-dir");
    expect(command.args).toContain("/tmp/data");
    expect(command.args).toContain("--token");
    expect(command.args).toContain("token");
  });

  it("uses workspace Bun in development", () => {
    delete process.env.BUN_BINARY;

    const command = resolveBackendCommand({
      port: 3210,
      dataDir: "/tmp/data",
      token: "token",
      resourcesPath: "/tmp/resources",
      isPackaged: false
    });

    expect(command.command).toBe(resolve(process.cwd(), "node_modules/bun/bin/bun.exe"));
    expect(command.args[0]).toBe("--no-orphans");
    expect(command.args[1]).toBe("--watch");
  });

  it("uses bundled Bun in packaged builds", async () => {
    delete process.env.BUN_BINARY;
    const resourcesPath = await mkdtemp(join(tmpdir(), "cxb-resources-"));
    tempDirs.push(resourcesPath);
    await writeFile(join(resourcesPath, "bun"), "");

    const command = resolveBackendCommand({
      port: 3210,
      dataDir: "/tmp/data",
      token: "token",
      resourcesPath,
      isPackaged: true
    });

    expect(command.command).toBe(join(resourcesPath, "bun"));
    expect(command.args).not.toContain("--watch");
  });

  it("fails clearly when packaged Bun is missing", async () => {
    delete process.env.BUN_BINARY;
    const resourcesPath = await mkdtemp(join(tmpdir(), "cxb-resources-"));
    tempDirs.push(resourcesPath);

    expect(() =>
      resolveBackendCommand({
        port: 3210,
        dataDir: "/tmp/data",
        token: "token",
        resourcesPath,
        isPackaged: true
      })
    ).toThrow("后端运行时缺失");
  });

  it("logs backend process output line by line with stream context", () => {
    const { logger, entries } = createMockLogger();
    const terminalCalls: Array<{ level: LogLevelName; message: string }> = [];
    const terminal: TerminalLogWriter = {
      debug: (message) => terminalCalls.push({ level: "debug", message: String(message) }),
      info: (message) => terminalCalls.push({ level: "info", message: String(message) }),
      warn: (message) => terminalCalls.push({ level: "warn", message: String(message) }),
      error: (message) => terminalCalls.push({ level: "error", message: String(message) })
    };

    logBackendChunk("stdout", Buffer.from("ready\nlistening\n"), {
      logger,
      terminal,
      port: 3456,
      pid: 789
    });
    logBackendChunk("stderr", "warning\n", {
      logger,
      terminal,
      port: 3456,
      pid: 789
    });

    expect(entries).toEqual([
      {
        level: "info",
        fields: { stream: "stdout", port: 3456, pid: 789 },
        message: "ready"
      },
      {
        level: "info",
        fields: { stream: "stdout", port: 3456, pid: 789 },
        message: "listening"
      },
      {
        level: "warn",
        fields: { stream: "stderr", port: 3456, pid: 789 },
        message: "warning"
      }
    ]);
    expect(terminalCalls).toEqual([
      { level: "info", message: "[chengxiaobang-backend] ready" },
      { level: "info", message: "[chengxiaobang-backend] listening" },
      { level: "warn", message: "[chengxiaobang-backend] warning" }
    ]);
  });

  it("uses a longer backend startup timeout and allows env override", () => {
    expect(resolveBackendStartTimeoutMs({})).toBe(45_000);
    expect(
      resolveBackendStartTimeoutMs({
        CHENGXIAOBANG_BACKEND_START_TIMEOUT_MS: "90000"
      })
    ).toBe(90_000);
    expect(
      resolveBackendStartTimeoutMs({
        CHENGXIAOBANG_BACKEND_START_TIMEOUT_MS: "bad"
      })
    ).toBe(45_000);
  });

  it("formats backend startup failures with health and output diagnostics", () => {
    const diagnostics = createBackendStartupDiagnostics({
      command: {
        command: "/tmp/bun",
        args: ["--watch", "/repo/apps/backend/src/main.ts", "--port", "30503"],
        env: {}
      },
      port: 30503,
      dataDir: "/tmp/cxb-data",
      timeoutMs: 60_000
    });
    diagnostics.lastHealthError = "fetch failed";
    diagnostics.spawnError = "spawn EACCES";
    appendBackendStartupOutput(diagnostics, "stdout", "booting\nstill booting\n");
    appendBackendStartupOutput(diagnostics, "stderr", "database locked\n");

    const message = formatBackendStartupFailure("后端启动超时", diagnostics, {
      pid: 1234,
      exitCode: null,
      signalCode: null
    });

    expect(message).toContain("后端启动超时（port=30503, pid=1234, timeout=60000ms）");
    expect(message).toContain("command=/tmp/bun --watch /repo/apps/backend/src/main.ts --port 30503");
    expect(message).toContain("lastHealthError=fetch failed");
    expect(message).toContain("spawnError=spawn EACCES");
    expect(message).toContain("backend stdout tail");
    expect(message).toContain("booting");
    expect(message).toContain("backend stderr tail");
    expect(message).toContain("database locked");
  });
});
