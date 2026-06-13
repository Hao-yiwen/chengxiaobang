import { z } from "zod";

export const reasoningModeSchema = z.enum([
  "off",
  "auto",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh"
]);
export type ReasoningMode = z.infer<typeof reasoningModeSchema>;

export const modelInputModalitySchema = z.enum(["text", "image", "video"]);
export type ModelInputModality = z.infer<typeof modelInputModalitySchema>;

export const DEFAULT_CONTEXT_COMPACT_THRESHOLD_RATIO = 0.8;

export const modelContextInfoSchema = z.object({
  contextWindowTokens: z.number().int().positive().optional(),
  autoCompactThresholdRatio: z
    .number()
    .positive()
    .max(1)
    .default(DEFAULT_CONTEXT_COMPACT_THRESHOLD_RATIO)
});
export type ModelContextInfo = z.infer<typeof modelContextInfoSchema>;

export const modelPricingInfoSchema = z.object({
  currency: z.literal("USD").default("USD"),
  inputCostPerMillion: z.number().nonnegative().optional(),
  outputCostPerMillion: z.number().nonnegative().optional(),
  cacheReadCostPerMillion: z.number().nonnegative().optional(),
  cacheWriteCostPerMillion: z.number().nonnegative().optional(),
  pricingSource: z.string().optional()
});
export type ModelPricingInfo = z.infer<typeof modelPricingInfoSchema>;

export function contextCompactThresholdTokens(
  info: ModelContextInfo
): number | undefined {
  return info.contextWindowTokens
    ? Math.floor(info.contextWindowTokens * info.autoCompactThresholdRatio)
    : undefined;
}

export const sessionContextUsageSchema = z.object({
  sessionId: z.string().min(1),
  providerId: z.string().min(1),
  model: z.string().min(1),
  estimatedTokens: z.number().int().nonnegative(),
  systemPromptTokens: z.number().int().nonnegative(),
  messageTokens: z.number().int().nonnegative(),
  toolTokens: z.number().int().nonnegative(),
  messageCount: z.number().int().nonnegative(),
  compacted: z.boolean(),
  contextWindowTokens: z.number().int().positive().optional(),
  autoCompactThresholdRatio: z.number().positive().max(1),
  autoCompactThresholdTokens: z.number().int().positive().optional(),
  usedRatio: z.number().nonnegative().optional(),
  remainingTokens: z.number().int().nonnegative().optional(),
  status: z.enum(["unknown", "ok", "near_threshold", "over_threshold"]),
  sessionCostCny: z.number().nonnegative()
});
export type SessionContextUsage = z.infer<typeof sessionContextUsageSchema>;

/** Token accounting for a single run, when the provider reports it. */
export const tokenUsageSchema = z.object({
  promptTokens: z.number().int().nonnegative(),
  completionTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  cachedPromptTokens: z.number().int().nonnegative().optional(),
  costUsd: z.number().nonnegative().optional()
});
export type TokenUsage = z.infer<typeof tokenUsageSchema>;

export function estimateModelCostUsd(
  pricing: ModelPricingInfo,
  usage: {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  }
): number | undefined {
  let total = 0;
  let hasPricing = false;
  if (pricing.inputCostPerMillion !== undefined && usage.inputTokens) {
    total += (pricing.inputCostPerMillion / 1_000_000) * usage.inputTokens;
    hasPricing = true;
  }
  if (pricing.outputCostPerMillion !== undefined && usage.outputTokens) {
    total += (pricing.outputCostPerMillion / 1_000_000) * usage.outputTokens;
    hasPricing = true;
  }
  if (pricing.cacheReadCostPerMillion !== undefined && usage.cacheReadTokens) {
    total +=
      (pricing.cacheReadCostPerMillion / 1_000_000) * usage.cacheReadTokens;
    hasPricing = true;
  }
  if (pricing.cacheWriteCostPerMillion !== undefined && usage.cacheWriteTokens) {
    total += (pricing.cacheWriteCostPerMillion / 1_000_000) * usage.cacheWriteTokens;
    hasPricing = true;
  }
  return hasPricing ? total : undefined;
}
