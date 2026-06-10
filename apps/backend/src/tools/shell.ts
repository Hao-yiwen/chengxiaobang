import { spawn } from "node:child_process";
import type { TerminalExecResult } from "@chengxiaobang/shared";

export const DEFAULT_COMMAND_TIMEOUT_MS = 120_000;

/** Conventional exit code for a command we had to kill on timeout. */
export const TIMEOUT_EXIT_CODE = 124;

/**
 * Run a shell command in `cwd`, capturing stdout + stderr combined.
 * Resolves with the exit code instead of rejecting so callers (the terminal
 * panel, the shell tool) can surface failures their own way; only a spawn
 * error rejects. A timed-out command is killed and reported as exit code 124.
 */
export function runCommand(
  command: string,
  cwd: string,
  timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS
): Promise<TerminalExecResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.env.SHELL ?? "/bin/zsh", ["-lc", command], {
      cwd,
      env: process.env
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      const output = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");
      if (timedOut) {
        resolvePromise({
          output: [output, "（命令执行超时，已终止）"].filter(Boolean).join("\n"),
          exitCode: TIMEOUT_EXIT_CODE
        });
        return;
      }
      resolvePromise({ output, exitCode: code ?? -1 });
    });
  });
}
