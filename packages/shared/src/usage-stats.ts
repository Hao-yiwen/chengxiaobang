import { z } from "zod";

import { providerKindSchema } from "./provider";

export const usageStatsTokenSummarySchema = z.object({
  promptTokens: z.number().int().nonnegative(),
  completionTokens: z.number().int().nonnegative(),
  cachedPromptTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative()
});
export type UsageStatsTokenSummary = z.infer<typeof usageStatsTokenSummarySchema>;

export const usageStatsRangeSummarySchema = usageStatsTokenSummarySchema.extend({
  costCny: z.number().nonnegative(),
  runCount: z.number().int().nonnegative(),
  usageRunCount: z.number().int().nonnegative(),
  missingUsageRunCount: z.number().int().nonnegative(),
  pricedRunCount: z.number().int().nonnegative(),
  unknownPriceRunCount: z.number().int().nonnegative(),
  fallbackModelRunCount: z.number().int().nonnegative()
});
export type UsageStatsRangeSummary = z.infer<typeof usageStatsRangeSummarySchema>;

export const usageStatsBucketSchema = usageStatsRangeSummarySchema.extend({
  key: z.string().min(1),
  label: z.string().min(1),
  startAt: z.string().min(1),
  endAt: z.string().min(1)
});
export type UsageStatsBucket = z.infer<typeof usageStatsBucketSchema>;

export const usageStatsModelBreakdownSchema = usageStatsRangeSummarySchema.extend({
  providerId: z.string().min(1).optional(),
  providerKind: providerKindSchema.optional(),
  model: z.string().min(1),
  label: z.string().min(1)
});
export type UsageStatsModelBreakdown = z.infer<typeof usageStatsModelBreakdownSchema>;

export const usageStatsDataQualitySchema = z.object({
  totalRunCount: z.number().int().nonnegative(),
  usageRunCount: z.number().int().nonnegative(),
  missingUsageRunCount: z.number().int().nonnegative(),
  pricedRunCount: z.number().int().nonnegative(),
  unknownPriceRunCount: z.number().int().nonnegative(),
  fallbackModelRunCount: z.number().int().nonnegative()
});
export type UsageStatsDataQuality = z.infer<typeof usageStatsDataQualitySchema>;

export const usageStatsSchema = z.object({
  generatedAt: z.string().min(1),
  timezoneOffsetMinutes: z.number().int(),
  currency: z.literal("CNY"),
  today: usageStatsRangeSummarySchema,
  week: usageStatsRangeSummarySchema,
  total: usageStatsRangeSummarySchema,
  dailyBuckets: z.array(usageStatsBucketSchema),
  weeklyBuckets: z.array(usageStatsBucketSchema),
  monthlyBuckets: z.array(usageStatsBucketSchema),
  topModels: z.array(usageStatsModelBreakdownSchema),
  dataQuality: usageStatsDataQualitySchema
});
export type UsageStats = z.infer<typeof usageStatsSchema>;
