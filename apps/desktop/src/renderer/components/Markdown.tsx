import { type ComponentPropsWithoutRef, memo, useEffect, useMemo, useRef } from "react";
import { code } from "@streamdown/code";
import { cjk } from "@streamdown/cjk";
import { createMathPlugin } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";
import remarkBreaks from "remark-breaks";
import {
  defaultRehypePlugins,
  defaultRemarkPlugins,
  defaultUrlTransform,
  Streamdown,
  type ControlsConfig,
  type CustomRendererProps,
  type MermaidOptions,
  type PluginConfig,
  type StreamdownProps,
  type StreamdownTranslations,
  type UrlTransform
} from "streamdown";
import { CodeBlockPanel } from "@/components/CodeBlockPanel";
import { ExternalUrlAnchor } from "@/components/ExternalUrlMenu";
import { FileLinkAnchor } from "@/components/FileLinkAnchor";
import { localFilePathFromHref } from "../../common/file-preview";
import { useAppStore } from "@/store";
import { rehypeNumericTables } from "@/lib/markdown-utils";
import { cn } from "@/lib/utils";

type MarkdownAstNode = {
  type?: string;
  lang?: string | null;
  children?: MarkdownAstNode[];
};

function remarkDefaultCodeLanguage() {
  return (tree: MarkdownAstNode) => {
    visitMarkdownAst(tree, (node) => {
      if (node.type === "code" && (!node.lang || node.lang.trim().length === 0)) {
        node.lang = "text";
      }
    });
  };
}

function visitMarkdownAst(node: MarkdownAstNode, visitor: (node: MarkdownAstNode) => void) {
  visitor(node);
  node.children?.forEach((child) => visitMarkdownAst(child, visitor));
}

const REMARK_PLUGINS: StreamdownProps["remarkPlugins"] = [
  ...Object.values(defaultRemarkPlugins),
  remarkDefaultCodeLanguage,
  remarkBreaks
];

const REHYPE_PLUGINS: StreamdownProps["rehypePlugins"] = [
  ...Object.values(defaultRehypePlugins),
  rehypeNumericTables
];

const STREAMDOWN_CONTROLS: ControlsConfig = {
  code: false,
  table: false,
  mermaid: { copy: true, download: true, fullscreen: true, panZoom: true }
};

const STREAMDOWN_TRANSLATIONS: Partial<StreamdownTranslations> = {
  close: "关闭",
  copied: "已复制",
  copyCode: "复制代码",
  copyLink: "复制链接",
  downloadDiagram: "下载图表",
  downloadDiagramAsMmd: "下载为 MMD",
  downloadDiagramAsPng: "下载为 PNG",
  downloadDiagramAsSvg: "下载为 SVG",
  downloadImage: "下载图片",
  exitFullscreen: "退出全屏",
  imageNotAvailable: "图片不可用",
  mermaidFormatMmd: "MMD",
  mermaidFormatPng: "PNG",
  mermaidFormatSvg: "SVG",
  viewFullscreen: "全屏查看"
};

const STREAMDOWN_MERMAID: MermaidOptions = {
  config: {
    securityLevel: "strict",
    theme: "base",
    fontFamily:
      "Inter, -apple-system, BlinkMacSystemFont, PingFang SC, Hiragino Sans GB, Microsoft YaHei, sans-serif",
    themeVariables: {
      background: "#ffffff",
      mainBkg: "#ffffff",
      primaryColor: "#fafafa",
      primaryTextColor: "#171717",
      primaryBorderColor: "#ebebeb",
      lineColor: "#a1a1a1",
      secondaryColor: "#f5f5f5",
      tertiaryColor: "#d3e5ff"
    }
  }
};

const STREAMDOWN_ANIMATION: StreamdownProps["animated"] = {
  animation: "fadeIn",
  duration: 120,
  easing: "ease-out",
  sep: "word",
  stagger: 12
};

type MarkdownCodeProps = ComponentPropsWithoutRef<"code"> & {
  node?: unknown;
};

const STREAMDOWN_CODE_RENDERER_LANGUAGES: string[] = [
  ...code.getSupportedLanguages().filter((language) => language !== "mermaid"),
  "text"
];

function MarkdownCodeRenderer({
  code: codeText,
  isIncomplete,
  language
}: CustomRendererProps) {
  return <CodeBlockPanel code={codeText} isIncomplete={isIncomplete} language={language} />;
}

function MarkdownInlineCode({
  children,
  className,
  node: _node,
  ...props
}: MarkdownCodeProps) {
  return (
    <code
      className={cn("rounded bg-muted px-1 py-px font-mono text-[0.85em]", className)}
      data-streamdown="inline-code"
      {...props}
    >
      {children}
    </code>
  );
}

const STREAMDOWN_PLUGINS: PluginConfig = {
  code,
  mermaid,
  math: createMathPlugin(),
  cjk,
  renderers: [
    {
      component: MarkdownCodeRenderer,
      language: STREAMDOWN_CODE_RENDERER_LANGUAGES
    }
  ]
};

const STREAMDOWN_COMPONENTS: StreamdownProps["components"] = {
  a: ({ href, children, className, node: _node, ...props }) => {
    const url = typeof href === "string" ? href : "";
    // 指向本地文件的链接渲染成行内文件链接，点击在右侧预览；其余仍作为外链处理
    const filePath = localFilePathFromHref(url);
    if (filePath) {
      return (
        <FileLinkAnchor path={filePath} className={className}>
          {children}
        </FileLinkAnchor>
      );
    }
    return (
      <ExternalUrlAnchor
        href={url}
        className={cn("wrap-anywhere font-medium text-primary underline", className)}
        {...props}
      >
        {children}
      </ExternalUrlAnchor>
    );
  },
  inlineCode: MarkdownInlineCode
};

