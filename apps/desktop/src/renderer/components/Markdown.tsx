import { memo } from "react";
import ReactMarkdown, { type Components, type Options } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { CodeBlock } from "@/components/markdown/CodeBlock";
import {
  hastText,
  isSafeHref,
  languageFromClass,
  rehypeMarkCodeBlocks,
  type HastNode
} from "@/lib/markdown-utils";
import { cn } from "@/lib/utils";

const REMARK_PLUGINS: Options["remarkPlugins"] = [remarkGfm, remarkBreaks];
const REHYPE_PLUGINS: Options["rehypePlugins"] = [
  [rehypeHighlight, { detect: false }],
  rehypeMarkCodeBlocks
];

const HEADING_SIZES = ["text-body", "text-body-sm", "text-body-sm"];

function headingClass(level: number): string {
  return cn("font-medium tracking-tight", HEADING_SIZES[level - 1] ?? HEADING_SIZES[2]);
}

const COMPONENTS: Components = {
  p: ({ children }) => <p className="break-words">{children}</p>,
  h1: ({ children }) => <h1 className={headingClass(1)}>{children}</h1>,
  h2: ({ children }) => <h2 className={headingClass(2)}>{children}</h2>,
  h3: ({ children }) => <h3 className={headingClass(3)}>{children}</h3>,
  h4: ({ children }) => <h4 className={headingClass(4)}>{children}</h4>,
  h5: ({ children }) => <h5 className={headingClass(5)}>{children}</h5>,
  h6: ({ children }) => <h6 className={headingClass(6)}>{children}</h6>,
  a: ({ href, children }) =>
    href && isSafeHref(href) ? (
      <a
        href={href}
        target="_blank"
        rel="noreferrer noopener"
        className="font-medium text-link underline decoration-link/40 underline-offset-2 transition-colors hover:decoration-link"
      >
        {children}
      </a>
    ) : (
      <>{children}</>
    ),
  code: ({ node, className, children }) => {
    const isBlock = (node as HastNode | undefined)?.properties?.dataCodeBlock !== undefined;
    if (isBlock) {
      return <code className={className}>{children}</code>;
    }
    return (
      <code className="rounded-xs border border-border/60 bg-muted px-1.5 py-0.5 font-mono text-[0.86em] text-foreground">
        {children}
      </code>
    );
  },
  pre: ({ node, children }) => {
    const codeNode = ((node as HastNode | undefined)?.children ?? []).find(
      (child) => child.tagName === "code"
    );
    return (
      <CodeBlock
        language={languageFromClass(codeNode?.properties?.className)}
        text={hastText(codeNode).replace(/\n$/, "")}
      >
        {children}
      </CodeBlock>
    );
  },
  ul: ({ children }) => (
    <ul className="ml-1 list-outside list-disc space-y-1 pl-4 marker:text-muted-foreground">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="ml-1 list-outside list-decimal space-y-1 pl-4 marker:text-muted-foreground">
      {children}
    </ol>
  ),
  li: ({ className, children }) => (
    <li className={cn("break-words pl-1", className?.includes("task-list-item") && "list-none")}>
      {children}
    </li>
  ),
  input: ({ type, checked }) =>
    type === "checkbox" ? (
      <input
        type="checkbox"
        checked={Boolean(checked)}
        readOnly
        disabled
        className="mr-1.5 inline-block size-3.5 translate-y-[2px] accent-primary"
      />
    ) : null,
  blockquote: ({ children }) => (
    <blockquote className="border-l border-hairline pl-3 text-muted-foreground">
      {children}
    </blockquote>
  ),
  table: ({ children }) => (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-caption">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border bg-canvas-soft-2/70 px-3 py-1.5 text-left font-medium">{children}</th>
  ),
  td: ({ children }) => <td className="border px-3 py-1.5 align-top">{children}</td>,
  del: ({ children }) => <del className="text-muted-foreground line-through">{children}</del>,
  hr: () => <hr className="border-border" />
};

/**
 * 通过 react-markdown + GFM 渲染 assistant 输出，链接、细线与代码高亮遵循 DESIGN.md。
 * 已落库消息在 store 中保持引用稳定，流式阶段只会重复解析尾部内容。
 */
export const Markdown = memo(function Markdown({
  text,
  className
}: {
  text: string;
  className?: string;
}) {
  return (
    <div className={cn("space-y-3 text-body-sm", className)}>
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={REHYPE_PLUGINS}
        components={COMPONENTS}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});
