import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  UsageStats,
  UsageStatsBucket,
  UsageStatsModelBreakdown,
  UsageStatsRangeSummary
} from "@chengxiaobang/shared";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { SectionShell, SettingBlock } from "@/components/settings/SectionShell";
import { cn } from "@/lib/utils";
import { getApiClient } from "@/store";

type HeatmapMode = "daily" | "weekly" | "cumulative";
type SimpleTranslate = (key: string, options?: Record<string, unknown>) => string;

const HEATMAP_MODE_KEYS: HeatmapMode[] = ["daily", "weekly", "cumulative"];
const DAY_MS = 24 * 60 * 60 * 1000;

export function UsageStatsSection() {
  const { t, i18n } = useTranslation();
  const translate = t as unknown as SimpleTranslate;
  const [stats, setStats] = useState<UsageStats>();
  const [mode, setMode] = useState<HeatmapMode>("daily");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();

  async function load(): Promise<void> {
    const client = getApiClient();
    if (!client?.getUsageStats) {
      setLoading(false);
      setError(t("settings.usage.unavailable"));
      console.warn("[settings] 用量统计加载失败：API client 不支持 getUsageStats");
      return;
    }
    const timezoneOffsetMinutes = new Date().getTimezoneOffset();
    setLoading(true);
    setError(undefined);
    console.info("[settings] 开始加载用量统计", { timezoneOffsetMinutes });
    try {
      const next = await client.getUsageStats({ timezoneOffsetMinutes });
      setStats(next);
      console.info("[settings] 用量统计加载完成", {
        todayTokens: next.today.totalTokens,
        todayCostCny: next.today.costCny,
        totalRunCount: next.dataQuality.totalRunCount
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      console.error("[settings] 用量统计加载失败", { error: message });
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const selectedBuckets = stats ? bucketsForMode(stats, mode) : [];
  const trend = useMemo(() => (stats ? todayTrend(stats.dailyBuckets) : undefined), [stats]);

  return (
    <SectionShell title={t("settings.usage.title")}>
      <SettingBlock
        title={t("settings.usage.overviewTitle")}
        description={t("settings.usage.overviewDesc")}
      >
        {loading ? <UsageLoading /> : null}
        {!loading && error ? (
          <div className="rounded-sm border border-destructive/30 bg-destructive/5 px-4 py-3">
            <p className="text-caption text-destructive">{error}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => void load()}
            >
              {t("settings.usage.retry")}
            </Button>
          </div>
        ) : null}
        {!loading && !error && stats ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <MetricCard
              label={t("settings.usage.todayEstimatedCost")}
              value={formatCny(stats.today.costCny)}
              hint={t("settings.usage.estimatedHint")}
            />
            <MetricCard
              label={t("settings.usage.todayTokens")}
              value={formatTokens(stats.today.totalTokens)}
              hint={t("settings.usage.tokenBreakdown", {
                input: formatTokens(stats.today.promptTokens),
                output: formatTokens(stats.today.completionTokens)
              })}
            />
            <MetricCard
              label={t("settings.usage.todayRuns")}
              value={stats.today.runCount.toLocaleString()}
              hint={t("settings.usage.usageRuns", {
                count: stats.today.usageRunCount.toLocaleString()
              })}
            />
            <MetricCard
              label={t("settings.usage.vsSevenDay")}
              value={trend ? formatTrend(trend.percent) : t("settings.usage.noBaseline")}
              hint={
                trend
                  ? t("settings.usage.sevenDayAverage", {
                      value: formatTokens(Math.round(trend.averageTokens))
                    })
                  : t("settings.usage.noBaselineHint")
              }
              tone={trend && trend.percent > 0 ? "active" : "default"}
            />
          </div>
        ) : null}
      </SettingBlock>

      {!loading && !error && stats ? (
        <>
          <SettingBlock
            title={t("settings.usage.heatmapTitle")}
            description={t("settings.usage.heatmapDesc")}
          >
            <div data-testid="settings-usage-heatmap" className="min-w-0 rounded-sm border bg-background p-5">
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-body-lg font-medium">{t("settings.usage.tokenActivity")}</h3>
                  <p className="text-caption text-muted-foreground">
                    {summaryLine(translate, stats, mode)}
                  </p>
                </div>
                <ToggleGroup
                  type="single"
                  value={mode}
                  onValueChange={(value) => {
                    if (!value) return;
                    console.debug("[settings] 切换用量统计视图模式", { mode: value });
                    setMode(value as HeatmapMode);
                  }}
                  aria-label={t("settings.usage.modeLabel")}
                >
                  {HEATMAP_MODE_KEYS.map((item) => (
                    <ToggleGroupItem key={item} value={item}>
                      {t(`settings.usage.modes.${item}`)}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>
              <UsageActivityChart buckets={selectedBuckets} mode={mode} locale={i18n.language} />
            </div>
          </SettingBlock>

          <SettingBlock
            title={t("settings.usage.detailsTitle")}
            description={t("settings.usage.detailsDesc")}
          >
            <div className="grid gap-3 sm:grid-cols-3">
              <MetricCard
                label={t("settings.usage.weekEstimatedCost")}
                value={formatCny(stats.week.costCny)}
                hint={t("settings.usage.weekTokens", {
                  value: formatTokens(stats.week.totalTokens)
                })}
              />
              <MetricCard
                label={t("settings.usage.totalEstimatedCost")}
                value={formatCny(stats.total.costCny)}
                hint={t("settings.usage.totalTokens", {
                  value: formatTokens(stats.total.totalTokens)
                })}
              />
              <MetricCard
                label={t("settings.usage.cacheTokens")}
                value={formatTokens(stats.total.cachedPromptTokens)}
                hint={t("settings.usage.cacheHint")}
              />
            </div>
            <ModelRanking models={stats.topModels} />
            <DataQuality stats={stats} />
          </SettingBlock>
        </>
      ) : null}
    </SectionShell>
  );
}

function UsageLoading() {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {Array.from({ length: 4 }, (_, index) => (
        <div key={index} className="h-24 animate-pulse rounded-sm border bg-canvas" />
      ))}
    </div>
  );
}

function MetricCard(props: {
  label: string;
  value: string;
  hint: string;
  tone?: "default" | "active";
}) {
  return (
    <div className="rounded-sm border bg-background p-4">
      <div className="text-caption text-muted-foreground">{props.label}</div>
      <div
        className={cn(
          "mt-2 font-display text-display-sm",
          props.tone === "active" ? "text-link" : "text-foreground"
        )}
      >
        {props.value}
      </div>
      <p className="mt-1 text-micro text-muted-foreground">{props.hint}</p>
    </div>
  );
}

function UsageActivityChart(props: {
  buckets: UsageStatsBucket[];
  mode: HeatmapMode;
  locale: string;
}) {
  if (props.mode !== "daily") {
    return <UsageBarChart buckets={props.buckets} mode={props.mode} locale={props.locale} />;
  }
  return <DailyHeatmap buckets={props.buckets} locale={props.locale} />;
}

function DailyHeatmap(props: { buckets: UsageStatsBucket[]; locale: string }) {
  const [hovered, setHovered] = useState<UsageStatsBucket>();
  const maxTokens = Math.max(0, ...props.buckets.map((bucket) => bucket.totalTokens));
  const labels = heatmapLabels(props.buckets, props.locale);
  return (
    <div className="relative">
      {hovered ? <BucketTooltip bucket={hovered} mode="daily" locale={props.locale} /> : null}
      <div className="overflow-x-auto pb-1">
        <div
          className="grid w-max grid-flow-col gap-1"
          style={{
            gridTemplateRows: "repeat(7, 12px)",
            gridAutoColumns: "12px"
          }}
        >
          {props.buckets.map((bucket) => (
            <button
              key={bucket.key}
              type="button"
              data-testid="settings-usage-heatmap-cell"
              aria-label={bucketAriaLabel(bucket, "daily", props.locale)}
              onBlur={() => setHovered(undefined)}
              onFocus={() => setHovered(bucket)}
              onMouseEnter={() => setHovered(bucket)}
              onMouseLeave={() => setHovered(undefined)}
              className={cn(
                "size-3 rounded-[3px] border border-border/30 outline-none transition-transform focus-visible:ring-2 focus-visible:ring-ring",
                heatmapColor(bucket.totalTokens, maxTokens)
              )}
            />
          ))}
        </div>
      </div>
      <div className="mt-3 flex min-w-0 justify-between gap-3 text-caption text-muted-foreground">
        {labels.map((label) => (
          <span key={label.key} className="truncate">
            {label.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function UsageBarChart(props: {
  buckets: UsageStatsBucket[];
  mode: Exclude<HeatmapMode, "daily">;
  locale: string;
}) {
  const [hovered, setHovered] = useState<UsageStatsBucket>();
  const maxTokens = Math.max(0, ...props.buckets.map((bucket) => bucket.totalTokens));
  const labels = barChartLabels(props.buckets, props.mode, props.locale);
  return (
    <div className="relative">
      {hovered ? <BucketTooltip bucket={hovered} mode={props.mode} locale={props.locale} /> : null}
      <div className="min-w-0 overflow-x-auto overflow-y-hidden pb-1">
        <div className="w-max min-w-full">
          <div className="flex h-48 items-end gap-2 border-b border-border px-1 pt-8">
            {props.buckets.map((bucket) => {
              const ratio = maxTokens > 0 ? bucket.totalTokens / maxTokens : 0;
              const height = bucket.totalTokens > 0 ? Math.max(8, ratio * 150) : 2;
              return (
                <button
                  key={bucket.key}
                  type="button"
                  data-testid="settings-usage-chart-bar"
                  aria-label={bucketAriaLabel(bucket, props.mode, props.locale)}
                  onBlur={() => setHovered(undefined)}
                  onFocus={() => setHovered(bucket)}
                  onMouseEnter={() => setHovered(bucket)}
                  onMouseLeave={() => setHovered(undefined)}
                  className={cn(
                    "flex h-full flex-none items-end justify-center rounded-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                    props.mode === "weekly" ? "w-4" : "w-10 px-1"
                  )}
                >
                  <span
                    className={cn(
                      "block rounded-t-xs transition-all",
                      props.mode === "weekly" ? "w-1.5" : "w-full",
                      bucket.totalTokens > 0 ? "bg-link" : "bg-canvas-soft-2"
                    )}
                    style={{ height: `${height}px` }}
                  />
                </button>
              );
            })}
          </div>
          <div className="mt-3 flex min-w-full justify-between gap-3 text-caption text-muted-foreground">
            {labels.map((label) => (
              <span key={label.key} className="truncate">
                {label.label}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function BucketTooltip(props: {
  bucket: UsageStatsBucket;
  mode: HeatmapMode;
  locale: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="pointer-events-none absolute right-0 top-0 z-10 min-w-52 rounded-sm border bg-popover px-3 py-2 text-popover-foreground shadow-overlay">
      <div className="text-caption font-medium">
        {bucketDetailLabel(props.bucket, props.mode, props.locale)}
      </div>
      <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 text-micro text-muted-foreground">
        <span>{t("settings.usage.tooltipTokens")}</span>
        <span className="text-right text-foreground">{formatTokens(props.bucket.totalTokens)}</span>
        <span>{t("settings.usage.tooltipCost")}</span>
        <span className="text-right text-foreground">{formatCny(props.bucket.costCny)}</span>
        <span>{t("settings.usage.tooltipRuns")}</span>
        <span className="text-right text-foreground">{props.bucket.runCount.toLocaleString()}</span>
      </div>
    </div>
  );
}

function ModelRanking({ models }: { models: UsageStatsModelBreakdown[] }) {
  const { t } = useTranslation();
  const maxTokens = Math.max(0, ...models.map((model) => model.totalTokens));
  return (
    <div className="mt-4 rounded-sm border bg-background">
      <div className="border-b px-4 py-3">
        <h3 className="text-caption font-medium">{t("settings.usage.modelRanking")}</h3>
      </div>
      {models.length === 0 ? (
        <p className="px-4 py-5 text-caption text-muted-foreground">
          {t("settings.usage.emptyModels")}
        </p>
      ) : (
        <div className="divide-y">
          {models.map((model) => {
            const ratio = maxTokens > 0 ? Math.max(3, (model.totalTokens / maxTokens) * 100) : 0;
            return (
              <div key={`${model.providerKind ?? "unknown"}:${model.providerId ?? "unknown"}:${model.model}`} className="px-4 py-3">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-caption font-medium">
                      {model.model === "unknown" ? t("settings.usage.unknownModel") : model.label}
                    </div>
                    <div className="text-micro text-muted-foreground">
                      {t("settings.usage.modelRuns", {
                        count: model.runCount.toLocaleString()
                      })}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-caption font-medium">{formatTokens(model.totalTokens)}</div>
                    <div className="text-micro text-muted-foreground">{formatCny(model.costCny)}</div>
                  </div>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-canvas-soft-2">
                  <div className="h-full rounded-full bg-link" style={{ width: `${ratio}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function DataQuality({ stats }: { stats: UsageStats }) {
  const { t } = useTranslation();
  const items = [
    {
      label: t("settings.usage.missingUsage"),
      value: stats.dataQuality.missingUsageRunCount
    },
    {
      label: t("settings.usage.unknownPrice"),
      value: stats.dataQuality.unknownPriceRunCount
    },
    {
      label: t("settings.usage.fallbackModel"),
      value: stats.dataQuality.fallbackModelRunCount
    }
  ];
  return (
    <div className="mt-4 rounded-sm border bg-canvas-soft px-4 py-3">
      <div className="mb-2 text-caption font-medium">{t("settings.usage.dataQuality")}</div>
      <div className="grid gap-2 sm:grid-cols-3">
        {items.map((item) => (
          <div key={item.label} className="rounded-xs border bg-background px-3 py-2">
            <div className="text-micro text-muted-foreground">{item.label}</div>
            <div className="mt-1 text-caption font-medium">{item.value.toLocaleString()}</div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-micro text-muted-foreground">{t("settings.usage.qualityHint")}</p>
    </div>
  );
}

function bucketsForMode(stats: UsageStats, mode: HeatmapMode): UsageStatsBucket[] {
  if (mode === "weekly") {
    return stats.weeklyBuckets;
  }
  if (mode === "cumulative") {
    return stats.monthlyBuckets;
  }
  return stats.dailyBuckets;
}

function summaryLine(
  t: SimpleTranslate,
  stats: UsageStats,
  mode: HeatmapMode
): string {
  const summary =
    mode === "weekly" ? stats.week : mode === "cumulative" ? stats.total : stats.today;
  return t("settings.usage.summaryLine", {
    tokens: formatTokens(summary.totalTokens),
    cost: formatCny(summary.costCny),
    runs: summary.runCount.toLocaleString()
  });
}

function todayTrend(buckets: UsageStatsBucket[]): { averageTokens: number; percent: number } | undefined {
  const previous = buckets.slice(-8, -1).filter((bucket) => bucket.runCount > 0);
  if (previous.length === 0) {
    return undefined;
  }
  const averageTokens =
    previous.reduce((sum, bucket) => sum + bucket.totalTokens, 0) / previous.length;
  if (averageTokens <= 0) {
    return undefined;
  }
  const today = buckets.at(-1)?.totalTokens ?? 0;
  return {
    averageTokens,
    percent: ((today - averageTokens) / averageTokens) * 100
  };
}

function heatmapLabels(
  buckets: UsageStatsBucket[],
  locale: string
): { key: string; label: string }[] {
  const labels = buckets
    .filter((bucket) => bucket.key.endsWith("-01") || bucket.key.endsWith("-02"))
    .map((bucket) => ({ key: bucket.key, label: formatMonth(bucket.key, locale) }));
  if (labels.length >= 4) {
    return labels.slice(-12);
  }
  return buckets
    .filter((_, index) => index % Math.max(1, Math.floor(buckets.length / 6)) === 0)
    .map((bucket) => ({ key: bucket.key, label: bucket.label }));
}

function barChartLabels(
  buckets: UsageStatsBucket[],
  mode: Exclude<HeatmapMode, "daily">,
  locale: string
): { key: string; label: string }[] {
  if (mode === "cumulative") {
    return buckets.map((bucket) => ({ key: bucket.key, label: formatMonth(bucket.key, locale) }));
  }
  return buckets
    .filter((_, index) => index % 8 === 0 || index === buckets.length - 1)
    .map((bucket) => ({ key: bucket.key, label: formatMonth(bucket.key, locale) }));
}

function bucketAriaLabel(bucket: UsageStatsBucket, mode: HeatmapMode, locale: string): string {
  return `${bucketDetailLabel(bucket, mode, locale)} · ${formatTokens(bucket.totalTokens)} Token · ${formatCny(bucket.costCny)} · ${bucket.runCount.toLocaleString()} runs`;
}

function bucketDetailLabel(bucket: UsageStatsBucket, mode: HeatmapMode, locale: string): string {
  if (mode === "cumulative") {
    return formatMonthYear(bucket.key, locale);
  }
  const start = parseBucketDate(bucket.startAt, bucket.key);
  if (!start) {
    return bucket.label;
  }
  if (mode === "daily") {
    return formatFullDate(start, locale);
  }
  const end = parseBucketDate(bucket.endAt, bucket.key);
  if (!end || end.getTime() <= start.getTime()) {
    return formatFullDate(start, locale);
  }
  return `${formatShortDate(start, locale)} - ${formatShortDate(
    new Date(end.getTime() - DAY_MS),
    locale
  )}`;
}

function heatmapColor(tokens: number, maxTokens: number): string {
  if (tokens <= 0 || maxTokens <= 0) {
    return "bg-canvas-soft-2";
  }
  const ratio = tokens / maxTokens;
  if (ratio < 0.25) return "bg-link-bg-soft";
  if (ratio < 0.5) return "bg-link/30";
  if (ratio < 0.75) return "bg-link/60";
  return "bg-link";
}

function formatCny(value: number): string {
  return `¥${value.toFixed(2)}`;
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 1 : 2)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k`;
  }
  return value.toLocaleString();
}

function formatTrend(percent: number): string {
  const sign = percent > 0 ? "+" : "";
  return `${sign}${percent.toFixed(0)}%`;
}

function parseBucketDate(value: string, fallbackKey: string): Date | undefined {
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed;
  }
  const key = fallbackKey.length === 7 ? `${fallbackKey}-01` : fallbackKey;
  const fallback = new Date(`${key}T00:00:00.000Z`);
  return Number.isNaN(fallback.getTime()) ? undefined : fallback;
}

function formatFullDate(date: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC"
  }).format(date);
}

function formatShortDate(date: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    timeZone: "UTC"
  }).format(date);
}

function formatMonth(key: string, locale: string): string {
  const monthKey = key.length === 7 ? key : key.slice(0, 7);
  const date = new Date(`${monthKey}-01T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    return key;
  }
  return new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" }).format(date);
}

function formatMonthYear(key: string, locale: string): string {
  const monthKey = key.length === 7 ? key : key.slice(0, 7);
  const date = new Date(`${monthKey}-01T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    return key;
  }
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    timeZone: "UTC"
  }).format(date);
}
