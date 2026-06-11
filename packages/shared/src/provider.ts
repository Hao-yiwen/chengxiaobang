import { z } from "zod";

import { nowIso } from "./utils";

export const providerKindSchema = z.enum([
  "deepseek",
  "kimi",
  "minimax",
  "doubao",
  "qwen",
  "openai-compatible",
  "custom"
]);
export type ProviderKind = z.infer<typeof providerKindSchema>;

export const providerConfigSchema = z.object({
  id: z.string().min(1),
  kind: providerKindSchema,
  name: z.string().min(1),
  baseURL: z.string().url(),
  model: z.string().min(1),
  apiKeyRef: z.string().min(1).optional(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type ProviderConfig = z.infer<typeof providerConfigSchema>;

export const providerInputSchema = z.object({
  id: z.string().min(1).optional(),
  kind: providerKindSchema,
  name: z.string().min(1),
  baseURL: z.string().url(),
  model: z.string().min(1),
  apiKey: z.string().optional()
});
export type ProviderInput = z.infer<typeof providerInputSchema>;

export function defaultProviders(timestamp = nowIso()): ProviderConfig[] {
  return [
    {
      id: "deepseek",
      kind: "deepseek",
      name: "DeepSeek",
      baseURL: "https://api.deepseek.com",
      model: "deepseek-v4-flash",
      createdAt: timestamp,
      updatedAt: timestamp
    },
    {
      id: "kimi",
      kind: "kimi",
      name: "Kimi",
      baseURL: "https://api.moonshot.ai/v1",
      model: "kimi-k2.6",
      createdAt: timestamp,
      updatedAt: timestamp
    }
  ];
}
