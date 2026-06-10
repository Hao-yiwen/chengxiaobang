import { Check, Copy } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useCopy } from "@/lib/use-copy";

/**
 * Chrome around a fenced code block: language label + copy button. `children`
 * is the already-highlighted `<code>` element; `text` the raw source for the
 * clipboard.
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

  return (
    <div className="overflow-hidden rounded-lg border bg-muted/50">
      <div className="flex items-center justify-between border-b bg-muted/60 px-3 py-1.5">
        <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
          {language ?? ""}
        </span>
        <button
          type="button"
          onClick={() => void copy(text)}
          className="flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          {copied ? t("chat.copied") : t("chat.copy")}
        </button>
      </div>
      <pre className="overflow-x-auto px-3.5 py-3 font-mono text-[12.5px] leading-relaxed text-foreground/90">
        {children}
      </pre>
    </div>
  );
}
