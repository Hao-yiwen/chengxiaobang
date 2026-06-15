import { type ComponentPropsWithoutRef, memo } from "react";
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
  ...Object.values(defaultRehypePlugins)
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

const STREAMDOWN_SHIKI_THEME: StreamdownProps["shikiTheme"] = ["github-light", "github-dark"];

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
    console.warn("[Markdown] 已拦截非 HTTP(S) 链接", {
      url,
      tagName: node.tagName
    });
    return null;
  }
  return defaultUrlTransform(url, key, node);
};

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
  return (
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
      shikiTheme={STREAMDOWN_SHIKI_THEME}
      lineNumbers={false}
      isAnimating={isAnimating}
      animated={mode === "streaming" ? STREAMDOWN_ANIMATION : false}
      caret={mode === "streaming" ? "circle" : undefined}
    >
      {text}
    </Streamdown>
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
