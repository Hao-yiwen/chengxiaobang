import { describe, expect, it } from "vitest";
import type { ToolCall } from "@chengxiaobang/shared";
import { artifactFromToolCall, artifactKind } from "../src/renderer/lib/artifact";

function toolCall(partial: Partial<ToolCall>): ToolCall {
  return {
    id: "tool_1",
    runId: "run_1",
    name: "create_pptx",
    args: {},
    status: "completed",
    createdAt: "2026-06-08T00:00:00.000Z",
    updatedAt: "2026-06-08T00:00:01.000Z",
    ...partial
  };
}

describe("artifactKind", () => {
  it("routes by extension", () => {
    expect(artifactKind("page.html")).toBe("html");
    expect(artifactKind("a.svg")).toBe("html");
    expect(artifactKind("deck.pptx")).toBe("office");
    expect(artifactKind("report.docx")).toBe("office");
    expect(artifactKind("data.xlsx")).toBe("office");
    expect(artifactKind("notes.md")).toBe("text");
    expect(artifactKind("src/index.ts")).toBe("text");
  });
});

describe("artifactFromToolCall", () => {
  it("surfaces create_* deliverables with name and kind", () => {
    expect(
      artifactFromToolCall(toolCall({ name: "create_pptx", args: { path: "out/deck.pptx" } }))
    ).toEqual({ path: "out/deck.pptx", name: "deck.pptx", kind: "office" });
    expect(
      artifactFromToolCall(toolCall({ name: "create_docx", args: { path: "report.docx" } }))
    ).toMatchObject({ kind: "office", name: "report.docx" });
  });

  it("treats write_file as an artifact only for deliverable file types", () => {
    expect(
      artifactFromToolCall(toolCall({ name: "write_file", args: { path: "index.html" } }))
    ).toMatchObject({ kind: "html" });
    expect(
      artifactFromToolCall(toolCall({ name: "write_file", args: { path: "notes.md" } }))
    ).toMatchObject({ kind: "text" });
    // Plain code edits stay regular tool rows, not preview cards.
    expect(
      artifactFromToolCall(toolCall({ name: "write_file", args: { path: "src/app.ts" } }))
    ).toBeUndefined();
  });

  it("ignores non-artifact tools, unfinished calls, and missing paths", () => {
    expect(
      artifactFromToolCall(toolCall({ name: "read_file", args: { path: "a.html" } }))
    ).toBeUndefined();
    expect(
      artifactFromToolCall(toolCall({ status: "running", args: { path: "deck.pptx" } }))
    ).toBeUndefined();
    expect(artifactFromToolCall(toolCall({ name: "create_pptx", args: {} }))).toBeUndefined();
  });
});
