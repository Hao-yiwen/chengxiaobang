import { z } from "zod";

import { reasoningModeSchema } from "./model";
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
  /** 该供应商启用的模型列表（共用同一个 API Key）；缺省表示不限制。 */
  models: z.array(z.string().min(1)).optional(),
  reasoningMode: reasoningModeSchema.optional(),
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
  models: z.array(z.string().min(1)).optional(),
  reasoningMode: reasoningModeSchema.optional(),
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
    },
    {
      id: "minimax",
      kind: "minimax",
      name: "MiniMax",
      baseURL: "https://api.minimaxi.com/v1",
      model: "MiniMax-M3",
      createdAt: timestamp,
      updatedAt: timestamp
    },
    {
      id: "doubao",
      kind: "doubao",
      name: "豆包",
      baseURL: "https://ark.cn-beijing.volces.com/api/v3",
      model: "doubao-seed-1-6-250615",
      createdAt: timestamp,
      updatedAt: timestamp
    },
    {
      id: "qwen",
      kind: "qwen",
      name: "千问",
      baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      model: "qwen-plus",
      createdAt: timestamp,
      updatedAt: timestamp
    }
  ];
}
