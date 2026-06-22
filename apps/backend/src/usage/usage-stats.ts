import {
  nowIso,
  type UsageStats,
  type UsageStatsBucket,
  type UsageStatsDataQuality,
  type UsageStatsModelBreakdown,
  type UsageStatsRangeSummary
} from "@chengxiaobang/shared";
import type { UsageCostEntry } from "../repository/state-store";

import { getLogger } from "../logging/logger";

const log = getLogger({ module: "usage/usage-stats" });

const DAY_MS = 24 * 60 * 60 * 1000;
const UNKNOWN_MODEL = "unknown";

interface UsageStatsOptions {
  timezoneOffsetMinutes: number;
  now?: Date;
}

type SummaryDraft = UsageStatsRangeSummary & {
  runIds: Set<string>;
  usageRunIds: Set<string>;
  missingUsageRunIds: Set<string>;
  pricedRunIds: Set<string>;
  unknownPriceRunIds: Set<string>;
  fallbackModelRunIds: Set<string>;
};

interface BucketDraft {
  key: string;
  label: string;
  startAt: string;
  endAt: string;
  summary: SummaryDraft;
}

interface ModelDraft {
  providerId?: string;
  providerKind?: UsageCostEntry["providerKind"];
  model: string;
  label: string;
  summary: SummaryDraft;
}

export function buildUsageStatsFromCostEntries(
  entries: UsageCostEntry[],
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

  for (const entry of entries) {
    if (entry.costSource === "pending") {
      continue;
    }
    const createdAt = new Date(entry.entryCreatedAt);
    if (Number.isNaN(createdAt.getTime())) {
      log.warn("[usage-stats] 跳过 entryCreatedAt 非法的费用记录", {
        runId: entry.runId,
        attemptIndex: entry.attemptIndex,
        entryCreatedAt: entry.entryCreatedAt
      });
      continue;
    }

    const runDay = localCivilDay(createdAt, timezoneOffsetMinutes);
    const runDayKey = dayKey(runDay);
    const runWeekStart = weekStart(runDay);
    const runMonthStart = monthStart(runDay);

    applyCostEntry(total, entry);
    applyCostEntry(modelDraft(models, entry), entry);

    if (runDayKey === todayKey) {
      applyCostEntry(today, entry);
    }
    if (dayKey(runWeekStart) === dayKey(currentWeekStart)) {
      applyCostEntry(week, entry);
    }
    const dailyBucket = dailyByKey.get(runDayKey);
    if (dailyBucket) {
      applyCostEntry(dailyBucket.summary, entry);
    }
    const weeklyBucket = weeklyByKey.get(dayKey(runWeekStart));
    if (weeklyBucket) {
      applyCostEntry(weeklyBucket.summary, entry);
    }
    const monthlyBucket = monthlyByKey.get(monthKey(runMonthStart));
    if (monthlyBucket) {
      applyCostEntry(monthlyBucket.summary, entry);
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

function applyCostEntry(summary: SummaryDraft, entry: UsageCostEntry): void {
  summary.runIds.add(entry.runId);
  summary.promptTokens += entry.promptTokens;
  summary.completionTokens += entry.completionTokens;
  summary.cachedPromptTokens += entry.cachedPromptTokens;
  summary.totalTokens += entry.totalTokens;
  summary.costCny += entry.costCny;

  if (entry.tokenCountSource === "provider_usage") {
    summary.usageRunIds.add(entry.runId);
  } else {
    summary.missingUsageRunIds.add(entry.runId);
  }
  if (entry.costSource === "unpriced") {
    summary.unknownPriceRunIds.add(entry.runId);
  }
  if (entry.billable) {
    summary.pricedRunIds.add(entry.runId);
  }
  if (!entry.providerKind || !entry.model) {
    summary.fallbackModelRunIds.add(entry.runId);
  }
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
    fallbackModelRunCount: 0,
    runIds: new Set(),
    usageRunIds: new Set(),
    missingUsageRunIds: new Set(),
    pricedRunIds: new Set(),
    unknownPriceRunIds: new Set(),
    fallbackModelRunIds: new Set()
  };
}

function finalizeSummary(summary: SummaryDraft): UsageStatsRangeSummary {
  return {
    costCny: roundCurrency(summary.costCny),
    promptTokens: summary.promptTokens,
    completionTokens: summary.completionTokens,
    cachedPromptTokens: summary.cachedPromptTokens,
    totalTokens: summary.totalTokens,
    runCount: summary.runIds.size,
    usageRunCount: summary.usageRunIds.size,
    missingUsageRunCount: summary.missingUsageRunIds.size,
    pricedRunCount: summary.pricedRunIds.size,
    unknownPriceRunCount: summary.unknownPriceRunIds.size,
    fallbackModelRunCount: summary.fallbackModelRunIds.size
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

function modelDraft(drafts: Map<string, ModelDraft>, entry: UsageCostEntry): SummaryDraft {
  const modelId = entry.model ?? UNKNOWN_MODEL;
  const key = `${entry.providerKind ?? "unknown"}:${entry.providerId ?? "unknown"}:${modelId}`;
  const existing = drafts.get(key);
  if (existing) {
    return existing.summary;
  }
  const draft: ModelDraft = {
    ...(entry.providerId ? { providerId: entry.providerId } : {}),
    ...(entry.providerKind ? { providerKind: entry.providerKind } : {}),
    model: modelId,
    label:
      modelId === UNKNOWN_MODEL
        ? "unknown"
        : entry.providerId
          ? `${entry.providerId} · ${modelId}`
          : modelId,
    summary: emptySummary()
  };
  drafts.set(key, draft);
  return draft.summary;
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
    log.warn("[usage-stats] 收到非法时区偏移，已回退到 UTC", { value });
    return 0;
  }
  return Math.trunc(Math.max(-840, Math.min(840, value)));
}
