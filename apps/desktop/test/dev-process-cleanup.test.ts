import { describe, expect, it, vi } from "vitest";
import {
  cleanupStaleDevBackends,
  collectDevBackendCleanupTargets,
  parseWindowsProcessList,
  parseProcessList
} from "../scripts/dev-process-cleanup.mjs";

const repoRoot = "/Users/haoyiwen/Documents/ai/chengxiaobang";
const backendEntry = `${repoRoot}/apps/backend/src/main.ts`;

describe("dev-process-cleanup", () => {
  it("collects only stale dev backend Bun process groups", () => {
    const processes = parseProcessList(`
  26155 26076 26155 /Users/haoyiwen/.chengxiaobang/data/runtime/bun-dev-darwin-arm64-63096576 --no-orphans --watch ${backendEntry} --port 31031
  59085 58263 25888 Cursor Helper (Plugin): extension-host (user) chengxiaobang [1-1]
  71482     1 71482 /Users/haoyiwen/.local/bin/claude daemon run --spawned-by {"cwd":"${repoRoot}"}
  72000 71999 72000 /bin/zsh -c rg 'bun --watch ${backendEntry}'
  73000 72999 73000 /Users/haoyiwen/Documents/ai/chengxiaobang/node_modules/bun/bin/bun.exe --version
`);

    const targets = collectDevBackendCleanupTargets(processes, {
      repoRoot,
      currentPid: 99999
    });

    expect(targets.matchedProcesses.map((processInfo) => processInfo.pid)).toEqual([26155]);
    expect(targets.processGroups).toEqual([26155]);
    expect(targets.pids).toEqual([]);
  });

  it("falls back to individual pids when a matched backend is not a process-group leader", () => {
    const processes = parseProcessList(`
  12345 12222 11111 /Users/haoyiwen/Documents/ai/chengxiaobang/node_modules/bun/bin/bun.exe --watch ${backendEntry} --port 31031
`);

    const targets = collectDevBackendCleanupTargets(processes, {
      repoRoot,
      currentPid: 99999
    });

    expect(targets.processGroups).toEqual([]);
    expect(targets.pids).toEqual([12345]);
  });

  it("sends TERM before KILL for stale backend process groups", async () => {
    const killImpl = vi.fn();
    const logger = {
      log: vi.fn(),
      warn: vi.fn()
    };

    const targets = await cleanupStaleDevBackends({
      repoRoot,
      logger,
      waitMs: 0,
      platform: "darwin",
      execFileImpl: vi.fn(async () => ({
        stdout: `26155 26076 26155 /Users/haoyiwen/.chengxiaobang/data/runtime/bun-dev-darwin-arm64-63096576 --no-orphans --watch ${backendEntry} --port 31031\n`
      })),
      killImpl
    });

    expect(targets.processGroups).toEqual([26155]);
    expect(killImpl).toHaveBeenNthCalledWith(1, -26155, "SIGTERM");
    expect(killImpl).toHaveBeenNthCalledWith(2, -26155, "SIGKILL");
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("启动前清理旧后端进程"));
  });

  it("parses Windows process JSON and matches quoted Bun paths", () => {
    const windowsRepoRoot = "C:\\Users\\me\\chengxiaobang";
    const windowsBackendEntry = `${windowsRepoRoot}\\apps\\backend\\src\\main.ts`;
    const processes = parseWindowsProcessList(
      JSON.stringify([
        {
          ProcessId: 88,
          ParentProcessId: 1,
          CommandLine: `"C:\\Program Files\\Bun\\bun.exe" --no-orphans --watch "${windowsBackendEntry}" --port 31031`
        },
        {
          ProcessId: 99,
          ParentProcessId: 1,
          CommandLine: "powershell.exe Get-Process"
        }
      ])
    );

    const targets = collectDevBackendCleanupTargets(processes, {
      repoRoot: windowsRepoRoot,
      currentPid: 99999
    });

    expect(targets.matchedProcesses.map((processInfo) => processInfo.pid)).toEqual([88]);
    expect(targets.pids).toEqual([88]);
  });
});
