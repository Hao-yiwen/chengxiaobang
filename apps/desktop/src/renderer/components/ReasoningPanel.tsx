import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ReasoningBrainThinkingIcon } from "@/assets/file-type-icons";
import { cn } from "@/lib/utils";
import { thinkingSeconds } from "@/lib/reasoning";
import shimmerStyles from "@/components/ShimmerText.module.css";

/**
 * 助手回答前的「深度思考」折叠块：流式阶段计时但默认收起，点击后可查看详情。
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
  const [open, setOpen] = useState(false);
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
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-1.5 text-caption text-muted-foreground transition-colors hover:text-foreground"
      >
        <ReasoningBrainThinkingIcon className="size-3.5 flex-none" />
        <span className={cn(streaming && "shimmer-text", streaming && shimmerStyles.text)}>
          {header}
        </span>
      </button>
      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-300 ease-out",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="ml-1.5 mt-1.5 whitespace-pre-wrap break-words border-l border-hairline pl-3 text-caption text-muted-foreground/90">
            {text}
          </div>
        </div>
      </div>
    </div>
  );
}
