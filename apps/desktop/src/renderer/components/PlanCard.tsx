import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Markdown } from "@/components/Markdown";
import { cn } from "@/lib/utils";

export type PlanCardStatus = "draft" | "awaiting" | "approved" | "rejected";

export interface PlanCardProps {
  markdown: string;
  status: PlanCardStatus;
  className?: string;
}

const COLLAPSED_HEIGHT = 520;
const EXPAND_LINE_THRESHOLD = 18;

export function PlanCard({ markdown, status, className }: PlanCardProps) {
  const { t } = useTranslation();
  const contentRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [measuredOverflow, setMeasuredOverflow] = useState(false);
  const lineBasedOverflow = useMemo(
    () => markdown.split("\n").filter((line) => line.trim().length > 0).length > EXPAND_LINE_THRESHOLD,
    [markdown]
  );

  useEffect(() => {
    const node = contentRef.current;
    if (!node) {
      return;
    }
    const measure = () => {
      const overflow = node.scrollHeight > COLLAPSED_HEIGHT + 8;
      setMeasuredOverflow(overflow);
      if (overflow) {
        console.debug("[PlanCard] 检测到计划内容可折叠", {
          scrollHeight: node.scrollHeight,
          collapsedHeight: COLLAPSED_HEIGHT
        });
      }
    };
    measure();
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [markdown]);

  const canExpand = lineBasedOverflow || measuredOverflow;
  const collapsed = canExpand && !expanded;
  const statusLabel: Record<PlanCardStatus, string> = {
    draft: t("plan.statusDraft"),
    awaiting: t("plan.statusAwaiting"),
    approved: t("plan.statusApproved"),
    rejected: t("plan.statusRejected")
  };

  return (
    <section
      data-testid="plan-card"
      data-status={status}
      aria-label={`${t("plan.heading")}：${statusLabel[status]}`}
      className={cn(
        "mb-5 w-full animate-msg-in self-stretch overflow-hidden rounded-lg bg-plan-surface px-4 py-3.5 text-body-sm text-foreground shadow-hairline",
        className
      )}
    >
      <header className="mb-4 flex items-center justify-between gap-3">
        <span className="text-body-sm-strong text-foreground">{t("plan.heading")}</span>
        <span className="rounded-pill bg-card px-2.5 py-1 text-caption text-muted-foreground shadow-hairline">
          {statusLabel[status]}
        </span>
      </header>
      <div className="relative">
        <div
          ref={contentRef}
          className={cn(
            "overflow-hidden transition-[max-height] duration-200 ease-out",
            collapsed ? "max-h-[520px]" : "max-h-none"
          )}
        >
          <Markdown text={markdown} className="proposed-plan-markdown" />
        </div>
        {collapsed ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-b from-plan-surface/0 to-plan-surface" />
        ) : null}
      </div>
      {canExpand ? (
        <div className={cn("relative flex justify-center", collapsed ? "-mt-8" : "mt-3")}>
          <button
            type="button"
            className="rounded-pill bg-primary px-2.5 py-1 text-caption font-medium text-primary-foreground shadow-hairline transition-[filter,transform] hover:brightness-105 active:scale-[0.98]"
            onClick={() => {
              console.info("[PlanCard] 切换计划展开状态", {
                expanded: !expanded,
                chars: markdown.length
              });
              setExpanded((value) => !value);
            }}
          >
            {expanded ? t("plan.collapse") : t("plan.expand")}
          </button>
        </div>
      ) : null}
    </section>
  );
}
