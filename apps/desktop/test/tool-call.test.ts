import { describe, expect, it } from "vitest";
import type { ToolCall } from "@chengxiaobang/shared";
import {
  buildToolCallDiff,
  formatDurationMs,
  toolCallDurationMs
} from "../src/renderer/lib/tool-call";

function toolCall(partial: Partial<ToolCall>): ToolCall {
  return {
    id: "tool_1",
    runId: "run_1",
    name: "shell",
    args: {},
    status: "completed",
    createdAt: "2026-06-08T00:00:00.000Z",
    updatedAt: "2026-06-08T00:00:01.200Z",
    ...partial
  };
}

describe("toolCallDurationMs", () => {
  it("measures startedAt → updatedAt for finished calls", () => {
    expect(
      toolCallDurationMs(toolCall({ startedAt: "2026-06-08T00:00:00.000Z" }))
    ).toBe(1200);
    expect(
      toolCallDurationMs(
        toolCall({ status: "failed", startedAt: "2026-06-08T00:00:01.000Z" })
      )
    ).toBe(200);
  });

  it("is undefined without startedAt or for unfinished calls", () => {
    expect(toolCallDurationMs(toolCall({}))).toBeUndefined();
    expect(
      toolCallDurationMs(toolCall({ status: "running", startedAt: "2026-06-08T00:00:00.000Z" }))
    ).toBeUndefined();
    expect(
      toolCallDurationMs(
        toolCall({ status: "pending_approval", startedAt: "2026-06-08T00:00:00.000Z" })
      )
    ).toBeUndefined();
  });

  it("clamps negative clock skew to zero", () => {
    expect(
      toolCallDurationMs(toolCall({ startedAt: "2026-06-08T00:00:05.000Z" }))
    ).toBe(0);
  });
});

describe("formatDurationMs", () => {
  it("formats ms, seconds, and minutes", () => {
    expect(formatDurationMs(320)).toBe("320ms");
    expect(formatDurationMs(999)).toBe("999ms");
    expect(formatDurationMs(1000)).toBe("1.0s");
    expect(formatDurationMs(1234)).toBe("1.2s");
    expect(formatDurationMs(59_900)).toBe("59.9s");
    expect(formatDurationMs(125_000)).toBe("2m 5s");
  });
});

describe("buildToolCallDiff", () => {
  it("diffs edit_file old → new from its args", () => {
    const lines = buildToolCallDiff(
      toolCall({ name: "edit_file", args: { path: "a.ts", oldText: "x = 1", newText: "x = 2" } })
    );
    expect(lines).toEqual([
      { type: "removed", text: "x = 1" },
      { type: "added", text: "x = 2" }
    ]);
  });

  it("treats write_file content as all added", () => {
    const lines = buildToolCallDiff(
      toolCall({ name: "write_file", args: { path: "a.txt", content: "hello\nworld" } })
    );
    expect(lines).toEqual([
      { type: "added", text: "hello" },
      { type: "added", text: "world" }
    ]);
  });

  it("returns undefined for other tools or malformed args", () => {
    expect(buildToolCallDiff(toolCall({ name: "shell", args: { command: "ls" } }))).toBeUndefined();
    expect(buildToolCallDiff(toolCall({ name: "edit_file", args: { path: "a" } }))).toBeUndefined();
    expect(buildToolCallDiff(toolCall({ name: "write_file", args: {} }))).toBeUndefined();
  });
});
