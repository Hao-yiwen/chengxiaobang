import {
  estimateProviderModelCostUsd,
  nowIso,
  type ProviderKind,
  type TokenUsage,
  type UsageStats,
  type UsageStatsBucket,
  type UsageStatsDataQuality,
  type UsageStatsModelBreakdown,
  type UsageStatsRangeSummary
} from "@chengxiaobang/shared";
import type { StateStore, UsageStatsSourceRun } from "../repository/state-store";

const DAY_MS = 24 * 60 * 60 * 1000;
const USD_TO_CNY_EXCHANGE_RATE = 6.7625;
const UNKNOWN_MODEL = "unknown";

interface UsageStatsOptions {
  timezoneOffsetMinutes: number;
  now?: Date;
}

interface ResolvedRunModel {
  providerId?: string;
  providerKind?: ProviderKind;
  model?: string;
  fallbackUsed: boolean;
}

type SummaryDraft = UsageStatsRangeSummary;

interface BucketDraft {
  key: string;
  label: string;
  startAt: string;
  endAt: string;
  summary: SummaryDraft;
}

interface ModelDraft {
  providerId?: string;
  providerKind?: ProviderKind;
  model: string;
  label: string;
  summary: SummaryDraft;
}

export async function buildUsageStats(
  store: StateStore,
  options: UsageStatsOptions
): Promise<UsageStats> {
  const runs = await store.listUsageStatsRuns();
  console.info("[usage-stats] 开始构建全局用量统计", {
    runCount: runs.length,
    timezoneOffsetMinutes: options.timezoneOffsetMinutes
  });
  const stats = buildUsageStatsFromRuns(runs, options);
  console.info("[usage-stats] 全局用量统计构建完成", {
    runCount: stats.dataQuality.totalRunCount,
    usageRunCount: stats.dataQuality.usageRunCount,
    unknownPriceRunCount: stats.dataQuality.unknownPriceRunCount,
    fallbackModelRunCount: stats.dataQuality.fallbackModelRunCount
  });
  return stats;
}

export function buildUsageStatsFromRuns(
  runs: UsageStatsSourceRun[],
  options: UsageStatsOptions
): UsageStats {
  const timezoneOffsetMinutes = normalizeTimezoneOffset(options.timezoneOffsetMinutes);
  const now = options.now ?? new Date();
  const todayCivil = localCivilDay(now, timezoneOffsetMinutes);
  const todayKey = dayKey(todayCivil);
  const currentWeekStart = weekStart(todayCivil);
  const currentMonthStart = monthStart(todayCivil);
  const dailyBuckets = buildDailyBuckets(todayCivil);
  const weeklyBuckets = buildWeeklyBuckets(currentWeekStart);
  const monthlyBuckets = buildMonthlyBuckets(currentMonthStart);
  const dailyByKey = new Map(dailyBuckets.map((bucket) => [bucket.key, bucket]));
  const weeklyByKey = new Map(weeklyBuckets.map((bucket) => [bucket.key, bucket]));
  const monthlyByKey = new Map(monthlyBuckets.map((bucket) => [bucket.key, bucket]));
  const today = emptySummary();
  const week = emptySummary();
  const total = emptySummary();
  const models = new Map<string, ModelDraft>();

  for (const run of runs) {
    const model = resolveRunModel(run);
    const createdAt = new Date(run.createdAt);
    if (Number.isNaN(createdAt.getTime())) {
      console.warn("[usage-stats] 跳过 createdAt 非法的 run", {
        runId: run.id,
        createdAt: run.createdAt
      });
      continue;
    }

    const runDay = localCivilDay(createdAt, timezoneOffsetMinutes);
    const runDayKey = dayKey(runDay);
    const runWeekStart = weekStart(runDay);
    const runMonthStart = monthStart(runDay);

    applyRun(total, run, model);
    applyRun(modelDraft(models, model), run, model);

    if (runDayKey === todayKey) {
      applyRun(today, run, model);
    }
    if (dayKey(runWeekStart) === dayKey(currentWeekStart)) {
      applyRun(week, run, model);
    }
    const daily = dailyByKey.get(runDayKey);
    if (daily) {
      applyRun(daily.summary, run, model);
    }
    const weekly = weeklyByKey.get(dayKey(runWeekStart));
    if (weekly) {
      applyRun(weekly.summary, run, model);
    }
    const monthly = monthlyByKey.get(monthKey(runMonthStart));
    if (monthly) {
      applyRun(monthly.summary, run, model);
    }
  }

  const finalizedTotal = finalizeSummary(total);
  return {
    generatedAt: nowIso(),
    timezoneOffsetMinutes,
    currency: "CNY",
    today: finalizeSummary(today),
    week: finalizeSummary(week),
    total: finalizedTotal,
    dailyBuckets: dailyBuckets.map(finalizeBucket),
    weeklyBuckets: weeklyBuckets.map(finalizeBucket),
    monthlyBuckets: monthlyBuckets.map(finalizeBucket),
    topModels: [...models.values()]
      .map(finalizeModel)
      .sort((left, right) => right.totalTokens - left.totalTokens || right.costCny - left.costCny)
      .slice(0, 8),
    dataQuality: dataQualityFromSummary(finalizedTotal)
  };
}

