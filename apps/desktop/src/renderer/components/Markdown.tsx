import { Check, Copy } from "lucide-react";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { parseBlocks, type Inline } from "@/lib/markdown";
import { cn } from "@/lib/utils";

/**
 * Renders the assistant's Markdown output: paragraphs, fenced code blocks,
 * inline code, bold, headings and lists. Deliberately small — see
 * {@link "@/lib/markdown"} for the tokenizer.
 */
export function Markdown({ text, className }: { text: string; className?: string }) {
  const blocks = parseBlocks(text);
  return (
    <div className={cn("space-y-3 text-[15px] leading-[1.7]", className)}>
      {blocks.map((block, index) => {
        switch (block.type) {
          case "code":
            return <CodeBlock key={index} lang={block.lang} content={block.content} />;
          case "heading": {
            const sizes = ["text-lg", "text-base", "text-[15px]"];
            return (
              <p
                key={index}
                className={cn("font-semibold tracking-tight", sizes[block.level - 1] ?? sizes[2])}
              >
                {renderInlines(block.inlines)}
              </p>
            );
          }
          case "list":
            return block.ordered ? (
              <ol key={index} className="ml-1 list-inside list-decimal space-y-1.5 marker:text-muted-foreground">
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex} className="pl-1">
                    {renderInlines(item)}
                  </li>
                ))}
              </ol>
            ) : (
              <ul key={index} className="ml-1 space-y-1.5">
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex} className="flex gap-2.5">
                    <span className="mt-[0.66em] size-1.5 flex-none rounded-full bg-foreground/60" />
                    <span className="min-w-0 flex-1">{renderInlines(item)}</span>
                  </li>
                ))}
              </ul>
            );
          default:
            return (
              <p key={index} className="whitespace-pre-wrap break-words">
                {renderInlines(block.inlines)}
              </p>
            );
        }
      })}
    </div>
  );
}

function renderInlines(inlines: Inline[]): ReactNode {
  return inlines.map((inline, index) => {
    if (inline.type === "code") {
      return (
        <code
          key={index}
          className="rounded-[5px] bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-foreground"
        >
          {inline.value}
        </code>
      );
    }
    if (inline.type === "bold") {
      return (
        <strong key={index} className="font-semibold">
          {inline.value}
        </strong>
      );
    }
    return <Fragment key={index}>{inline.value}</Fragment>;
  });
}

/** ChatGPT-style code block: header with language label + copy action. */
function CodeBlock({ lang, content }: { lang?: string; content: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setCopied(false), 1600);
    } catch (error) {
      console.warn("复制代码失败", error);
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border bg-surface/80">
      <div className="flex items-center justify-between border-b border-border/70 py-1 pl-3.5 pr-1.5">
        <span className="font-mono text-[11px] lowercase tracking-wide text-muted-foreground">
          {lang ?? ""}
        </span>
        <button
          type="button"
          onClick={() => void copy()}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          {copied ? t("chat.copied") : t("chat.copy")}
        </button>
      </div>
      <pre className="overflow-x-auto px-3.5 py-3 font-mono text-[12.5px] leading-relaxed text-foreground/90">
        <code>{content}</code>
      </pre>
    </div>
  );
}
