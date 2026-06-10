// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { StreamingMarkdown } from "../src/renderer/components/StreamingMarkdown";
import {
  repairStreamingMarkdown,
  splitMarkdownBlocks
} from "../src/renderer/lib/streaming-markdown";
import { setupI18n } from "../src/renderer/i18n";

beforeAll(() => {
  setupI18n("zh");
});

describe("repairStreamingMarkdown", () => {
  it("closes an unfinished bold marker", () => {
    expect(repairStreamingMarkdown("这是 **加粗")).toBe("这是 **加粗**");
  });

  it("leaves complete markdown untouched", () => {
    const text = "完整 **段落** 文本";
    expect(repairStreamingMarkdown(text)).toBe(text);
  });

  it("rewrites a half-arrived link to the incomplete-link placeholder", () => {
    expect(repairStreamingMarkdown("看 [文档](https://exam")).toContain(
      "streamdown:incomplete-link"
    );
  });

  it("drops a half-arrived image", () => {
    expect(repairStreamingMarkdown("前文 ![截图](https://example.com/a.pn")).not.toContain("![");
  });
});

describe("splitMarkdownBlocks", () => {
  it("splits paragraphs into separate blocks without whitespace-only blocks", () => {
    const blocks = splitMarkdownBlocks("第一段\n\n第二段");
    expect(blocks.map((block) => block.trim())).toEqual(["第一段", "第二段"]);
  });

  it("keeps a fenced code block with blank lines as one block", () => {
    const blocks = splitMarkdownBlocks("```ts\nconst a = 1;\n\nconst b = 2;\n```");
    expect(blocks).toHaveLength(1);
  });

  it("keeps a loose list as one block", () => {
    const blocks = splitMarkdownBlocks("- 第一项\n\n- 第二项");
    expect(blocks).toHaveLength(1);
  });

  it("keeps documents with footnotes as a single block", () => {
    const blocks = splitMarkdownBlocks("正文[^1]\n\n[^1]: 注释");
    expect(blocks).toHaveLength(1);
  });
});

describe("StreamingMarkdown", () => {
  it("renders an unclosed bold tail as formatted text immediately", () => {
    const { container } = render(<StreamingMarkdown text={"第一段\n\n**第二"} />);
    expect(screen.getByText("第一段")).toBeInTheDocument();
    expect(container.querySelector("strong")).toHaveTextContent("第二");
  });

  it("renders a half-arrived link as plain text without an anchor", () => {
    const { container } = render(<StreamingMarkdown text="看 [文档](https://exam" />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(container.textContent).toContain("文档");
    expect(container.textContent).not.toContain("](");
  });

  it("hides a half-arrived image instead of showing raw markup", () => {
    const { container } = render(
      <StreamingMarkdown text="图片 ![截图](https://example.com/a.pn" />
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).not.toContain("![");
  });

  it("renders an unclosed code fence as a code block while streaming", () => {
    const { container } = render(<StreamingMarkdown text={"```ts\nconst x = 1"} />);
    expect(container.querySelector("pre")).toHaveTextContent("const x = 1");
  });

  it("renders each top-level block as its own memoizable wrapper", () => {
    const { container } = render(<StreamingMarkdown text={"第一段\n\n第二段"} />);
    expect(container.firstElementChild?.childElementCount).toBe(2);
  });
});