function applyRun(
  summary: SummaryDraft,
  run: UsageStatsSourceRun,
  model: ResolvedRunModel
): void {
  summary.runCount += 1;
  if (model.fallbackUsed) {
    summary.fallbackModelRunCount += 1;
  }
  if (!run.usage) {
    summary.missingUsageRunCount += 1;
    return;
  }

  const usage = run.usage;
  const cachedPromptTokens = usage.cachedPromptTokens ?? 0;
  summary.usageRunCount += 1;
  summary.promptTokens += usage.promptTokens;
  summary.completionTokens += usage.completionTokens;
  summary.cachedPromptTokens += cachedPromptTokens;
  summary.totalTokens += usage.totalTokens;

  const costUsd = estimateRunCostUsd(usage, model);
  if (costUsd === undefined) {
    summary.unknownPriceRunCount += 1;
    return;
  }
  summary.pricedRunCount += 1;
  summary.costCny += costUsd * USD_TO_CNY_EXCHANGE_RATE;
}

function estimateRunCostUsd(
  usage: TokenUsage,
  model: ResolvedRunModel
): number | undefined {
  if (!model.providerKind || !model.model || model.model === UNKNOWN_MODEL) {
    return undefined;
  }
  const cachedPromptTokens = usage.cachedPromptTokens ?? 0;
  return estimateProviderModelCostUsd(model.providerKind, model.model, {
    inputTokens: Math.max(0, usage.promptTokens - cachedPromptTokens),
    outputTokens: usage.completionTokens,
    cacheReadTokens: cachedPromptTokens
  });
}

function resolveRunModel(run: UsageStatsSourceRun): ResolvedRunModel {
  const hasRunModel = Boolean(run.providerKind && run.model);
  const providerKind = run.providerKind ?? run.fallbackProviderKind;
  const model = run.model ?? run.fallbackModel;
  return {
    ...(run.providerId ?? run.fallbackProviderId
      ? { providerId: run.providerId ?? run.fallbackProviderId }
      : {}),
    ...(providerKind ? { providerKind } : {}),
    ...(model ? { model } : {}),
    fallbackUsed: !hasRunModel && Boolean(providerKind && model)
  };
}

function modelDraft(
  drafts: Map<string, ModelDraft>,
  model: ResolvedRunModel
): SummaryDraft {
  const modelId = model.model ?? UNKNOWN_MODEL;
  const key = `${model.providerKind ?? "unknown"}:${model.providerId ?? "unknown"}:${modelId}`;
  const existing = drafts.get(key);
  if (existing) {
    return existing.summary;
  }
  const draft: ModelDraft = {
    ...(model.providerId ? { providerId: model.providerId } : {}),
    ...(model.providerKind ? { providerKind: model.providerKind } : {}),
    model: modelId,
    label:
      modelId === UNKNOWN_MODEL
        ? "unknown"
        : model.providerId
          ? `${model.providerId} · ${modelId}`
          : modelId,
    summary: emptySummary()
  };
  drafts.set(key, draft);
  return draft.summary;
}

