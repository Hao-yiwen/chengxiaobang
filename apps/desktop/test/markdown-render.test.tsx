// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { Markdown } from "../src/renderer/components/Markdown";
import { setupI18n } from "../src/renderer/i18n";

beforeAll(() => {
  setupI18n("zh");
});

describe("Markdown", () => {
  it("renders safe http links as external anchors", () => {
    render(<Markdown text="see [docs](https://example.com) here" />);
    const link = screen.getByRole("link", { name: "docs" });
    expect(link).toHaveAttribute("href", "https://example.com");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("does not linkify unsafe protocols, keeping the text visible", () => {
    render(<Markdown text="[x](javascript:alert)" />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("x")).toBeInTheDocument();
  });

  it("copies a code block to the clipboard and shows a copied state", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true
    });

    render(<Markdown text={"```ts\nconst x = 1;\n```"} />);
    fireEvent.click(screen.getByText("复制"));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("const x = 1;"));
    expect(await screen.findByText("已复制")).toBeInTheDocument();
  });

  it("highlights code blocks with a known language", () => {
    const { container } = render(<Markdown text={"```ts\nconst x = 1;\n```"} />);
    expect(container.querySelector(".hljs-keyword")).not.toBeNull();
  });

  it("renders code blocks with unknown languages without crashing", () => {
    const { container } = render(<Markdown text={"```nosuchlang\nfoo bar\n```"} />);
    expect(container.querySelector("pre")).toHaveTextContent("foo bar");
  });

  it("renders GFM tables", () => {
    render(<Markdown text={"| 名称 | 值 |\n| --- | --- |\n| 端口 | 8080 |"} />);
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "名称" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "8080" })).toBeInTheDocument();
  });

  it("renders strikethrough as del", () => {
    const { container } = render(<Markdown text="keep ~~gone~~" />);
    expect(container.querySelector("del")).toHaveTextContent("gone");
  });

  it("renders task lists as disabled checkboxes", () => {
    render(<Markdown text={"- [x] done\n- [ ] todo"} />);
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes).toHaveLength(2);
    expect(boxes[0]).toBeChecked();
    expect(boxes[1]).not.toBeChecked();
    expect(boxes[0]).toBeDisabled();
  });

  it("renders blockquotes", () => {
    const { container } = render(<Markdown text="> 引用内容" />);
    expect(container.querySelector("blockquote")).toHaveTextContent("引用内容");
  });

  it("renders nested lists", () => {
    const { container } = render(<Markdown text={"- a\n  - b"} />);
    expect(container.querySelector("li ul li")).toHaveTextContent("b");
  });

  it("renders semantic headings", () => {
    render(<Markdown text={"# 一级\n\n## 二级"} />);
    expect(screen.getByRole("heading", { level: 1, name: "一级" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "二级" })).toBeInTheDocument();
  });

  it("keeps inline code pill styling distinct from block code", () => {
    const { container } = render(<Markdown text="run `pnpm dev` now" />);
    const inline = container.querySelector("code");
    expect(inline).toHaveTextContent("pnpm dev");
    expect(inline?.className).toContain("bg-muted");
  });
});
