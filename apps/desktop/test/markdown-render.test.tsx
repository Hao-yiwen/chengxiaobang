// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetExternalUrlBrowserCacheForTest } from "../src/renderer/components/ExternalUrlMenu";
import { Markdown } from "../src/renderer/components/Markdown";
import { setupI18n } from "../src/renderer/i18n";
import { DEFAULT_CODE_PREVIEW_SETTINGS } from "../src/renderer/lib/code-preview-settings";
import { resetAppStore, useAppStore } from "../src/renderer/store";

const shikiMock = vi.hoisted(() => ({
  bundledLanguages: {
    bash: {},
    javascript: {},
    text: {},
    typescript: {}
  },
  codeToTokensWithThemes: vi.fn(async (text: string) =>
    text.replace(/\r\n?/g, "\n").split("\n").map((line) =>
      line
        ? [
            {
              content: line,
              variants: {
                light: { color: "#0969da" },
                dark: { color: "#79c0ff" }
              }
            }
          ]
        : []
    )
  )
}));

vi.mock("shiki", () => shikiMock);

beforeAll(() => {
  setupI18n("zh");
});

beforeEach(() => {
  resetAppStore();
  shikiMock.codeToTokensWithThemes.mockClear();
  class MockResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  class MockIntersectionObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
  vi.stubGlobal("ResizeObserver", MockResizeObserver);
});

