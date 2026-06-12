import { z } from "zod";

/** Token accounting for a single run, when the provider reports it. */
export const tokenUsageSchema = z.object({
  promptTokens: z.number().int().nonnegative(),
  completionTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  cachedPromptTokens: z.number().int().nonnegative().optional()
});
export type TokenUsage = z.infer<typeof tokenUsageSchema>;
