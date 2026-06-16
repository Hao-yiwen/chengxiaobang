// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { StreamingMarkdown } from "../src/renderer/components/StreamingMarkdown";
import { setupI18n } from "../src/renderer/i18n";

beforeAll(() => {
  setupI18n("zh");
});

beforeEach(() => {
  class MockIntersectionObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  class MockResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
  vi.stubGlobal("ResizeObserver", MockResizeObserver);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("StreamingMarkdown", () => {
  it("uses foreground color while assistant text is streaming", () => {
    const { container } = render(<StreamingMarkdown text="正在输出正文" />);
    const root = container.querySelector(".markdown-streamdown");

    expect(root).toHaveClass("text-foreground");
    expect(root).not.toHaveClass("text-body");
  });

  it("renders streamed paragraphs as direct blocks so root spacing applies", () => {
    const { container } = render(
      <StreamingMarkdown text={"## 《海与碗》\n\n第一段内容。\n\n第二段内容。"} />
    );
    const root = container.querySelector(".markdown-streamdown");
    const directBlocks = Array.from(root?.children ?? []);

    expect(root).toHaveClass("space-y-4");
    expect(directBlocks).toHaveLength(3);
    expect(directBlocks.every((block) => block.hasAttribute("data-cxb-streaming-markdown-block"))).toBe(true);
    expect(directBlocks.map((block) => block.textContent)).toEqual([
      "《海与碗》",
      "第一段内容。",
      "第二段内容。"
    ]);
  });

  it("renders an unclosed bold tail as formatted text immediately", () => {
    const { container } = render(<StreamingMarkdown text={"第一段\n\n**第二"} />);

    expect(screen.getByText("第一段")).toBeInTheDocument();
    expect(container.querySelector('[data-streamdown="strong"]')).toHaveTextContent("第二");
  });

  it("renders a half-arrived link as plain text without raw markdown markers", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});

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

  it("renders an unclosed code fence as a code block while streaming", async () => {
    const { container } = render(<StreamingMarkdown text={"```ts\nconst x = 1"} />);

    expect(container.querySelector('[data-streamdown="code-block"]')).not.toBeNull();
    await waitFor(() => {
      expect(container.querySelector("pre")).toHaveTextContent("const x = 1");
    });
  });

  it("renders an unclosed unlabeled code fence with the text code block while streaming", async () => {
    const codeText = "feature/* -> MR\npreview_train -> main";
    const { container } = render(<StreamingMarkdown text={`\`\`\`\n${codeText}`} />);

    expect(container.querySelector(".cxb-code-block-shell")).not.toBeNull();
    expect(screen.getByText("text")).toBeInTheDocument();
    expect(container.querySelector('[data-streamdown="code-block"][data-language=""]')).toBeNull();
    await waitFor(() => {
      const lineTexts = Array.from(
        container.querySelectorAll(".cxb-code-block-shell pre code > span")
      ).map((line) => line.textContent);
      expect(lineTexts).toEqual(codeText.split("\n"));
    });
  });

  it("enables Streamdown caret and word animation while output is streaming", () => {
    const { container } = render(<StreamingMarkdown text="正在输出内容" />);
    const root = container.querySelector(".markdown-streamdown") as HTMLElement | null;

    expect(root?.getAttribute("style")).toContain("--streamdown-caret");
    expect(root).not.toHaveClass("stream-caret");
    expect(container.querySelector("[data-sd-animate]")).not.toBeNull();
  });

  it("keeps GFM tables usable while still in streaming mode", () => {
    render(<StreamingMarkdown text={"| 名称 | 值 |\n| --- | --- |\n| 端口 | 8080 |"} />);

    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.queryByTitle("复制表格")).not.toBeInTheDocument();
    expect(screen.queryByTitle("下载表格")).not.toBeInTheDocument();
    expect(screen.queryByTitle("全屏查看")).not.toBeInTheDocument();
  });
});
