import { type ComponentPropsWithoutRef, memo, useEffect, useMemo, useRef } from "react";
import { code } from "@streamdown/code";
import { cjk } from "@streamdown/cjk";
import { createMathPlugin } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";
import remarkBreaks from "remark-breaks";
import {
  Block,
  defaultRehypePlugins,
  defaultRemarkPlugins,
  defaultUrlTransform,
  Streamdown,
  type BlockProps,
  type ControlsConfig,
  type CustomRendererProps,
  type MermaidOptions,
  type PluginConfig,
  type StreamdownProps,
  type StreamdownTranslations,
  type UrlTransform
} from "streamdown";
import { CheckMediumIcon, CopyIcon as BuiltinCopyIcon } from "@/assets/file-type-icons";
import { CodeBlockPanel } from "@/components/CodeBlockPanel";
import { ExternalUrlAnchor } from "@/components/ExternalUrlMenu";
import { FileLinkAnchor } from "@/components/FileLinkAnchor";
import { localFilePathFromHref, markdownLocalFileHrefFromPath } from "../../common/file-preview";
import { useAppStore } from "@/store";
import { rehypeNumericTables } from "@/lib/markdown-utils";
import { cn } from "@/lib/utils";
import styles from "@/components/Markdown.module.css";

type MarkdownAstNode = {
  type?: string;
  lang?: string | null;
  url?: string;
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

function remarkLocalFileLinks() {
  return (tree: MarkdownAstNode) => {
    visitMarkdownAst(tree, (node) => {
      if (node.type !== "link" || typeof node.url !== "string") {
        return;
      }
      const filePath = localFilePathFromHref(node.url);
      if (!filePath) {
        return;
      }
      // Streamdown 的安全插件会先拦截裸相对路径；包成内部 HTTPS href 后，
      // 后续 a 渲染器再还原成工作区相对文件路径并打开右侧预览。
      node.url = markdownLocalFileHrefFromPath(filePath);
    });
  };
}

const REMARK_PLUGINS: StreamdownProps["remarkPlugins"] = [
  ...Object.values(defaultRemarkPlugins),
  remarkLocalFileLinks,
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
  mermaid: { copy: true, download: false, fullscreen: false, panZoom: false }
};

const STREAMDOWN_ICONS: StreamdownProps["icons"] = {
  CheckIcon: CheckMediumIcon,
  CopyIcon: BuiltinCopyIcon
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
      'ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"',
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

const MERMAID_PREVIEW_MAX_WIDTH = 1040;
const MERMAID_PREVIEW_MAX_HEIGHT = 680;

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
        className={cn(
          className,
          "wrap-anywhere font-medium text-link no-underline transition-colors hover:text-link-deep hover:no-underline"
        )}
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

function parseSvgLength(value: string | null) {
  if (!value) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function getSvgIntrinsicSize(svg: SVGSVGElement) {
  const viewBox = svg.getAttribute("viewBox")?.trim().split(/\s+/).map(Number);
  if (viewBox && viewBox.length === 4 && viewBox.every(Number.isFinite) && viewBox[2] > 0 && viewBox[3] > 0) {
    return { width: viewBox[2], height: viewBox[3] };
  }

  const width = parseSvgLength(svg.getAttribute("width"));
  const height = parseSvgLength(svg.getAttribute("height"));
  if (width && height) {
    return { width, height };
  }

  return null;
}

function useMermaidAutoFit(containerRef: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const root = container;

    let frameId = 0;
    const observed = new Set<Element>();
    const resizeObserver = new ResizeObserver(() => scheduleFit());

    function fitMermaid(mermaidRoot: HTMLElement) {
      const svg = mermaidRoot.querySelector("svg");
      if (!(svg instanceof SVGSVGElement)) return;

      const intrinsicSize = getSvgIntrinsicSize(svg);
      if (!intrinsicSize) return;

      const availableWidth = Math.min(
        MERMAID_PREVIEW_MAX_WIDTH,
        Math.max(1, mermaidRoot.clientWidth || mermaidRoot.parentElement?.clientWidth || MERMAID_PREVIEW_MAX_WIDTH)
      );
      const scale = Math.min(
        availableWidth / intrinsicSize.width,
        MERMAID_PREVIEW_MAX_HEIGHT / intrinsicSize.height
      );
      const width = Math.max(1, Math.round(intrinsicSize.width * scale));
      const height = Math.max(1, Math.round(intrinsicSize.height * scale));

      mermaidRoot.style.setProperty("--cxb-mermaid-fit-width", `${width}px`);
      mermaidRoot.style.setProperty("--cxb-mermaid-fit-height", `${height}px`);
    }

    function fitAllMermaid() {
      root.querySelectorAll('[data-streamdown="mermaid"]').forEach((node) => {
        if (node instanceof HTMLElement) {
          fitMermaid(node);
        }
      });
    }

    function scheduleFit() {
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }
      frameId = window.requestAnimationFrame(() => {
        frameId = 0;
        fitAllMermaid();
      });
    }

    function observeMermaid(node: Element) {
      if (observed.has(node)) return;
      observed.add(node);
      resizeObserver.observe(node);
      const svg = node.querySelector("svg");
      if (svg) {
        resizeObserver.observe(svg);
      }
      scheduleFit();
    }

    root.querySelectorAll('[data-streamdown="mermaid"]').forEach(observeMermaid);

    const mutationObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (!(node instanceof Element)) continue;
          if (node.matches('[data-streamdown="mermaid"]')) {
            observeMermaid(node);
          }
          node.querySelectorAll('[data-streamdown="mermaid"]').forEach(observeMermaid);
          if (node.matches("svg") || node.querySelector("svg")) {
            scheduleFit();
          }
        }
      }
    });

    mutationObserver.observe(root, { childList: true, subtree: true });
    scheduleFit();

    return () => {
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }
      mutationObserver.disconnect();
      resizeObserver.disconnect();
      observed.clear();
    };
  }, [containerRef]);
}

