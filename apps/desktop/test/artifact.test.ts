import { describe, expect, it } from "vitest";
import {
  artifactFromPath,
  artifactKind,
  collectArtifactsFromAssistantMessages,
  collectArtifactsFromSession,
  parseArtifactDeclarations
} from "../src/renderer/lib/artifact";
import type { ToolCall } from "@chengxiaobang/shared";

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

describe("artifactFromPath", () => {
  it("builds display metadata from a declared final path", () => {
    expect(artifactFromPath("out/deck.pptx")).toEqual({
      path: "out/deck.pptx",
      name: "deck.pptx",
      kind: "presentation"
    });
  });
});

describe("parseArtifactDeclarations", () => {
  it("extracts final XML artifacts and removes the protocol from markdown", () => {
    const parsed = parseArtifactDeclarations(
      [
        "已经生成最终文件：",
        "",
        "<artifacts>",
        "  <artifact path=\"page.html\" />",
        "  <artifact path='预算表.xlsx' />",
        "</artifacts>"
      ].join("\n")
    );

    expect(parsed.cleanMarkdown).toBe("已经生成最终文件：");
    expect(parsed.artifacts).toEqual([
      { path: "page.html", name: "page.html", kind: "html" },
      { path: "预算表.xlsx", name: "预算表.xlsx", kind: "spreadsheet" }
    ]);
    expect(parsed.diagnostics).toEqual([]);
  });

  it("deduplicates paths and reports ignored declarations", () => {
    const parsed = parseArtifactDeclarations(
      [
        "完成。",
        "<artifacts>",
        "  <artifact path=\"page.html\" />",
        "  <artifact path=\"page.html\" />",
        "  <artifact />",
        "  <artifact path=\"   \" />",
        "</artifacts>"
      ].join("\n")
    );

    expect(parsed.artifacts).toEqual([{ path: "page.html", name: "page.html", kind: "html" }]);
    expect(parsed.diagnostics).toEqual([
      { type: "duplicate_path", path: "page.html" },
      { type: "missing_path", tag: "<artifact />" },
      { type: "invalid_path", path: "   " }
    ]);
  });

  it("rejects absolute and escaping artifact paths", () => {
    const parsed = parseArtifactDeclarations(
      [
        "<artifacts>",
        "  <artifact path=\"/Users/me/.env\" />",
        "  <artifact path=\"C:\\\\Users\\\\me\\\\secret.txt\" />",
        "  <artifact path=\"../outside.txt\" />",
        "  <artifact path=\"safe/report.md\" />",
        "</artifacts>"
      ].join("\n")
    );

    expect(parsed.artifacts).toEqual([
      { path: "safe/report.md", name: "report.md", kind: "markdown" }
    ]);
    expect(parsed.diagnostics).toEqual([
      { type: "invalid_path", path: "/Users/me/.env" },
      { type: "invalid_path", path: "C:\\\\Users\\\\me\\\\secret.txt" },
      { type: "invalid_path", path: "../outside.txt" }
    ]);
  });

  it("decodes XML attribute entities and accepts standalone declarations", () => {
    const parsed = parseArtifactDeclarations("完成 <artifact path=\"reports/a&amp;b.md\" />");

    expect(parsed.cleanMarkdown).toBe("完成");
    expect(parsed.artifacts).toEqual([
      { path: "reports/a&b.md", name: "a&b.md", kind: "markdown" }
    ]);
  });

  it("ignores XML examples inside fenced code and hides unfinished streaming tails", () => {
    const parsed = parseArtifactDeclarations(
      [
        "示例：",
        "```xml",
        "<artifacts><artifact path=\"example.html\" /></artifacts>",
        "```",
        "",
        "最终如下：",
        "<artifacts><artifact path=\"final.html\" /></artifacts>",
        "<artifact path=\"partial.html\""
      ].join("\n")
    );

    expect(parsed.cleanMarkdown).toContain("<artifact path=\"example.html\" />");
    expect(parsed.cleanMarkdown).toContain("最终如下：");
    expect(parsed.cleanMarkdown).not.toContain("final.html");
    expect(parsed.cleanMarkdown).not.toContain("partial.html");
    expect(parsed.artifacts).toEqual([{ path: "final.html", name: "final.html", kind: "html" }]);
  });
});

