// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Markdown } from "../src/renderer/components/Markdown";
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
  vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Markdown", () => {
  it("uses foreground color for normal conversation body text", () => {
    const { container } = render(<Markdown text="普通正文应该保持黑色" />);
    const root = container.querySelector(".markdown-streamdown");

    expect(root).toHaveClass("text-foreground");
    expect(root).not.toHaveClass("text-body");
  });

  it("renders safe http links through Streamdown link safety", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);

    render(<Markdown text="see [docs](https://example.com) here" />);
    fireEvent.click(screen.getByRole("button", { name: "docs" }));

    expect(screen.getByText("打开外部链接？")).toBeInTheDocument();
    expect(screen.getByText(/^https:\/\/example\.com\/?$/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "打开链接" }));
    expect(open).toHaveBeenCalledWith("https://example.com/", "_blank", "noreferrer");
  });

  it("does not linkify unsafe protocols, keeping the text visible", () => {
    render(<Markdown text="[x](javascript:alert)" />);

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "x" })).not.toBeInTheDocument();
    expect(screen.getByText(/x \[blocked\]/)).toBeInTheDocument();
  });

  it("keeps single line breaks via remark-breaks", () => {
    const { container } = render(<Markdown text={"第一行\n第二行"} />);
    expect(container.querySelector("br")).not.toBeNull();
    expect(container).toHaveTextContent(/第一行\s*第二行/);
  });

  it("renders Streamdown code block controls and copies code", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true
    });

    const { container } = render(<Markdown text={"```ts\nconst x = 1;\n```"} />);

    expect(container.querySelector('[data-streamdown="code-block"]')).not.toBeNull();
    expect(screen.getByText("ts")).toBeInTheDocument();

    fireEvent.click(screen.getByTitle("复制代码"));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining("const x = 1")));
    expect(await screen.findByTitle("复制代码")).toBeInTheDocument();
  });

  it("downloads a code block with Streamdown language-mapped extension", () => {
    const createObjectURL = vi.fn(() => "blob:mock");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL, revokeObjectURL }));
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    let downloadName = "";
    const setter = vi
      .spyOn(HTMLAnchorElement.prototype, "download", "set")
      .mockImplementation(function (this: HTMLAnchorElement, value: string) {
        downloadName = value;
      });

    render(<Markdown text={"```ts\nconst x = 1;\n```"} />);
    fireEvent.click(screen.getByTitle("下载文件"));

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(downloadName).toMatch(/\.ts$/);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock");

    click.mockRestore();
    setter.mockRestore();
  });

  it("renders GFM tables with Streamdown controls and numeric column markers", () => {
    render(
      <Markdown
        text={"| 名称 | 值 |\n| --- | --- |\n| 端口 | 8080 |\n| 线程 | 12 |\n| 备注 | x |"}
      />
    );

    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "名称" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "8080" })).toHaveAttribute("data-numeric-col");
    expect(screen.getByTitle("复制表格")).toBeInTheDocument();
    expect(screen.getByTitle("下载表格")).toBeInTheDocument();
    expect(screen.getByTitle("全屏查看")).toBeInTheDocument();
  });

  it("opens Streamdown table fullscreen as a modal portal", () => {
    render(<Markdown text={"| 名称 | 值 |\n| --- | --- |\n| 端口 | 8080 |"} />);

    fireEvent.click(screen.getByTitle("全屏查看"));

    const dialog = screen.getByRole("dialog", { name: "全屏查看" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("data-streamdown", "table-fullscreen");
    expect(screen.getByTitle("退出全屏")).toBeInTheDocument();
  });

  it("renders strikethrough, task lists, nested lists and headings", () => {
    const { container } = render(
      <Markdown text={"# 一级\n\n- [x] done\n  - child\n\nkeep ~~gone~~"} />
    );

    expect(screen.getByRole("heading", { level: 1, name: "一级" })).toBeInTheDocument();
    expect(screen.getAllByRole("checkbox")[0]).toBeChecked();
    expect(container.querySelector("li ul li")).toHaveTextContent("child");
    expect(container.querySelector("del")).toHaveTextContent("gone");
  });

  it("keeps inline code distinct from block code", () => {
    const { container } = render(<Markdown text="run `pnpm dev` now" />);
    const inline = container.querySelector('[data-streamdown="inline-code"]');
    expect(inline).toHaveTextContent("pnpm dev");
  });

  it("renders math through KaTeX", () => {
    const { container } = render(<Markdown text={"$$\na^2 + b^2 = c^2\n$$"} />);
    expect(container.querySelector(".katex")).not.toBeNull();
  });

  it("routes Mermaid fences into Streamdown Mermaid renderer and controls", async () => {
    const { container } = render(
      <Markdown text={"```mermaid\ngraph TD\n  A[开始] --> B[结束]\n```"} />
    );

    await waitFor(() => {
      expect(container.querySelector('[data-streamdown="mermaid-block"]')).not.toBeNull();
    });
    expect(screen.getByText("mermaid")).toBeInTheDocument();
    expect(screen.getByTitle("下载图表")).toBeInTheDocument();
    expect(screen.getByTitle("复制代码")).toBeInTheDocument();
    expect(screen.getByTitle("全屏查看")).toBeInTheDocument();
  });
});