function StreamingMarkdownBlock({ content, dir, ...props }: BlockProps) {
  if (!content.trim()) {
    return null;
  }

  return (
    <div
      className={cn("markdown-streamdown-block", styles.block)}
      data-cxb-streaming-markdown-block=""
      dir={dir}
    >
      <Block content={content} {...props} />
    </div>
  );
}

function streamCaretJsonForLog(payload: Record<string, unknown>): string {
  try {
    return JSON.stringify(payload);
  } catch (error) {
    return JSON.stringify({
      serializeError: error instanceof Error ? error.message : String(error)
    });
  }
}

function MarkdownStream({
  text,
  className,
  mode,
  isAnimating = false,
  showCaret = true
}: {
  text: string;
  className?: string;
  mode: "static" | "streaming";
  isAnimating?: boolean;
  showCaret?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const hiddenCaretLogKeyRef = useRef<string | undefined>(undefined);
  const codePreviewSettings = useAppStore((state) => state.codePreviewSettings);
  const shikiTheme = useMemo<StreamdownProps["shikiTheme"]>(
    () => [codePreviewSettings.lightTheme, codePreviewSettings.darkTheme],
    [codePreviewSettings.darkTheme, codePreviewSettings.lightTheme]
  );
  useScrollOverflowDetection(containerRef);
  useMermaidAutoFit(containerRef);

  useEffect(() => {
    if (mode !== "streaming" || showCaret) {
      hiddenCaretLogKeyRef.current = undefined;
      return;
    }
    const logKey = `${mode}:${isAnimating ? "animating" : "still"}:${className ?? ""}`;
    if (hiddenCaretLogKeyRef.current === logKey) {
      return;
    }
    hiddenCaretLogKeyRef.current = logKey;
    console.info(
      "[stream-caret-debug] markdown-caret-disabled " +
        streamCaretJsonForLog({
          mode,
          textChars: text.length,
          isAnimating,
          className: className ?? null,
          caret: "disabled"
        })
    );
  }, [className, isAnimating, mode, showCaret, text.length]);

  return (
    <div ref={containerRef} style={{ display: "contents" }}>
      <Streamdown
        mode={mode}
        dir="auto"
        className={cn("markdown-streamdown text-foreground", styles.root, className)}
        controls={STREAMDOWN_CONTROLS}
        icons={STREAMDOWN_ICONS}
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
        caret={mode === "streaming" && showCaret ? "circle" : undefined}
        BlockComponent={mode === "streaming" ? StreamingMarkdownBlock : undefined}
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