describe("collectArtifactsFromAssistantMessages", () => {
  it("collects assistant artifacts with newest declarations first", () => {
    const collection = collectArtifactsFromAssistantMessages([
      {
        id: "user_1",
        role: "user",
        content: "<artifact path=\"ignored.html\" />",
        createdAt: "2026-06-08T00:00:00.000Z"
      },
      {
        id: "assistant_1",
        role: "assistant",
        content: "<artifact path=\"page.html\" />",
        createdAt: "2026-06-08T00:00:01.000Z"
      },
      {
        id: "assistant_2",
        role: "assistant",
        content: [
          "<artifacts>",
          "  <artifact path=\"report.docx\" />",
          "  <artifact path=\"page.html\" />",
          "</artifacts>"
        ].join("\n"),
        createdAt: "2026-06-08T00:00:02.000Z"
      }
    ]);

    expect(collection.artifacts).toEqual([
      {
        path: "page.html",
        name: "page.html",
        kind: "html",
        messageId: "assistant_2",
        declaredAt: "2026-06-08T00:00:02.000Z"
      },
      {
        path: "report.docx",
        name: "report.docx",
        kind: "docx",
        messageId: "assistant_2",
        declaredAt: "2026-06-08T00:00:02.000Z"
      }
    ]);
    expect(collection.diagnostics).toEqual([{ type: "duplicate_path", path: "page.html" }]);
  });
});

describe("collectArtifactsFromSession", () => {
  function tool(partial: Partial<ToolCall>): ToolCall {
    return {
      id: "tool_1",
      runId: "run_1",
      name: "write_file",
      args: {},
      status: "completed",
      createdAt: "2026-06-08T00:00:00.000Z",
      updatedAt: "2026-06-08T00:00:00.000Z",
      ...partial
    };
  }

  it("collects declared markdown files as session artifacts", () => {
    const collection = collectArtifactsFromSession([
      {
        id: "assistant_md",
        role: "assistant",
        content: [
          "日报已生成。",
          "",
          "<artifacts>",
          "  <artifact path=\"AI日报_2026-06-13.md\" />",
          "</artifacts>"
        ].join("\n"),
        createdAt: "2026-06-08T00:00:05.000Z"
      }
    ]);

    expect(collection.artifacts).toEqual([
      {
        path: "AI日报_2026-06-13.md",
        name: "AI日报_2026-06-13.md",
        kind: "markdown",
        messageId: "assistant_md",
        declaredAt: "2026-06-08T00:00:05.000Z"
      }
    ]);
    expect(collection.diagnostics).toEqual([]);
  });

  it("uses completed previewable tool outputs as history fallback", () => {
    const collection = collectArtifactsFromSession([], [
      tool({
        id: "tool_old_html",
        args: { path: "page.html" },
        updatedAt: "2026-06-08T00:00:01.000Z"
      }),
      tool({
        id: "tool_code",
        args: { path: "src/App.tsx" },
        updatedAt: "2026-06-08T00:00:02.000Z"
      }),
      tool({
        id: "tool_new_html",
        args: { path: "page.html" },
        updatedAt: "2026-06-08T00:00:03.000Z"
      }),
      tool({
        id: "tool_failed",
        status: "failed",
        args: { path: "failed.html" },
        updatedAt: "2026-06-08T00:00:04.000Z"
      })
    ]);

    expect(collection.artifacts).toEqual([
      {
        path: "page.html",
        name: "page.html",
        kind: "html",
        toolCallId: "tool_new_html",
        declaredAt: "2026-06-08T00:00:03.000Z"
      }
    ]);
    expect(collection.diagnostics).toEqual([{ type: "duplicate_path", path: "page.html" }]);
  });

  it("keeps XML declarations ahead of tool history fallback", () => {
    const collection = collectArtifactsFromSession(
      [
        {
          id: "assistant_1",
          role: "assistant",
          content: "<artifact path=\"page.html\" />",
          createdAt: "2026-06-08T00:00:01.000Z"
        }
      ],
      [
        tool({
          id: "tool_1",
          args: { path: "page.html" },
          updatedAt: "2026-06-08T00:00:02.000Z"
        }),
        tool({
          id: "tool_2",
          name: "create_xlsx",
          args: { path: "budget" },
          updatedAt: "2026-06-08T00:00:03.000Z"
        })
      ]
    );

    expect(collection.artifacts).toEqual([
      {
        path: "page.html",
        name: "page.html",
        kind: "html",
        messageId: "assistant_1",
        declaredAt: "2026-06-08T00:00:01.000Z"
      },
      {
        path: "budget",
        name: "budget",
        kind: "spreadsheet",
        toolCallId: "tool_2",
        declaredAt: "2026-06-08T00:00:03.000Z"
      }
    ]);
    expect(collection.diagnostics).toEqual([{ type: "duplicate_path", path: "page.html" }]);
  });
});
