import { Check, ChevronDown, Copy, Download } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { codeFileName } from "@/lib/code-file";
import { downloadTextFile } from "@/lib/download";
import { useCopy } from "@/lib/use-copy";
import { cn } from "@/lib/utils";

/** Blocks longer than this start collapsed, with an expand footer. */
const COLLAPSE_LINES = 24;

/**
 * Chrome around a fenced code block: language label, copy + download buttons,
 * and auto-collapse for long blocks. `children` is the already-highlighted
 * `<code>` element; `text` the raw source for the clipboard/download.
 *
 * The streaming tail and the settled message render separate instances, so a
 * block stays expanded while it streams in and only collapses once the
 * message settles and this remounts with the full text.
 */
export function CodeBlock({
  language,
  text,
  children
}: {
  language?: string;
  text: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const { copied, copy } = useCopy();
  const lines = text.length === 0 ? 0 : text.split("\n").length;
  const collapsible = lines > COLLAPSE_LINES;
  const [collapsed, setCollapsed] = useState(collapsible);

  return (
    <div className="overflow-hidden rounded-lg border bg-muted/50">
      <div className="flex items-center justify-between border-b bg-muted/60 px-3 py-1.5">
        <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
          {language ?? ""}
        </span>
        <div className="flex items-center gap-3">
          <button
            type="button"
            title={t("chat.codeDownload")}
            aria-label={t("chat.codeDownload")}
            onClick={() => downloadTextFile(codeFileName(language), text)}
            className="flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <Download className="size-3" />
          </button>
          <button
            type="button"
            onClick={() => void copy(text)}
            className="flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
          >
            {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
            {copied ? t("chat.copied") : t("chat.copy")}
          </button>
        </div>
      </div>
      <div className="relative">
        <pre
          className={cn(
            "overflow-x-auto px-3.5 py-3 font-mono text-[12.5px] leading-relaxed text-foreground/90",
            collapsible && collapsed && "max-h-[360px] overflow-hidden"
          )}
        >
          {children}
        </pre>
        {collapsible && collapsed ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-muted to-transparent" />
        ) : null}
      </div>
      {collapsible ? (
        <button
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          className="flex w-full items-center justify-center gap-1 border-t py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
        >
          <ChevronDown
            className={cn("size-3 transition-transform", !collapsed && "rotate-180")}
          />
          {collapsed ? t("chat.codeExpand", { lines }) : t("chat.codeCollapse")}
        </button>
      ) : null}
    </div>
  );
}
