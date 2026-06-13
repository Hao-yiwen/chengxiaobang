import { z } from "zod";

export const webSearchConfigSchema = z.object({
  enabled: z.boolean(),
  apiKeyRef: z.string().min(1).optional(),
  updatedAt: z.string().optional()
});
export type WebSearchConfig = z.infer<typeof webSearchConfigSchema>;

export function defaultWebSearchConfig(): WebSearchConfig {
  return { enabled: false };
}

export const webSearchConfigInputSchema = z.object({
  enabled: z.boolean(),
  apiKey: z.string().optional()
});
export type WebSearchConfigInput = z.infer<typeof webSearchConfigInputSchema>;
