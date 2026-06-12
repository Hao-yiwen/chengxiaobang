import type { WebContents } from "electron";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TerminalSessionManager } from "../src/main/terminal";

class FakePty {
  dataListeners: Array<(data: string) => void> = [];
  exitListeners: Array<(event: { exitCode: number }) => void> = [];
  writes: string[] = [];
  resizes: Array<{ cols: number; rows: number }> = [];
  killed = false;

  onData(listener: (data: string) => void): { dispose: () => void } {
    this.dataListeners.push(listener);
    return {
      dispose: () => {
        this.dataListeners = this.dataListeners.filter((item) => item !== listener);
      }
    };
  }

  onExit(listener: (event: { exitCode: number }) => void): { dispose: () => void } {
    this.exitListeners.push(listener);
    return {
      dispose: () => {
        this.exitListeners = this.exitListeners.filter((item) => item !== listener);
      }
    };
  }

  write(data: string): void {
    this.writes.push(data);
  }

  resize(cols: number, rows: number): void {
    this.resizes.push({ cols, rows });
  }

  kill(): void {
    this.killed = true;
  }

  emitData(data: string): void {
    for (const listener of this.dataListeners) {
      listener(data);
    }
  }

  emitExit(exitCode: number): void {
    for (const listener of this.exitListeners) {
      listener({ exitCode });
    }
  }
}

function createOwner() {
  const destroyedListeners: Array<() => void> = [];
  const owner = {
    send: vi.fn(),
    isDestroyed: vi.fn(() => false),
    once: vi.fn((event: string, listener: () => void) => {
      if (event === "destroyed") {
        destroyedListeners.push(listener);
      }
      return owner;
    })
  } as unknown as WebContents;
  return {
    owner,
    destroy() {
      for (const listener of destroyedListeners) {
        listener();
      }
    }
  };
}

describe("TerminalSessionManager", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function tempDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "cxb-terminal-test-"));
    tempDirs.push(dir);
    return dir;
  }

  function managerWithFakePty() {
    const ptys: FakePty[] = [];
    const spawn = vi.fn((_shell: string, _args: string[], _options: unknown) => {
      const pty = new FakePty();
      ptys.push(pty);
      return pty;
    });
    return {
      manager: new TerminalSessionManager({ spawn } as never),
      spawn,
      ptys
    };
  }

  it("starts a pty in the requested cwd and forwards output to the owner", async () => {
    const cwd = await tempDir();
    const { owner } = createOwner();
    const { manager, spawn, ptys } = managerWithFakePty();

    const result = await manager.start(owner, { id: "pty_1", cwd, cols: 120.8, rows: 36 });

    expect(result).toEqual({ ok: true, id: "pty_1" });
    expect(spawn).toHaveBeenCalledWith(
      expect.any(String),
      [],
      expect.objectContaining({
        cols: 120,
        rows: 36,
        cwd,
        env: expect.objectContaining({ TERM: "xterm-256color" })
      })
    );

    ptys[0].emitData("hello\r\n");
    expect(owner.send).toHaveBeenCalledWith("terminal:data", {
      id: "pty_1",
      data: "hello\r\n"
    });
  });

  it("writes input, resizes, and closes the pty session", async () => {
    const cwd = await tempDir();
    const { owner } = createOwner();
    const { manager, ptys } = managerWithFakePty();
    await manager.start(owner, { id: "pty_1", cwd, cols: 80, rows: 24 });

    expect(manager.write("pty_1", "ls\r")).toEqual({ ok: true });
    expect(ptys[0].writes).toEqual(["ls\r"]);

    expect(manager.resize("pty_1", 140, 50)).toEqual({ ok: true });
    expect(ptys[0].resizes).toEqual([{ cols: 140, rows: 50 }]);

    expect(manager.close("pty_1")).toEqual({ ok: true });
    expect(ptys[0].killed).toBe(true);
    expect(manager.write("pty_1", "pwd\r")).toEqual({
      ok: false,
      error: "终端会话不存在"
    });
  });

  it("sends exit events and removes finished sessions", async () => {
    const cwd = await tempDir();
    const { owner } = createOwner();
    const { manager, ptys } = managerWithFakePty();
    await manager.start(owner, { id: "pty_1", cwd });

    ptys[0].emitExit(2);

    expect(owner.send).toHaveBeenCalledWith("terminal:exit", { id: "pty_1", exitCode: 2 });
    expect(manager.write("pty_1", "pwd\r")).toEqual({
      ok: false,
      error: "终端会话不存在"
    });
  });

  it("rejects paths that are not project directories", async () => {
    const cwd = await tempDir();
    const filePath = join(cwd, "file.txt");
    await writeFile(filePath, "not a directory");
    const { owner } = createOwner();
    const { manager, spawn } = managerWithFakePty();

    const result = await manager.start(owner, { id: "pty_1", cwd: filePath });

    expect(result.ok).toBe(false);
    expect(spawn).not.toHaveBeenCalled();
  });

  it.runIf(process.platform === "darwin")(
    "starts the real node-pty helper on macOS",
    async () => {
      const cwd = await tempDir();
      const { owner } = createOwner();
      const manager = new TerminalSessionManager();
      let output = "";
      const sawOutput = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("等待 PTY 输出超时")), 3000);
        vi.mocked(owner.send).mockImplementation((_channel, payload) => {
          output += String((payload as { data?: string }).data ?? "");
          if (output.includes("pty-smoke-ok")) {
            clearTimeout(timeout);
            resolve();
          }
        });
      });

      const result = await manager.start(owner, { id: "pty_real", cwd, cols: 80, rows: 24 });
      expect(result).toEqual({ ok: true, id: "pty_real" });
      manager.write("pty_real", "printf 'pty-smoke-ok\\n'; exit\r");

      await sawOutput;
      manager.close("pty_real");
    }
  );
});
