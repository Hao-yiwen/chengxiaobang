import { ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { thinkingSeconds } from "@/lib/reasoning";

/**
 * Collapsible reasoning ("深度思考") block shown above an assistant answer.
 * While streaming it stays expanded with a live timer and a shimmering header;
 * once the turn completes it settles to a collapsed "已深度思考 · 用时 N 秒"
 * summary the user can re-open. Modeled on the DeepSeek reasoning UX.
 */
export function ReasoningPanel({
  text,
  streaming = false,
  durationMs,
  startedAt
}: {
  text: string;
  streaming?: boolean;
  durationMs?: number;
  startedAt?: number;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(streaming);
  const [elapsed, setElapsed] = useState(() =>
    startedAt !== undefined ? Math.max(0, Date.now() - startedAt) : 0
  );

  useEffect(() => {
    if (!streaming || startedAt === undefined) {
      return;
    }
    setElapsed(Math.max(0, Date.now() - startedAt));
    const id = window.setInterval(() => {
      setElapsed(Math.max(0, Date.now() - startedAt));
    }, 250);
    return () => window.clearInterval(id);
  }, [streaming, startedAt]);

  const seconds = streaming ? thinkingSeconds(elapsed, true) : thinkingSeconds(durationMs ?? 0);
  const header = streaming
    ? seconds > 0
      ? `${t("chat.reasoningInProgress")} · ${seconds}s`
      : t("chat.reasoningInProgress")
    : t("chat.reasoningDone", { seconds });

  return (
    <div className="mb-4 self-stretch">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-1.5 text-[12.5px] font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronDown
          className={cn("size-3.5 transition-transform duration-200", open ? "" : "-rotate-90")}
        />
        <span className={cn(streaming && "shimmer-text")}>{header}</span>
      </button>
      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-300 ease-out",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        )}
      >
        <div className="overflow-hidden">
          <div className="ml-1.5 mt-1.5 whitespace-pre-wrap break-words border-l-2 border-border pl-3 text-[13px] leading-relaxed text-muted-foreground/90">
            {text}
          </div>
        </div>
      </div>
    </div>
  );
}
