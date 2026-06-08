import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readCliConfig } from "../src/main";
import { defaultDataDir, defaultSessionDir } from "../src/paths";

describe("backend CLI config", () => {
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

  it("uses a per-session default workspace outside the data directory", () => {
    expect(defaultSessionDir("session_123")).toBe(join(homedir(), ".chengxiaobang", "session_123"));
  });
});