const HTTP_URL_TRANSFORM: UrlTransform = (url, key, node) => {
  if (key === "href" && url === "streamdown:incomplete-link") {
    return url;
  }
  if (key === "href" && !/^https?:\/\//i.test(url)) {
    // 指向本地文件的链接放行，交给 a 渲染器渲染成可点击的文件链接
    if (localFilePathFromHref(url)) {
      return url;
    }
    console.warn("[Markdown] 已拦截非 HTTP(S) 链接", {
      url,
      tagName: node.tagName
    });
    return null;
  }
  return defaultUrlTransform(url, key, node);
};

function useScrollOverflowDetection(containerRef: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const roMap = new Map<Element, ResizeObserver>();
    const scrollListeners = new Map<HTMLElement, () => void>();

    function applyScrollClasses(wrapper: Element, scrollable: HTMLElement) {
      const maxScroll = scrollable.scrollWidth - scrollable.clientWidth;
      wrapper.classList.toggle("has-scroll-right", maxScroll > 1 && scrollable.scrollLeft < maxScroll - 1);
      wrapper.classList.toggle("has-scroll-left", scrollable.scrollLeft > 1);
    }

    function observeElement(wrapper: Element, scrollable: HTMLElement) {
      if (roMap.has(wrapper)) return;

      const onScroll = () => applyScrollClasses(wrapper, scrollable);
      scrollable.addEventListener("scroll", onScroll, { passive: true });
      scrollListeners.set(scrollable, onScroll);

      const ro = new ResizeObserver(() => applyScrollClasses(wrapper, scrollable));
      ro.observe(scrollable);
      ro.observe(wrapper);
      roMap.set(wrapper, ro);

      applyScrollClasses(wrapper, scrollable);
    }

    // 表格：wrapper = [data-streamdown="table-wrapper"]，scrollable = 其最后一个子 div
    function observeTable(wrapper: Element) {
      const scrollable = wrapper.querySelector(":scope > div:last-child") as HTMLElement | null;
      if (scrollable) observeElement(wrapper, scrollable);
    }

    // 代码块：wrapper = .cxb-code-block-shell 内的 [data-streamdown="code-block"]，
    //         scrollable = [data-streamdown="code-block-body"]（两种实现共用此结构）
    function observeCodeBlock(wrapper: Element) {
      const scrollable = wrapper.querySelector('[data-streamdown="code-block-body"]') as HTMLElement | null;
      if (scrollable) observeElement(wrapper, scrollable);
    }

    container.querySelectorAll('[data-streamdown="table-wrapper"]').forEach(observeTable);
    container.querySelectorAll('.cxb-code-block-shell > [data-streamdown="code-block"]').forEach(observeCodeBlock);

    const mo = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (!(node instanceof Element)) continue;
          if (node.matches('[data-streamdown="table-wrapper"]')) observeTable(node);
          node.querySelectorAll('[data-streamdown="table-wrapper"]').forEach(observeTable);
          if (node.matches('[data-streamdown="code-block"]') && node.closest('.cxb-code-block-shell')) {
            observeCodeBlock(node);
          }
          node.querySelectorAll('.cxb-code-block-shell > [data-streamdown="code-block"]').forEach(observeCodeBlock);
        }
      }
    });

    mo.observe(container, { childList: true, subtree: true });

    return () => {
      mo.disconnect();
      roMap.forEach((ro) => ro.disconnect());
      scrollListeners.forEach((fn, el) => el.removeEventListener("scroll", fn));
    };
  }, [containerRef]);
}

function MarkdownStream({
  text,
  className,
  mode,
  isAnimating = false
}: {
  text: string;
  className?: string;
  mode: "static" | "streaming";
  isAnimating?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const codePreviewSettings = useAppStore((state) => state.codePreviewSettings);
  const shikiTheme = useMemo<StreamdownProps["shikiTheme"]>(
    () => [codePreviewSettings.lightTheme, codePreviewSettings.darkTheme],
    [codePreviewSettings.darkTheme, codePreviewSettings.lightTheme]
  );
  useScrollOverflowDetection(containerRef);

  return (
    <div ref={containerRef} style={{ display: "contents" }}>
    <Streamdown
      mode={mode}
      dir="auto"
      className={cn("markdown-streamdown text-foreground", className)}
      controls={STREAMDOWN_CONTROLS}
      translations={STREAMDOWN_TRANSLATIONS}
      components={STREAMDOWN_COMPONENTS}
      urlTransform={HTTP_URL_TRANSFORM}
      remarkPlugins={REMARK_PLUGINS}
      rehypePlugins={REHYPE_PLUGINS}
      plugins={STREAMDOWN_PLUGINS}
      mermaid={STREAMDOWN_MERMAID}
      shikiTheme={shikiTheme}
      lineNumbers={false}
      isAnimating={isAnimating}
      animated={mode === "streaming" ? STREAMDOWN_ANIMATION : false}
      caret={mode === "streaming" ? "circle" : undefined}
    >
      {text}
    </Streamdown>
    </div>
  );
}

export const StreamdownMarkdown = memo(MarkdownStream);

/**
 * 统一的 assistant Markdown 渲染入口：普通消息使用 Streamdown static 模式，
 * 流式消息复用同一套插件和视觉适配，避免两条 Markdown 链路继续分叉。
 */
export const Markdown = memo(function Markdown({
  text,
  className
}: {
  text: string;
  className?: string;
}) {
  return <StreamdownMarkdown text={text} className={className} mode="static" />;
});