function emptySummary(): SummaryDraft {
  return {
    costCny: 0,
    promptTokens: 0,
    completionTokens: 0,
    cachedPromptTokens: 0,
    totalTokens: 0,
    runCount: 0,
    usageRunCount: 0,
    missingUsageRunCount: 0,
    pricedRunCount: 0,
    unknownPriceRunCount: 0,
    fallbackModelRunCount: 0
  };
}

function finalizeSummary(summary: SummaryDraft): UsageStatsRangeSummary {
  return {
    ...summary,
    costCny: roundCurrency(summary.costCny)
  };
}

function finalizeBucket(bucket: BucketDraft): UsageStatsBucket {
  return {
    key: bucket.key,
    label: bucket.label,
    startAt: bucket.startAt,
    endAt: bucket.endAt,
    ...finalizeSummary(bucket.summary)
  };
}

function finalizeModel(model: ModelDraft): UsageStatsModelBreakdown {
  return {
    ...(model.providerId ? { providerId: model.providerId } : {}),
    ...(model.providerKind ? { providerKind: model.providerKind } : {}),
    model: model.model,
    label: model.label,
    ...finalizeSummary(model.summary)
  };
}

function dataQualityFromSummary(summary: UsageStatsRangeSummary): UsageStatsDataQuality {
  return {
    totalRunCount: summary.runCount,
    usageRunCount: summary.usageRunCount,
    missingUsageRunCount: summary.missingUsageRunCount,
    pricedRunCount: summary.pricedRunCount,
    unknownPriceRunCount: summary.unknownPriceRunCount,
    fallbackModelRunCount: summary.fallbackModelRunCount
  };
}

function buildDailyBuckets(todayCivil: Date): BucketDraft[] {
  const start = addDays(todayCivil, -370);
  return Array.from({ length: 371 }, (_, index) => {
    const day = addDays(start, index);
    const next = addDays(day, 1);
    return {
      key: dayKey(day),
      label: formatMonthDay(day),
      startAt: civilIso(day),
      endAt: civilIso(next),
      summary: emptySummary()
    };
  });
}

function buildWeeklyBuckets(currentWeekStart: Date): BucketDraft[] {
  const start = addDays(currentWeekStart, -51 * 7);
  return Array.from({ length: 52 }, (_, index) => {
    const week = addDays(start, index * 7);
    const next = addDays(week, 7);
    return {
      key: dayKey(week),
      label: formatMonthDay(week),
      startAt: civilIso(week),
      endAt: civilIso(next),
      summary: emptySummary()
    };
  });
}

function buildMonthlyBuckets(currentMonthStart: Date): BucketDraft[] {
  const start = addMonths(currentMonthStart, -11);
  return Array.from({ length: 12 }, (_, index) => {
    const month = addMonths(start, index);
    const next = addMonths(month, 1);
    return {
      key: monthKey(month),
      label: monthKey(month),
      startAt: civilIso(month),
      endAt: civilIso(next),
      summary: emptySummary()
    };
  });
}

function localCivilDay(date: Date, timezoneOffsetMinutes: number): Date {
  const shifted = new Date(date.getTime() - timezoneOffsetMinutes * 60_000);
  return new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate())
  );
}

function weekStart(civilDay: Date): Date {
  const weekday = civilDay.getUTCDay();
  return addDays(civilDay, -(weekday === 0 ? 6 : weekday - 1));
}

function monthStart(civilDay: Date): Date {
  return new Date(Date.UTC(civilDay.getUTCFullYear(), civilDay.getUTCMonth(), 1));
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

function addMonths(date: Date, months: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function monthKey(date: Date): string {
  return date.toISOString().slice(0, 7);
}

function civilIso(date: Date): string {
  return `${dayKey(date)}T00:00:00.000Z`;
}

function formatMonthDay(date: Date): string {
  return `${date.getUTCMonth() + 1}/${date.getUTCDate()}`;
}

function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function normalizeTimezoneOffset(value: number): number {
  if (!Number.isFinite(value)) {
    console.warn("[usage-stats] 收到非法时区偏移，已回退到 UTC", { value });
    return 0;
  }
  return Math.trunc(Math.max(-840, Math.min(840, value)));
}
