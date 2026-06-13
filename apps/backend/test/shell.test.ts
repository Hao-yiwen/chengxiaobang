import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ABORT_EXIT_CODE,
  resolveShellCommand,
  runCommand,
  TIMEOUT_EXIT_CODE
} from "../src/tools/shell";

const itUnix = process.platform === "win32" ? it.skip : it;

describe("runCommand", () => {
  it("captures stdout and a zero exit code", async () => {
    const result = await runCommand("echo hello", process.cwd());

    expect(result.output).toBe("hello");
    expect(result.exitCode).toBe(0);
  });

  it("resolves with the exit code instead of rejecting on failure", async () => {
    const result = await runCommand(failingCommand(3, "oops"), process.cwd());

    expect(result.output).toContain("oops");
    expect(result.exitCode).toBe(3);
  });

  it("caps captured output for foreground commands", async () => {
    const command =
      process.platform === "win32"
        ? "powershell -NoProfile -Command \"$text = 'x' * 300000; Write-Output $text\""
        : "printf '%*s' 300000 '' | tr ' ' x";

    const result = await runCommand(command, process.cwd(), 10_000);

    expect(result.truncated).toBe(true);
    expect(result.output).toContain("输出已截断");
    expect(result.output.length).toBeLessThan(270_000);
  });

  it("kills timed-out commands and reports exit code 124", async () => {
    const result = await runCommand(longRunningCommand(), process.cwd(), 100);

    expect(result.exitCode).toBe(TIMEOUT_EXIT_CODE);
    expect(result.output).toContain("超时");
  });

  itUnix("kills aborted commands and their child process group", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cxb-shell-"));
    const pidFile = join(dir, "child.pid");
    const controller = new AbortController();
    const startedAt = Date.now();

    try {
      const command = `sleep 5 & echo $! > ${shellQuote(pidFile)}; wait`;
      const running = runCommand(command, process.cwd(), {
        timeoutMs: 10_000,
        signal: controller.signal
      });
      const childPid = Number((await waitForFile(pidFile)).trim());

      controller.abort();

      const result = await running;
      expect(result.exitCode).toBe(ABORT_EXIT_CODE);
      expect(result.output).toContain("中止");
      expect(Date.now() - startedAt).toBeLessThan(2_000);
      await waitForProcessToExit(childPid);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

function failingCommand(exitCode: number, message: string): string {
  return process.platform === "win32"
    ? `echo ${message} 1>&2 & exit /b ${exitCode}`
    : `echo ${message} >&2; exit ${exitCode}`;
}

function longRunningCommand(): string {
  return process.platform === "win32" ? "ping 127.0.0.1 -n 6 >nul" : "sleep 5";
}

describe("resolveShellCommand", () => {
  it("uses cmd.exe semantics on Windows", () => {
    expect(resolveShellCommand({ ComSpec: "C:\\Windows\\System32\\cmd.exe" }, "win32")).toEqual({
      command: "C:\\Windows\\System32\\cmd.exe",
      args: ["/d", "/s", "/c"]
    });
  });

  it("keeps login-shell semantics on non-Windows platforms", () => {
    expect(resolveShellCommand({ SHELL: "/bin/zsh" }, "darwin")).toEqual({
      command: "/bin/zsh",
      args: ["-lc"]
    });
  });
});

async function waitForFile(path: string): Promise<string> {
  const deadline = Date.now() + 1_000;
  for (;;) {
    try {
      return await readFile(path, "utf8");
    } catch (error) {
      if (Date.now() >= deadline) {
        throw error;
      }
      await sleep(20);
    }
  }
}

async function waitForProcessToExit(pid: number): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    if (!processExists(pid)) {
      return;
    }
    await sleep(20);
  }
  throw new Error(`子进程未被终止 pid=${pid}`);
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = error instanceof Error && "code" in error ? String(error.code) : undefined;
    if (code === "ESRCH") {
      return false;
    }
    throw error;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}
