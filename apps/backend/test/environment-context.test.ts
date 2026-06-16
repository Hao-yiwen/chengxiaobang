import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  collectEnvironmentContext,
  currentShell,
  osVersionLabel
} from "../src/agent/environment-context";

describe("currentShell", () => {
  it("posix 取 SHELL 的 basename", () => {
    expect(currentShell({ SHELL: "/bin/zsh" } as NodeJS.ProcessEnv, "darwin")).toBe("zsh");
  });

  it("win32 取 ComSpec 的 basename", () => {
    expect(
      currentShell({ ComSpec: "C:\\Windows\\System32\\cmd.exe" } as NodeJS.ProcessEnv, "win32")
    ).toBe("cmd.exe");
  });

  it("缺省时回退到平台默认", () => {
    expect(currentShell({} as NodeJS.ProcessEnv, "darwin")).toBe("sh");
    expect(currentShell({} as NodeJS.ProcessEnv, "win32")).toBe("cmd.exe");
  });
});

describe("osVersionLabel", () => {
  it("包含平台标识", () => {
    expect(osVersionLabel("darwin")).toContain("darwin");
  });
});

describe("collectEnvironmentContext", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "env-ctx-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("非 Git 目录降级：isGitRepo=false 且无 Git 快照，仍带 shell/os/model", async () => {
    const ctx = await collectEnvironmentContext({ workspacePath: dir, model: "m1" });
    expect(ctx.isGitRepo).toBe(false);
    expect(ctx.gitStatus).toBeUndefined();
    expect(ctx.shell.length).toBeGreaterThan(0);
    expect(ctx.osVersion.length).toBeGreaterThan(0);
    expect(ctx.model).toBe("m1");
  });
});
