import { describe, expect, it } from "vitest";
import { parseBlocks, parseInline } from "../src/renderer/lib/markdown";

describe("parseInline", () => {
  it("splits inline code out of surrounding text", () => {
    expect(parseInline("call `AgentRunner.stream()` now")).toEqual([
      { type: "text", value: "call " },
      { type: "code", value: "AgentRunner.stream()" },
      { type: "text", value: " now" }
    ]);
  });

  it("parses bold runs", () => {
    expect(parseInline("a **bold** word")).toEqual([
      { type: "text", value: "a " },
      { type: "bold", value: "bold" },
      { type: "text", value: " word" }
    ]);
  });

  it("does not treat asterisks inside inline code as bold", () => {
    expect(parseInline("`a ** b`")).toEqual([{ type: "code", value: "a ** b" }]);
  });

  it("parses links into text and href", () => {
    expect(parseInline("see [docs](https://example.com) now")).toEqual([
      { type: "text", value: "see " },
      { type: "link", value: "docs", href: "https://example.com" },
      { type: "text", value: " now" }
    ]);
  });

  it("captures the link href up to the closing paren (safety is the renderer's job)", () => {
    expect(parseInline("[x](javascript:alert)")).toEqual([
      { type: "link", value: "x", href: "javascript:alert" }
    ]);
  });

  it("returns a single empty text token for empty input", () => {
    expect(parseInline("")).toEqual([{ type: "text", value: "" }]);
  });
});

describe("parseBlocks", () => {
  it("treats plain lines as a paragraph", () => {
    expect(parseBlocks("hello world")).toEqual([
      { type: "paragraph", inlines: [{ type: "text", value: "hello world" }] }
    ]);
  });

  it("extracts a fenced code block with a language", () => {
    const blocks = parseBlocks("before\n\n```ts\nconst x = 1;\n```\n\nafter");
    expect(blocks).toEqual([
      { type: "paragraph", inlines: [{ type: "text", value: "before" }] },
      { type: "code", lang: "ts", content: "const x = 1;" },
      { type: "paragraph", inlines: [{ type: "text", value: "after" }] }
    ]);
  });

  it("keeps backticks and asterisks literal inside a code fence", () => {
    const blocks = parseBlocks("```\n`not code` **not bold**\n```");
    expect(blocks).toEqual([
      { type: "code", lang: undefined, content: "`not code` **not bold**" }
    ]);
  });

  it("groups consecutive ordered list items", () => {
    const blocks = parseBlocks("1. first\n2. second\n3. third");
    expect(blocks).toEqual([
      {
        type: "list",
        ordered: true,
        items: [
          [{ type: "text", value: "first" }],
          [{ type: "text", value: "second" }],
          [{ type: "text", value: "third" }]
        ]
      }
    ]);
  });

  it("parses unordered list items with inline formatting", () => {
    const blocks = parseBlocks("- run `pnpm test`\n- ship it");
    expect(blocks).toEqual([
      {
        type: "list",
        ordered: false,
        items: [
          [
            { type: "text", value: "run " },
            { type: "code", value: "pnpm test" }
          ],
          [{ type: "text", value: "ship it" }]
        ]
      }
    ]);
  });

  it("parses headings by level", () => {
    expect(parseBlocks("## Title")).toEqual([
      { type: "heading", level: 2, inlines: [{ type: "text", value: "Title" }] }
    ]);
  });

  it("merges adjacent non-blank lines into one paragraph", () => {
    const blocks = parseBlocks("line one\nline two");
    expect(blocks).toEqual([
      { type: "paragraph", inlines: [{ type: "text", value: "line one\nline two" }] }
    ]);
  });
});
