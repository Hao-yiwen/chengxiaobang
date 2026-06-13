import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ABORT_EXIT_CODE, runCommand, TIMEOUT_EXIT_CODE } from "../src/tools/shell";

describe("runCommand", () => {
  it("captures stdout and a zero exit code", async () => {
    const result = await runCommand("echo hello", process.cwd());

    expect(result.output).toBe("hello");
    expect(result.exitCode).toBe(0);
  });

  it("resolves with the exit code instead of rejecting on failure", async () => {
    const result = await runCommand("echo oops >&2; exit 3", process.cwd());

    expect(result.output).toContain("oops");
    expect(result.exitCode).toBe(3);
  });

  it("kills timed-out commands and reports exit code 124", async () => {
    const result = await runCommand("sleep 5", process.cwd(), 100);

    expect(result.exitCode).toBe(TIMEOUT_EXIT_CODE);
    expect(result.output).toContain("超时");
  });

  it("kills aborted commands and their child process group", async () => {
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
