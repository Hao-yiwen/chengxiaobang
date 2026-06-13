import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readCliConfig, startParentProcessWatchdog } from "../src/main";
import { defaultDataDir, defaultSessionDir } from "../src/paths";

describe("backend CLI config", () => {
  // vitest.setup.ts 会把 CHENGXIAOBANG_HOME 指到临时目录;
  // 这里要验证的是无覆盖时的默认行为,所以先清掉再恢复。
  let savedHome: string | undefined;

  beforeEach(() => {
    savedHome = process.env.CHENGXIAOBANG_HOME;
    delete process.env.CHENGXIAOBANG_HOME;
  });

  afterEach(() => {
    vi.useRealTimers();
    if (savedHome === undefined) {
      delete process.env.CHENGXIAOBANG_HOME;
    } else {
      process.env.CHENGXIAOBANG_HOME = savedHome;
    }
  });

  it("defaults data dir to ~/.chengxiaobang/data", () => {
    expect(defaultDataDir()).toBe(join(homedir(), ".chengxiaobang", "data"));
    expect(readCliConfig(["node", "main.js"], {}).dataDir).toBe(defaultDataDir());
  });

  it("allows env and CLI data-dir to override the default", () => {
    expect(
      readCliConfig(["node", "main.js"], { CHENGXIAOBANG_DATA_DIR: "/tmp/from-env" }).dataDir
    ).toBe("/tmp/from-env");

    expect(
      readCliConfig(["node", "main.js", "--data-dir", "/tmp/from-cli"], {
        CHENGXIAOBANG_DATA_DIR: "/tmp/from-env"
      }).dataDir
    ).toBe("/tmp/from-cli");
  });

  it("reads parent pid from CLI before env", () => {
    expect(
      readCliConfig(["node", "main.js"], { CHENGXIAOBANG_PARENT_PID: "1234" }).parentPid
    ).toBe(1234);
    expect(
      readCliConfig(["node", "main.js", "--parent-pid", "5678"], {
        CHENGXIAOBANG_PARENT_PID: "1234"
      }).parentPid
    ).toBe(5678);
    expect(readCliConfig(["node", "main.js", "--parent-pid", "bad"], {}).parentPid).toBeUndefined();
  });

  it("closes the backend when the parent process disappears", () => {
    vi.useFakeTimers();
    const onParentLost = vi.fn();
    const watchdog = startParentProcessWatchdog(1234, {
      intervalMs: 50,
      killProcess: () => {
        const error = new Error("missing process") as Error & { code: string };
        error.code = "ESRCH";
        throw error;
      },
      onParentLost
    });

    vi.advanceTimersByTime(50);

    expect(onParentLost).toHaveBeenCalledWith("parent-lost");
    watchdog?.stop();
  });

  it("keeps the backend running while the parent process is alive", () => {
    vi.useFakeTimers();
    const onParentLost = vi.fn();
    const killProcess = vi.fn();
    const watchdog = startParentProcessWatchdog(1234, {
      intervalMs: 50,
      killProcess,
      onParentLost
    });

    vi.advanceTimersByTime(150);

    expect(killProcess).toHaveBeenCalledTimes(3);
    expect(onParentLost).not.toHaveBeenCalled();
    watchdog?.stop();
  });

  it("uses a per-session default workspace outside the data directory", () => {
    expect(defaultSessionDir("session_123")).toBe(join(homedir(), ".chengxiaobang", "session_123"));
  });

  it("CHENGXIAOBANG_HOME redirects both the data dir and session workspaces", () => {
    process.env.CHENGXIAOBANG_HOME = "/tmp/cxb-home";
    expect(defaultDataDir()).toBe(join("/tmp/cxb-home", "data"));
    expect(defaultSessionDir("session_123")).toBe(join("/tmp/cxb-home", "session_123"));
  });
});
