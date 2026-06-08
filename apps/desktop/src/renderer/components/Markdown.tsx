import { Fragment, type ReactNode } from "react";
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
    <div className={cn("space-y-3 text-[14.5px] leading-relaxed", className)}>
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
              <ol key={index} className="ml-1 list-inside list-decimal space-y-1 marker:text-muted-foreground">
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex} className="pl-1">
                    {renderInlines(item)}
                  </li>
                ))}
              </ol>
            ) : (
              <ul key={index} className="ml-1 space-y-1">
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex} className="flex gap-2">
                    <span className="mt-[0.55em] size-1.5 flex-none rounded-full bg-brand/60" />
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
          className="rounded-[5px] border border-border/60 bg-muted px-1.5 py-0.5 font-mono text-[0.86em] text-foreground"
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

function CodeBlock({ lang, content }: { lang?: string; content: string }) {
  return (
    <div className="overflow-hidden rounded-lg border bg-muted/50">
      {lang ? (
        <div className="border-b bg-muted/60 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
          {lang}
        </div>
      ) : null}
      <pre className="overflow-x-auto px-3.5 py-3 font-mono text-[12.5px] leading-relaxed text-foreground/90">
        <code>{content}</code>
      </pre>
    </div>
  );
}
