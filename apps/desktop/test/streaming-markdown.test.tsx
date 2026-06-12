// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { createElement } from "react";
import { render, screen } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { StreamingMarkdown } from "../src/renderer/components/StreamingMarkdown";
import {
  STREAM_ANIM_FUSE_BYTES,
  lexStreamBlocks,
  repairStart,
  repairStreamingMarkdown,
  splitMarkdownBlocks,
  utf8ByteLength
} from "../src/renderer/lib/streaming-markdown";
import { setupI18n } from "../src/renderer/i18n";

// WP-H1 并行施工：`Markdown` 的 `appendCaret` prop 尚未落地。按交接约定在测试里
// mock —— 透传给真实组件渲染（剥掉 appendCaret），同时记录每个块收到的 props，
// 以便断言「caret 只注入尾块」。
const markdownCalls = vi.hoisted(
  () => [] as Array<{ text: string; appendCaret?: boolean }>
);
vi.mock("../src/renderer/components/Markdown", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../src/renderer/components/Markdown")>();
  return {
    Markdown: (props: { text: string; className?: string; appendCaret?: boolean }) => {
      markdownCalls.push({ text: props.text, appendCaret: props.appendCaret });
      return createElement(mod.Markdown, { text: props.text, className: props.className });
    }
  };
});

beforeAll(() => {
  setupI18n("zh");
});

beforeEach(() => {
  markdownCalls.length = 0;
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

describe("repairStart", () => {
  it("returns the full length when nothing was rewritten", () => {
    expect(repairStart("abc", "abc")).toBe(3);
  });

  it("returns the original length when the repair only appends", () => {
    const text = "这是 **加粗";
    expect(repairStart(text, repairStreamingMarkdown(text))).toBe(text.length);
  });

  it("returns the in-place rewrite offset for a half-arrived link", () => {
    const text = "看 [文档](https://exam";
    expect(repairStart(text, repairStreamingMarkdown(text))).toBe(text.indexOf("https"));
  });

  it("returns 0 when the strings diverge immediately", () => {
    expect(repairStart("xyz", "abc")).toBe(0);
  });
});

describe("utf8ByteLength", () => {
  it("counts UTF-8 bytes, not UTF-16 units", () => {
    expect(utf8ByteLength("x")).toBe(1);
    expect(utf8ByteLength("中")).toBe(3);
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

describe("lexStreamBlocks · 偏移哈希 key（UI-SPEC §4.2）", () => {
  const lex = (text: string) => lexStreamBlocks(repairStreamingMarkdown(text));
  const keys = (text: string) => lex(text).map((block) => block.key);

  it("keys blocks by start offset and type, counting dropped blank-line tokens", () => {
    expect(keys("intro\n\nnext")).toEqual(["0:paragraph", "7:paragraph"]);
  });

  it("keys a footnote document as a single document block", () => {
    expect(keys("正文[^1]\n\n[^1]: 注释")).toEqual(["0:document"]);
  });

  it("场景一 · 段落长成列表：前缀块 key 稳定，仅尾块重 key", () => {
    const before = keys("intro\n\n1");
    const after = keys("intro\n\n1. 项目");
    expect(before).toEqual(["0:paragraph", "7:paragraph"]);
    expect(after).toEqual(["0:paragraph", "7:list"]);
    expect(after[0]).toBe(before[0]);
  });

  it("场景二 · 两块合并：前缀块 key 稳定，仅尾部块失效", () => {
    const before = keys("intro\n\n1. a\n\n2");
    const after = keys("intro\n\n1. a\n\n2. b");
    expect(before).toEqual(["0:paragraph", "7:list", "13:paragraph"]);
    expect(after).toEqual(["0:paragraph", "7:list"]);
    expect(after).toEqual(before.slice(0, 2));
  });

  it("场景三 · 尾部代码块闭合：key 全程不变，无 remount", () => {
    const before = keys("intro\n\n```ts\nconst a");
    const after = keys("intro\n\n```ts\nconst a = 1;\n```");
    expect(before).toEqual(["0:paragraph", "7:code"]);
    expect(after).toEqual(before);
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

  it("keeps the prefix block's DOM node across a tail re-key (段落长成列表)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { container, rerender } = render(<StreamingMarkdown text={"第一段\n\n1"} />);
      const wrappers = () => container.firstElementChild!.children;
      const prefixNode = wrappers()[0];
      const tailNode = wrappers()[1];
      rerender(<StreamingMarkdown text={"第一段\n\n1. 项目"} />);
      // 前缀块 key 稳定 → React 复用同一 DOM 节点；尾块 key 失效 → remount。
      expect(wrappers()[0]).toBe(prefixNode);
      expect(wrappers()[1]).not.toBe(tailNode);
      // 尾块合法重 key 不得触发 §4.2 的连锁 remount 告警。
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("passes appendCaret only to the tail block (§4.1)", () => {
    render(<StreamingMarkdown text={"第一段\n\n**第二"} />);
    expect(markdownCalls).toHaveLength(2);
    expect(markdownCalls[0].appendCaret).toBe(false);
    expect(markdownCalls[1].appendCaret).toBe(true);
  });

  it("hangs the caret on the line after a streaming code-block tail", () => {
    const { container } = render(<StreamingMarkdown text={"```ts\nconst x = 1"} />);
    const caret = container.querySelector(".ink-caret");
    expect(caret).not.toBeNull();
    // 代码块尾块不走行内注入 —— appendCaret 关闭，光标独立成行挂在代码块之后。
    expect(markdownCalls[0].appendCaret).toBe(false);
    expect(caret?.closest("div")?.previousElementSibling?.querySelector("pre")).not.toBeNull();
  });

  it("animates newly appeared blocks and keeps settled blocks' class stable", () => {
    const { container, rerender } = render(<StreamingMarkdown text={"第一段"} />);
    const wrappers = () => container.firstElementChild!.children;
    expect(wrappers()[0]).toHaveClass("animate-msg-in");
    rerender(<StreamingMarkdown text={"第一段\n\n第二段"} />);
    expect(wrappers()[0]).toHaveClass("animate-msg-in");
    expect(wrappers()[1]).toHaveClass("animate-msg-in");
    expect(wrappers()[1]).not.toHaveAttribute("data-no-anim");
  });

  it("skips the entrance animation for blocks flushed by a >2KB delta (保险丝)", () => {
    const { container, rerender } = render(<StreamingMarkdown text={"第一段"} />);
    const big = "x".repeat(STREAM_ANIM_FUSE_BYTES + 1);
    rerender(<StreamingMarkdown text={`第一段\n\n${big}`} />);
    const wrappers = container.firstElementChild!.children;
    // 已稳定块保持原判定；本批新块加 data-no-anim、不挂 animate 类。
    expect(wrappers[0]).toHaveClass("animate-msg-in");
    expect(wrappers[1]).not.toHaveClass("animate-msg-in");
    expect(wrappers[1]).toHaveAttribute("data-no-anim");
  });
});
