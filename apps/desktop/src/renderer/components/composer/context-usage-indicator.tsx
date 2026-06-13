import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SessionContextUsage } from "@chengxiaobang/shared";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export function ContextUsageIndicator(props: {
  usage?: SessionContextUsage;
  loading: boolean;
  error?: string;
  modelLabel: string;
}) {
  const { t } = useTranslation();
  const percent = props.usage?.usedRatio;
  const status = props.usage?.status ?? "unknown";
  const ringColor = contextRingColor(status);
  const degrees = Math.min(360, Math.max(0, (percent ?? 0) * 360));
  const sessionCostValue = t("composer.context.estimatedCostValue", {
    value: formatCny(props.usage?.sessionCostCny)
  });
  const [open, setOpen] = useState(false);
  const lockedOpenRef = useRef(false);
  const closeTimerRef = useRef<number | undefined>(undefined);

  const clearCloseTimer = () => {
    if (closeTimerRef.current !== undefined) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = undefined;
    }
  };
  const openTransient = () => {
    clearCloseTimer();
    setOpen(true);
  };
  const scheduleTransientClose = () => {
    clearCloseTimer();
    if (lockedOpenRef.current) {
      return;
    }
    closeTimerRef.current = window.setTimeout(() => {
      setOpen(false);
      closeTimerRef.current = undefined;
    }, 120);
  };

  useEffect(() => () => clearCloseTimer(), []);

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) {
          lockedOpenRef.current = false;
        }
      }}
    >
      <PopoverAnchor asChild>
        <button
          type="button"
          aria-label={t("composer.context.ariaLabel")}
          aria-busy={props.loading}
          aria-expanded={open}
          aria-haspopup="dialog"
          onPointerEnter={openTransient}
          onPointerLeave={scheduleTransientClose}
          onFocus={openTransient}
          onBlur={scheduleTransientClose}
          onClick={() => {
            clearCloseTimer();
            lockedOpenRef.current = !lockedOpenRef.current;
            setOpen(lockedOpenRef.current);
          }}
          className={cn(
            "flex h-8 w-6 flex-none items-center justify-center rounded-sm text-muted-foreground outline-none transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            (status === "over_threshold" || status === "near_threshold") && "text-warning-deep"
          )}
        >
          {props.loading && !props.usage ? (
            <span className="size-5 rounded-full border border-muted-foreground/25 border-t-foreground animate-spin" />
          ) : (
            <span
              aria-hidden
              className="relative size-5 rounded-full"
              style={{
                background: `conic-gradient(${ringColor} ${degrees}deg, rgb(var(--border)) 0deg)`
              }}
            >
              <span className="absolute inset-[4px] rounded-full bg-card" />
            </span>
          )}
        </button>
      </PopoverAnchor>
      <PopoverContent
        side="top"
        align="end"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onPointerEnter={openTransient}
        onPointerLeave={scheduleTransientClose}
        className="w-[300px] px-3 py-2.5 text-left text-micro"
      >
        <div className="space-y-2">
          <div>
            <div className="font-medium">{t("composer.context.title")}</div>
            <div className="mt-0.5 truncate text-muted-foreground">{props.modelLabel}</div>
          </div>
          {props.error ? (
            <div className="rounded-xs bg-warning-soft px-2 py-1 text-warning-deep">
              {t("composer.context.error", { error: props.error })}
            </div>
          ) : null}
          {props.usage ? (
            <div className="space-y-1">
              <ContextUsageRow
                label={t("composer.context.usedRatio")}
                value={formatPercent(props.usage.usedRatio)}
              />
              <ContextUsageRow
                label={t("composer.context.used")}
                value={`${formatTokenCount(props.usage.estimatedTokens)} / ${formatTokenCount(
                  props.usage.contextWindowTokens
                )}`}
              />
              <ContextUsageRow
                label={t("composer.context.threshold")}
                value={`${formatTokenCount(props.usage.autoCompactThresholdTokens)} (${formatPercent(
                  props.usage.autoCompactThresholdRatio
                )})`}
              />
              <ContextUsageRow
                label={t("composer.context.sessionCost")}
                value={sessionCostValue}
              />
              <ContextUsageRow
                label={t("composer.context.remaining")}
                value={formatTokenCount(props.usage.remainingTokens)}
              />
              <ContextUsageRow
                label={t("composer.context.breakdown")}
                value={t("composer.context.breakdownValue", {
                  system: formatTokenCount(props.usage.systemPromptTokens),
                  messages: formatTokenCount(props.usage.messageTokens),
                  tools: formatTokenCount(props.usage.toolTokens)
                })}
              />
              <ContextUsageRow
                label={t("composer.context.statusLabel")}
                value={t(`composer.context.status.${props.usage.status}`)}
              />
            </div>
          ) : (
            <div className="text-muted-foreground">
              {props.loading
                ? t("composer.context.loading")
                : t("composer.context.unavailable")}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ContextUsageRow(props: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-muted-foreground">{props.label}</span>
      <span className="text-right font-mono text-foreground">{props.value}</span>
    </div>
  );
}

function contextRingColor(status: SessionContextUsage["status"]): string {
  if (status === "over_threshold" || status === "near_threshold") {
    return "rgb(var(--warning))";
  }
  if (status === "unknown") {
    return "rgb(var(--muted-foreground))";
  }
  return "rgb(var(--link))";
}

function formatPercent(value: number | undefined): string {
  if (value === undefined || Number.isNaN(value)) {
    return "—";
  }
  return `${Math.round(value * 100)}%`;
}

function formatTokenCount(tokens: number | undefined): string {
  if (tokens === undefined) {
    return "—";
  }
  if (tokens >= 1_000_000) {
    return `${trimFixed(tokens / 1_000_000)}M`;
  }
  if (tokens >= 1000) {
    return `${trimFixed(tokens / 1000)}K`;
  }
  return String(tokens);
}

function formatCny(value: number | undefined): string {
  if (value === undefined) {
    return "—";
  }
  return `¥${value.toFixed(2)}`;
}

function trimFixed(value: number): string {
  return value >= 10 ? value.toFixed(0) : value.toFixed(1).replace(/\.0$/, "");
}
