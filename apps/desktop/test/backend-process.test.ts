import { EventEmitter } from "node:events";
import { chmod, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { ChildProcess } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  appendBackendStartupOutput,
  checkBackendRuntime,
  createBackendStartupDiagnostics,
  formatBackendStartupFailure,
  logBackendChunk,
  prepareBackendRuntimeCommand,
  resolveBackendCommand,
  resolveBackendStartTimeoutMs,
  stopBackendChild
} from "../src/main/backend-process";
import type { LogLevelName, LogWriter, TerminalLogWriter } from "../src/main/logging";

interface LogEntry {
  level: LogLevelName;
  fields: Record<string, unknown>;
  message: string;
}

interface MockBackendChild extends EventEmitter {
  pid: number;
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  kill: ReturnType<typeof vi.fn>;
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

function createMockBackendChild(pid = 4321): MockBackendChild {
  const child = new EventEmitter() as MockBackendChild;
  child.pid = pid;
  child.exitCode = null;
  child.signalCode = null;
  child.kill = vi.fn(() => true);
  return child;
}

describe("resolveBackendCommand", () => {
  const previousBunBinary = process.env.BUN_BINARY;
  const previousRgPath = process.env.CHENGXIAOBANG_RG_PATH;
  const previousModelDebug = process.env.CHENGXIAOBANG_MODEL_DEBUG;
  const tempDirs: string[] = [];

  afterEach(async () => {
    vi.useRealTimers();
    if (previousBunBinary === undefined) {
      delete process.env.BUN_BINARY;
    } else {
      process.env.BUN_BINARY = previousBunBinary;
    }
    if (previousRgPath === undefined) {
      delete process.env.CHENGXIAOBANG_RG_PATH;
    } else {
      process.env.CHENGXIAOBANG_RG_PATH = previousRgPath;
    }
    if (previousModelDebug === undefined) {
      delete process.env.CHENGXIAOBANG_MODEL_DEBUG;
    } else {
      process.env.CHENGXIAOBANG_MODEL_DEBUG = previousModelDebug;
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
    expect(command.args).toContain("--parent-pid");
    expect(command.args).toContain(String(process.pid));
  });

  it("enables model debug only for development backend launches", async () => {
    process.env.BUN_BINARY = "/tmp/bun";
    process.env.CHENGXIAOBANG_RG_PATH = "/tmp/rg";
    process.env.CHENGXIAOBANG_MODEL_DEBUG = "1";
    const resourcesPath = await mkdtemp(join(tmpdir(), "cxb-resources-"));
    tempDirs.push(resourcesPath);
    await writeFile(join(resourcesPath, "rg"), "");

    const dev = resolveBackendCommand({
      port: 3210,
      dataDir: "/tmp/data",
      token: "token",
      resourcesPath,
      isPackaged: false
    });
    const packaged = resolveBackendCommand({
      port: 3210,
      dataDir: "/tmp/data",
      token: "token",
      resourcesPath,
      isPackaged: true
    });

    expect(dev.env.CHENGXIAOBANG_MODEL_DEBUG).toBe("1");
    expect(packaged.env.CHENGXIAOBANG_MODEL_DEBUG).toBeUndefined();
  });

  it("passes OCR service connection details to the backend", () => {
    process.env.BUN_BINARY = "/tmp/bun";

    const command = resolveBackendCommand({
      port: 3210,
      dataDir: "/tmp/data",
      token: "token",
      resourcesPath: "/tmp/resources",
      isPackaged: false,
      ocrService: { url: "http://127.0.0.1:4567", token: "ocr-token" }
    });

    expect(command.args).toContain("--ocr-service-url");
    expect(command.args).toContain("http://127.0.0.1:4567");
    expect(command.args).toContain("--ocr-service-token");
    expect(command.args).toContain("ocr-token");
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

  it("copies workspace Bun to the runtime cache before development launch", async () => {
    delete process.env.BUN_BINARY;
    const tempDir = await mkdtemp(join(tmpdir(), "cxb-runtime-cache-"));
    tempDirs.push(tempDir);
    const sourceDir = join(tempDir, "node_modules/bun/bin");
    await mkdir(sourceDir, { recursive: true });
    const sourceBun = join(sourceDir, "bun.exe");
    await writeFile(sourceBun, "#!/bin/sh\necho 1.2.3\n");
    await chmod(sourceBun, 0o755);

    const command = prepareBackendRuntimeCommand(
      {
        command: sourceBun,
        args: ["--watch"],
        env: process.env
      },
      { dataDir: join(tempDir, "data"), isPackaged: false, signRuntime: false }
    );

    expect(command.command).toContain(join(tempDir, "data/runtime/bun-dev-"));
    expect(command.command).not.toBe(sourceBun);
    if (process.platform !== "win32") {
      await expect(checkBackendRuntime(command, { timeoutMs: 1_000 })).resolves.toMatchObject({
        version: "1.2.3"
      });
    }
  });

  it("reuses a prepared runtime cache even when signing changed its size", async () => {
    delete process.env.BUN_BINARY;
    const tempDir = await mkdtemp(join(tmpdir(), "cxb-runtime-cache-"));
    tempDirs.push(tempDir);
    const sourceDir = join(tempDir, "node_modules/bun/bin");
    const dataDir = join(tempDir, "data");
    await mkdir(sourceDir, { recursive: true });
    const sourceBun = join(sourceDir, "bun.exe");
    await writeFile(sourceBun, "#!/bin/sh\necho source\n");
    await chmod(sourceBun, 0o755);

    const sourceStat = await stat(sourceBun);
    const runtimeDir = join(dataDir, "runtime");
    const extension = process.platform === "win32" ? ".exe" : "";
    const target = join(
      runtimeDir,
      `bun-dev-${process.platform}-${process.arch}-${sourceStat.size}${extension}`
    );
    await mkdir(runtimeDir, { recursive: true });
    await writeFile(target, "#!/bin/sh\necho signed-cache\n");
    await chmod(target, 0o755);
    await writeFile(target + ".adhoc-signature", `adhoc-v2:${sourceStat.size}:${sourceStat.mtimeMs}`);

    const command = prepareBackendRuntimeCommand(
      {
        command: sourceBun,
        args: ["--watch"],
        env: process.env
      },
      { dataDir, isPackaged: false, signRuntime: false }
    );

    expect(command.command).toBe(target);
    if (process.platform !== "win32") {
      await expect(checkBackendRuntime(command, { timeoutMs: 1_000 })).resolves.toMatchObject({
        version: "signed-cache"
      });
    }
  });

  it("does not replace an explicit Bun binary with the runtime cache", async () => {
    process.env.BUN_BINARY = "/custom/bun";
    const tempDir = await mkdtemp(join(tmpdir(), "cxb-runtime-cache-"));
    tempDirs.push(tempDir);
    const sourceBun = join(tempDir, "node_modules/bun/bin/bun.exe");

    const command = prepareBackendRuntimeCommand(
      {
        command: sourceBun,
        args: ["--watch"],
        env: process.env
      },
      { dataDir: join(tempDir, "data"), isPackaged: false, signRuntime: false }
    );

    expect(command.command).toBe(sourceBun);
  });

  it("falls back to the original Bun path when runtime cache preparation fails", async () => {
    delete process.env.BUN_BINARY;
    const tempDir = await mkdtemp(join(tmpdir(), "cxb-runtime-cache-"));
    tempDirs.push(tempDir);
    const sourceDir = join(tempDir, "node_modules/bun/bin");
    await mkdir(sourceDir, { recursive: true });
    const sourceBun = join(sourceDir, "bun.exe");
    const dataFile = join(tempDir, "data");
    await writeFile(sourceBun, "#!/bin/sh\necho 1.2.3\n");
    await writeFile(dataFile, "not a directory");

    const command = prepareBackendRuntimeCommand(
      {
        command: sourceBun,
        args: ["--watch"],
        env: process.env
      },
      { dataDir: dataFile, isPackaged: false, signRuntime: false }
    );

    expect(command.command).toBe(sourceBun);
  });

  it("uses bundled Bun in packaged builds", async () => {
    delete process.env.BUN_BINARY;
    const resourcesPath = await mkdtemp(join(tmpdir(), "cxb-resources-"));
    tempDirs.push(resourcesPath);
    await writeFile(join(resourcesPath, "bun"), "");
    await writeFile(join(resourcesPath, "rg"), "");

    const command = resolveBackendCommand({
      port: 3210,
      dataDir: "/tmp/data",
      token: "token",
      resourcesPath,
      isPackaged: true,
      platform: "darwin"
    });

    expect(command.command).toBe(join(resourcesPath, "bun"));
    expect(command.env.CHENGXIAOBANG_RG_PATH).toBe(join(resourcesPath, "rg"));
    expect(command.args).not.toContain("--watch");
  });

  it("uses bundled bun.exe in Windows packaged builds", async () => {
    delete process.env.BUN_BINARY;
    const resourcesPath = await mkdtemp(join(tmpdir(), "cxb-resources-"));
    tempDirs.push(resourcesPath);
    await writeFile(join(resourcesPath, "bun.exe"), "");
    await writeFile(join(resourcesPath, "rg.exe"), "");

    const command = resolveBackendCommand({
      port: 3210,
      dataDir: "C:\\Users\\me\\AppData\\Roaming\\cxb",
      token: "token",
      resourcesPath,
      isPackaged: true,
      platform: "win32"
    });

    expect(command.command).toBe(join(resourcesPath, "bun.exe"));
    expect(command.env.CHENGXIAOBANG_RG_PATH).toBe(join(resourcesPath, "rg.exe"));
    expect(command.args).not.toContain("--watch");
  });

  it("fails clearly when packaged ripgrep is missing", async () => {
    delete process.env.BUN_BINARY;
    const resourcesPath = await mkdtemp(join(tmpdir(), "cxb-resources-"));
    tempDirs.push(resourcesPath);
    await writeFile(join(resourcesPath, "bun"), "");

    expect(() =>
      resolveBackendCommand({
        port: 3210,
        dataDir: "/tmp/data",
        token: "token",
        resourcesPath,
        isPackaged: true,
        platform: "darwin"
      })
    ).toThrow("搜索运行时缺失");
  });

  it("checks backend runtime before launching the backend", async () => {
    const result = await checkBackendRuntime({
      command: process.execPath,
      args: [],
      env: process.env
    });

    expect(result.version).toBe(process.version);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("fails backend runtime check quickly when the runtime hangs", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "cxb-runtime-check-"));
    tempDirs.push(tempDir);
    const scriptPath =
      process.platform === "win32" ? join(tempDir, "fake-bun.cmd") : join(tempDir, "fake-bun");
    await writeFile(
      scriptPath,
      process.platform === "win32"
        ? "@echo off\r\nping 127.0.0.1 -n 6 >nul\r\n"
        : "#!/bin/sh\nsleep 5\n"
    );
    if (process.platform !== "win32") {
      await chmod(scriptPath, 0o755);
    }

    await expect(
      checkBackendRuntime(
        {
          command: scriptPath,
          args: [],
          env: process.env
        },
        { timeoutMs: 50 }
      )
    ).rejects.toThrow(process.platform === "win32" ? "Bun 运行时自检启动失败" : "Bun 运行时自检超时");
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
        isPackaged: true,
        platform: "darwin"
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

  it("unwraps backend pino JSON lines into searchable backend log fields", () => {
    const { logger, entries } = createMockLogger();
    const terminalCalls: Array<{ level: LogLevelName; message: string }> = [];
    const terminal: TerminalLogWriter = {
      debug: (message) => terminalCalls.push({ level: "debug", message: String(message) }),
      info: (message) => terminalCalls.push({ level: "info", message: String(message) }),
      warn: (message) => terminalCalls.push({ level: "warn", message: String(message) }),
      error: (message) => terminalCalls.push({ level: "error", message: String(message) })
    };

    logBackendChunk(
      "stdout",
      `${JSON.stringify({
        level: 30,
        time: "2026-06-22T09:00:00.000Z",
        pid: 111,
        source: "backend",
        requestId: "req_1",
        sessionId: "session_1",
        runId: "run_1",
        module: "api",
        action: "request.end",
        status: 200,
        msg: "HTTP 请求结束"
      })}\n`,
      {
        logger,
        terminal,
        port: 3456,
        pid: 789
      }
    );

    expect(entries).toEqual([
      {
        level: "info",
        fields: {
          stream: "stdout",
          port: 3456,
          pid: 789,
          source: "backend",
          requestId: "req_1",
          sessionId: "session_1",
          runId: "run_1",
          module: "api",
          action: "request.end",
          status: 200,
          backendTime: "2026-06-22T09:00:00.000Z",
          backendPid: 111
        },
        message: "HTTP 请求结束"
      }
    ]);
    expect(terminalCalls).toEqual([
      { level: "info", message: "[chengxiaobang-backend] HTTP 请求结束" }
    ]);
  });

  it("force kills the backend process group if SIGTERM does not stop it", () => {
    if (process.platform === "win32") {
      return;
    }
    vi.useFakeTimers();
    const child = createMockBackendChild(4321);
    const signals: Array<{ pid: number; signal: NodeJS.Signals }> = [];

    stopBackendChild(child as unknown as ChildProcess, {
      forceKillAfterMs: 50,
      killProcess: (pid, signal) => {
        signals.push({ pid, signal });
      }
    });

    expect(signals).toEqual([{ pid: -4321, signal: "SIGTERM" }]);
    vi.advanceTimersByTime(49);
    expect(signals).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(signals).toEqual([
      { pid: -4321, signal: "SIGTERM" },
      { pid: -4321, signal: "SIGKILL" }
    ]);
  });

  it("does not force kill the backend after the child exits", () => {
    if (process.platform === "win32") {
      return;
    }
    vi.useFakeTimers();
    const child = createMockBackendChild(4321);
    const signals: Array<{ pid: number; signal: NodeJS.Signals }> = [];

    stopBackendChild(child as unknown as ChildProcess, {
      forceKillAfterMs: 50,
      killProcess: (pid, signal) => {
        signals.push({ pid, signal });
      }
    });
    child.exitCode = 0;
    child.emit("exit", 0, null);
    vi.advanceTimersByTime(50);

    expect(signals).toEqual([{ pid: -4321, signal: "SIGTERM" }]);
  });

  it("falls back to killing the backend child when process group cleanup fails", () => {
    if (process.platform === "win32") {
      return;
    }
    const child = createMockBackendChild(4321);
    const killProcess = vi.fn(() => {
      throw new Error("missing process group");
    });

    stopBackendChild(child as unknown as ChildProcess, {
      forceKillAfterMs: 0,
      killProcess
    });

    expect(killProcess).toHaveBeenCalledWith(-4321, "SIGTERM");
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("uses taskkill-style process tree cleanup on Windows", () => {
    vi.useFakeTimers();
    const child = createMockBackendChild(4321);
    const treeKills: Array<{ pid: number; force: boolean }> = [];

    stopBackendChild(child as unknown as ChildProcess, {
      platform: "win32",
      forceKillAfterMs: 50,
      killProcessTree: (pid, force) => {
        treeKills.push({ pid, force });
      }
    });

    expect(treeKills).toEqual([{ pid: 4321, force: false }]);
    vi.advanceTimersByTime(50);
    expect(treeKills).toEqual([
      { pid: 4321, force: false },
      { pid: 4321, force: true }
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
    diagnostics.runtimeCheck = {
      timeoutMs: 10_000,
      error: "Bun 运行时自检超时 timeout=10000ms stdout=<empty> stderr=<empty>"
    };
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
    expect(message).toContain("runtimeCheck=timeoutMs=10000 error=Bun 运行时自检超时");
    expect(message).toContain("backend stdout tail");
    expect(message).toContain("booting");
    expect(message).toContain("backend stderr tail");
    expect(message).toContain("database locked");
  });
});
