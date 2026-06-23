import { describe, expect, it } from "vitest";
import type { ToolCall } from "@chengxiaobang/shared";
import {
  buildToolCallDiff,
  formatDurationMs,
  shortenPath,
  toolCallDurationMs
} from "../src/renderer/lib/tool-call";

function toolCall(partial: Partial<ToolCall>): ToolCall {
  return {
    id: "tool_1",
    runId: "run_1",
    name: "Bash",
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

describe("shortenPath", () => {
  it("keeps short paths and trims long ones to the last segments", () => {
    expect(shortenPath("a.txt")).toBe("a.txt");
    expect(shortenPath("src/index.ts")).toBe("src/index.ts");
    expect(shortenPath("/Users/me/Documents/proj/src/index.ts")).toBe("…/src/index.ts");
    expect(shortenPath("/Users/me/Documents/proj/src/index.ts", 3)).toBe("…/proj/src/index.ts");
    expect(shortenPath("C:\\Users\\me\\Documents\\proj\\src\\index.ts")).toBe(
      "…/src/index.ts"
    );
  });
});

describe("buildToolCallDiff", () => {
  it("prefers backend text diff previews over argument-derived diffs", () => {
    const source = buildToolCallDiff(
      toolCall({
        name: "Write",
        args: { file_path: "a.txt", content: "arg-only\n" },
        preview: {
          kind: "text_diff",
          path: "a.txt",
          oldText: "old\n",
          newText: "preview\n"
        }
      })
    );
    expect(source).toMatchObject({
      kind: "text",
      fileName: "a.txt",
      oldText: "old\n",
      newText: "preview\n",
      cacheKey: "tool_1:2026-06-08T00:00:01.200Z:preview"
    });
  });

  it("uses completed fileChange patches before argument-derived diffs", () => {
    const source = buildToolCallDiff(
      toolCall({
        name: "Write",
        args: { file_path: "a.txt", content: "arg-only\n" },
        fileChange: {
          path: "a.txt",
          operation: "write",
          patch:
            "diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-old\n+patch\n",
          additions: 1,
          deletions: 1,
          toolCallIds: ["tool_1"]
        }
      })
    );

    expect(source).toMatchObject({
      kind: "patch",
      fileName: "a.txt"
    });
    expect(source && source.kind === "patch" ? source.blocks.length : 0).toBeGreaterThan(0);
  });

  it("diffs Edit old_string → new_string from its args", () => {
    const source = buildToolCallDiff(
      toolCall({
        name: "Edit",
        args: { file_path: "a.ts", old_string: "x = 1", new_string: "x = 2" }
      })
    );
    expect(source).toMatchObject({
      kind: "text",
      fileName: "a.ts",
      oldText: "x = 1",
      newText: "x = 2",
      cacheKey: "tool_1:2026-06-08T00:00:01.200Z:edit"
    });
  });

  it("treats Write content as all added", () => {
    const source = buildToolCallDiff(
      toolCall({ name: "Write", args: { file_path: "a.txt", content: "hello\nworld" } })
    );
    expect(source).toMatchObject({
      kind: "text",
      fileName: "a.txt",
      oldText: "",
      newText: "hello\nworld",
      cacheKey: "tool_1:2026-06-08T00:00:01.200Z:write"
    });
  });

  it("returns undefined for other tools or malformed args", () => {
    expect(buildToolCallDiff(toolCall({ name: "Bash", args: { command: "ls" } }))).toBeUndefined();
    expect(buildToolCallDiff(toolCall({ name: "Edit", args: { file_path: "a" } }))).toBeUndefined();
    expect(buildToolCallDiff(toolCall({ name: "Write", args: {} }))).toBeUndefined();
  });
});