afterEach(() => {
  resetExternalUrlBrowserCacheForTest();
  delete (window as { chengxiaobang?: unknown }).chengxiaobang;
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

  it("opens safe http links directly without showing the old modal", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);

    render(<Markdown text="see [docs](https://example.com) here" />);
    fireEvent.click(screen.getByRole("link", { name: "docs" }));

    expect(screen.queryByText("打开外部链接？")).not.toBeInTheDocument();
    await waitFor(() =>
      expect(open).toHaveBeenCalledWith("https://example.com/", "_blank", "noreferrer")
    );
  });

  it("opens a markdown link with a selected browser from the right click menu", async () => {
    const detectExternalBrowsers = vi.fn(async () => [
      {
        id: "chrome",
        name: "Google Chrome",
        appPath: "/Applications/Google Chrome.app"
      }
    ]);
    const openExternalUrlInBrowser = vi.fn(async () => ({ ok: true }));
    window.chengxiaobang = {
      detectExternalBrowsers,
      openExternalUrlInBrowser
    } as NonNullable<Window["chengxiaobang"]>;

    render(<Markdown text="see [docs](https://example.com) here" />);
    fireEvent.contextMenu(screen.getByRole("link", { name: "docs" }));

    expect(await screen.findByText("默认浏览器")).toBeInTheDocument();
    expect(await screen.findByText("Google Chrome")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Google Chrome"));

    await waitFor(() =>
      expect(openExternalUrlInBrowser).toHaveBeenCalledWith("chrome", "https://example.com/")
    );
  });

  it("keeps the default browser menu item when the desktop bridge is unavailable", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);

    render(<Markdown text="see [docs](https://example.com) here" />);
    fireEvent.contextMenu(screen.getByRole("link", { name: "docs" }));

    fireEvent.click(await screen.findByText("默认浏览器"));

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

  it("renders the rewritten code block controls and copies code", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true
    });

    const { container } = render(<Markdown text={"```ts\nconst x = 1;\n```"} />);

    expect(container.querySelector('[data-streamdown="code-block"]')).not.toBeNull();
    expect(screen.getByText("ts")).toBeInTheDocument();
    const shell = container.querySelector(".cxb-code-block-shell");
    expect(shell).toHaveAttribute("data-code-wrap", "false");
    expect(shell).toHaveAttribute("data-code-line-numbers", "false");
    expect(shell).toHaveAttribute("data-code-font-size", "12");
    expect(shell?.getAttribute("style")).toContain("--cxb-code-font-size: 12px");
    expect(shell?.getAttribute("style")).toContain("font-size: 12px");
    expect(screen.queryByTitle("下载文件")).not.toBeInTheDocument();

    const code = container.querySelector('[data-streamdown="code-block-body"] code');
    expect(code?.getAttribute("class") ?? "").not.toContain("counter");
    expect(container.querySelector(".cxb-code-line-number")).toBeNull();
    await waitFor(() =>
      expect(shikiMock.codeToTokensWithThemes).toHaveBeenCalledWith(expect.stringContaining("const x = 1;"), {
        lang: "typescript",
        themes: { light: "github-light", dark: "github-dark" }
      })
    );

    fireEvent.click(screen.getByRole("button", { name: "自动换行" }));
    expect(screen.getByRole("button", { name: "关闭自动换行" })).toHaveAttribute("aria-pressed", "true");
    expect(shell).toHaveAttribute("data-code-wrap", "true");

    fireEvent.click(screen.getByRole("button", { name: "复制代码" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining("const x = 1")));
    expect(await screen.findByRole("button", { name: "复制代码" })).toBeInTheDocument();
  });

  it("applies global code preview settings to markdown code blocks", async () => {
    useAppStore.setState({
      codePreviewSettings: {
        ...DEFAULT_CODE_PREVIEW_SETTINGS,
        darkTheme: "vitesse-dark",
        fontSize: 14,
        lightTheme: "vitesse-light",
        wrapLongLines: true
      }
    });

    const { container } = render(<Markdown text={"```ts\nconst x = 1;\n```"} />);
    const shell = container.querySelector(".cxb-code-block-shell");

    expect(shell).toHaveAttribute("data-code-wrap", "true");
    expect(shell).toHaveAttribute("data-code-line-numbers", "false");
    expect(shell).toHaveAttribute("data-code-font-size", "14");
    expect(shell?.getAttribute("style")).toContain("font-size: 14px");
    expect(container.querySelector(".cxb-code-line-number")).toBeNull();
    await waitFor(() =>
      expect(shikiMock.codeToTokensWithThemes).toHaveBeenCalledWith(expect.stringContaining("const x = 1;"), {
        lang: "typescript",
        themes: { light: "vitesse-light", dark: "vitesse-dark" }
      })
    );
  });

  it("renders bash fences with the rewritten code block chrome", () => {
    const { container } = render(<Markdown text={"```bash\npnpm test\n```"} />);

    expect(container.querySelector(".cxb-code-block-shell")).not.toBeNull();
    expect(screen.getByText("bash")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "自动换行" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "复制代码" })).toBeInTheDocument();
    expect(screen.queryByTitle("下载文件")).not.toBeInTheDocument();
  });

  it("renders unlabeled fences with the rewritten text code block chrome", () => {
    const codeText = "feature/* -> MR -> dev\npreview_train -> main";
    const { container } = render(<Markdown text={`\`\`\`\n${codeText}\n\`\`\``} />);

    expect(container.querySelector(".cxb-code-block-shell")).not.toBeNull();
    expect(screen.getByText("text")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "自动换行" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "复制代码" })).toBeInTheDocument();
    expect(screen.getByText("feature/* -> MR -> dev")).toBeInTheDocument();
    expect(screen.getByText("preview_train -> main")).toBeInTheDocument();
    expect(container.querySelector('[data-streamdown="code-block"][data-language=""]')).toBeNull();
  });

  it("renders GFM tables without Streamdown controls and keeps numeric column markers", () => {
    render(
      <Markdown
        text={"| 名称 | 值 |\n| --- | --- |\n| 端口 | 8080 |\n| 线程 | 12 |\n| 备注 | x |"}
      />
    );

    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "名称" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "8080" })).toHaveAttribute("data-numeric-col");
    expect(screen.queryByTitle("复制表格")).not.toBeInTheDocument();
    expect(screen.queryByTitle("下载表格")).not.toBeInTheDocument();
    expect(screen.queryByTitle("全屏查看")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "全屏查看" })).not.toBeInTheDocument();
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
    expect(screen.getByRole("button", { name: "复制代码" })).toBeInTheDocument();
    expect(screen.getByTitle("全屏查看")).toBeInTheDocument();
  });
});
