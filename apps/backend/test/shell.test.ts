import { describe, expect, it } from "vitest";
import { runCommand, TIMEOUT_EXIT_CODE } from "../src/tools/shell";

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
});
