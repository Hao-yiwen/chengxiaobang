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

/** Token accounting for a single run, when the provider reports it. */
export const tokenUsageSchema = z.object({
  promptTokens: z.number().int().nonnegative(),
  completionTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  cachedPromptTokens: z.number().int().nonnegative().optional()
});
export type TokenUsage = z.infer<typeof tokenUsageSchema>;
