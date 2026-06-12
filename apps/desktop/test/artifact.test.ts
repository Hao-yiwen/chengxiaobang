import { describe, expect, it } from "vitest";
import type { ToolCall } from "@chengxiaobang/shared";
import { artifactFromToolCall, artifactKind, isDeliverableToolCall } from "../src/renderer/lib/artifact";

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
    expect(artifactKind("deck.pptx")).toBe("presentation");
    expect(artifactKind("report.docx")).toBe("docx");
    expect(artifactKind("data.xlsx")).toBe("spreadsheet");
    expect(artifactKind("notes.md")).toBe("markdown");
    expect(artifactKind("src/index.ts")).toBe("code");
    expect(artifactKind("report.PDF")).toBe("pdf");
    expect(artifactKind("photo.png")).toBe("image");
    expect(artifactKind("voice.mp3")).toBe("audio");
    expect(artifactKind("clip.mp4")).toBe("video");
    expect(artifactKind("config.json")).toBe("json");
    expect(artifactKind("archive.zip")).toBe("unsupported");
  });
});

describe("artifactFromToolCall", () => {
  it("surfaces create_* deliverables with name and kind", () => {
    expect(
      artifactFromToolCall(toolCall({ name: "create_pptx", args: { path: "out/deck.pptx" } }))
    ).toEqual({ path: "out/deck.pptx", name: "deck.pptx", kind: "presentation" });
    expect(
      artifactFromToolCall(toolCall({ name: "create_docx", args: { path: "report.docx" } }))
    ).toMatchObject({ kind: "docx", name: "report.docx" });
  });

  it("treats write_file as an artifact only for deliverable file types", () => {
    expect(
      artifactFromToolCall(toolCall({ name: "write_file", args: { path: "index.html" } }))
    ).toMatchObject({ kind: "html" });
    expect(
      artifactFromToolCall(toolCall({ name: "write_file", args: { path: "notes.md" } }))
    ).toMatchObject({ kind: "markdown" });
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

describe("isDeliverableToolCall", () => {
  it("judges by tool and path, ignoring status", () => {
    for (const status of ["running", "pending_approval", "completed", "failed"] as const) {
      expect(
        isDeliverableToolCall(toolCall({ name: "create_pptx", status, args: { path: "deck.pptx" } }))
      ).toBe(true);
      expect(
        isDeliverableToolCall(toolCall({ name: "write_file", status, args: { path: "notes.md" } }))
      ).toBe(true);
      expect(
        isDeliverableToolCall(toolCall({ name: "write_file", status, args: { path: "src/app.ts" } }))
      ).toBe(false);
    }
  });

  it("rejects non-artifact tools and missing paths", () => {
    expect(isDeliverableToolCall(toolCall({ name: "read_file", args: { path: "a.html" } }))).toBe(false);
    expect(isDeliverableToolCall(toolCall({ name: "create_pptx", args: {} }))).toBe(false);
  });
});
