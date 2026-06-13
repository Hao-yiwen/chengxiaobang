import { z } from "zod";

import {
  DEFAULT_CONTEXT_COMPACT_THRESHOLD_RATIO,
  estimateModelCostUsd,
  modelInputModalitySchema,
  reasoningModeSchema,
  type ModelContextInfo,
  type ModelInputModality,
  type ModelPricingInfo,
  type ReasoningMode
} from "./model";
import { providerKindSchema, type ProviderKind } from "./provider";

export const providerModelOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).optional(),
  providerKind: providerKindSchema,
  reasoningModes: z.array(reasoningModeSchema),
  reasoningAlwaysOn: z.boolean().optional(),
  contextWindowTokens: z.number().int().positive().optional(),
  inputModalities: z.array(modelInputModalitySchema).nonempty().default(["text"]),
  autoCompactThresholdRatio: z
    .number()
    .positive()
    .max(1)
    .default(DEFAULT_CONTEXT_COMPACT_THRESHOLD_RATIO),
  pricing: z
    .object({
      currency: z.literal("USD").default("USD"),
      inputCostPerMillion: z.number().nonnegative().optional(),
      outputCostPerMillion: z.number().nonnegative().optional(),
      cacheReadCostPerMillion: z.number().nonnegative().optional(),
      cacheWriteCostPerMillion: z.number().nonnegative().optional(),
      pricingSource: z.string().optional()
    })
    .optional(),
  source: z.enum(["catalog", "live"])
});
export type ProviderModelOption = z.infer<typeof providerModelOptionSchema>;

type CatalogEntry = Omit<ProviderModelOption, "providerKind" | "source">;

const CONTEXT_1M = {
  contextWindowTokens: 1_000_000,
  autoCompactThresholdRatio: DEFAULT_CONTEXT_COMPACT_THRESHOLD_RATIO
};

const CONTEXT_256K = {
  contextWindowTokens: 262_144,
  autoCompactThresholdRatio: DEFAULT_CONTEXT_COMPACT_THRESHOLD_RATIO
};

const TEXT_INPUT = {
  inputModalities: ["text"] as ModelInputModality[]
};

const VISION_INPUT = {
  inputModalities: ["text", "image", "video"] as ModelInputModality[]
};

const PRICING_SOURCES = {
  deepseek: "DeepSeek API pricing, 2026-06",
  kimi: "Kimi API pricing, 2026-06",
  minimax: "MiniMax API pricing, 2026-06",
  doubao: "Volcengine ModelArk pricing, 2026-06",
  qwen: "Alibaba Cloud Model Studio pricing, 2026-06"
} as const;

function usdPricing(
  input: number,
  output: number,
  source: string,
  cacheRead?: number
): ModelPricingInfo {
  return {
    currency: "USD",
    inputCostPerMillion: input,
    outputCostPerMillion: output,
    ...(cacheRead !== undefined ? { cacheReadCostPerMillion: cacheRead } : {}),
    pricingSource: source
  };
}

const CATALOG: Record<ProviderKind, CatalogEntry[]> = {
  deepseek: [
    {
      id: "deepseek-v4-flash",
      label: "DeepSeek V4 Flash",
      reasoningModes: ["off", "high", "xhigh"],
      ...TEXT_INPUT,
      ...CONTEXT_1M,
      pricing: usdPricing(0.14, 0.28, PRICING_SOURCES.deepseek, 0.0028)
    },
    {
      id: "deepseek-v4-pro",
      label: "DeepSeek V4 Pro",
      reasoningModes: ["off", "high", "xhigh"],
      ...TEXT_INPUT,
      ...CONTEXT_1M,
      pricing: usdPricing(0.435, 0.87, PRICING_SOURCES.deepseek, 0.003625)
    }
  ],
  kimi: [
    {
      id: "kimi-k2.7-code",
      label: "Kimi K2.7 Code",
      reasoningModes: [],
      reasoningAlwaysOn: true,
      ...VISION_INPUT,
      ...CONTEXT_256K,
      pricing: usdPricing(0.95, 4, PRICING_SOURCES.kimi, 0.19)
    },
    {
      id: "kimi-k2.6",
      label: "Kimi K2.6",
      reasoningModes: ["off", "auto"],
      ...VISION_INPUT,
      ...CONTEXT_256K,
      pricing: usdPricing(0.95, 4, PRICING_SOURCES.kimi, 0.16)
    },
    {
      id: "kimi-k2.5",
      label: "Kimi K2.5",
      reasoningModes: ["off", "auto"],
      ...VISION_INPUT,
      ...CONTEXT_256K,
      pricing: usdPricing(0.6, 3, PRICING_SOURCES.kimi, 0.1)
    }
  ],
  minimax: [
    {
      id: "MiniMax-M3",
      label: "MiniMax M3",
      reasoningModes: ["off", "auto"],
      ...VISION_INPUT,
      ...CONTEXT_1M,
      pricing: usdPricing(0.3, 1.2, PRICING_SOURCES.minimax, 0.06)
    }
  ],
  doubao: [
    {
      id: "doubao-seed-1-6-250615",
      label: "Doubao Seed 1.6",
      reasoningModes: ["off", "minimal", "low", "medium", "high"],
      ...VISION_INPUT,
      ...CONTEXT_256K,
      pricing: usdPricing(0.8, 8, PRICING_SOURCES.doubao)
    }
  ],
  qwen: [
    {
      id: "qwen-plus",
      label: "Qwen Plus",
      reasoningModes: ["off", "auto"],
      ...TEXT_INPUT,
      ...CONTEXT_1M,
      pricing: usdPricing(0.4, 1.2, PRICING_SOURCES.qwen)
    },
    {
      id: "qwen-flash",
      label: "Qwen Flash",
      reasoningModes: ["off", "auto"],
      ...TEXT_INPUT,
      ...CONTEXT_1M,
      pricing: usdPricing(0.05, 0.4, PRICING_SOURCES.qwen)
    },
    {
      id: "qwen3.5-plus",
      label: "Qwen3.5 Plus",
      reasoningModes: ["off", "auto"],
      ...VISION_INPUT,
      ...CONTEXT_1M,
      pricing: usdPricing(0.115, 0.688, PRICING_SOURCES.qwen)
    },
    {
      id: "qwen3.5-flash",
      label: "Qwen3.5 Flash",
      reasoningModes: ["off", "auto"],
      ...VISION_INPUT,
      ...CONTEXT_1M,
      pricing: usdPricing(0.029, 0.287, PRICING_SOURCES.qwen)
    },
    {
      id: "qwen3-max",
      label: "Qwen3 Max",
      reasoningModes: ["off", "auto"],
      ...TEXT_INPUT,
      ...CONTEXT_256K,
      pricing: usdPricing(0.359, 1.434, PRICING_SOURCES.qwen)
    }
  ],
  "openai-compatible": [],
  custom: []
};

export function getCatalogModelOptions(kind: ProviderKind): ProviderModelOption[] {
  return CATALOG[kind].map((entry) => ({
    ...entry,
    providerKind: kind,
    source: "catalog" as const
  }));
}

export function resolveProviderModelOption(
  kind: ProviderKind,
  modelId: string
): ProviderModelOption {
  const exact = getCatalogModelOptions(kind).find((option) => option.id === modelId);
  if (exact) {
    return exact;
  }
  return {
    id: modelId,
    providerKind: kind,
    reasoningModes: inferReasoningModes(kind, modelId),
    reasoningAlwaysOn: inferReasoningAlwaysOn(kind, modelId),
    inputModalities: resolveModelInputModalities(kind, modelId),
    ...inferModelContextInfo(kind, modelId),
    ...inferModelPricingInfo(kind, modelId),
    source: "live"
  };
}

export function resolveModelInputModalities(
  kind: ProviderKind,
  modelId: string
): ModelInputModality[] {
  const exact = getCatalogModelOptions(kind).find((option) => option.id === modelId);
  if (exact) {
    return exact.inputModalities;
  }
  return inferModelInputModalities(kind, modelId);
}

export function mergeProviderModelOptions(
  kind: ProviderKind,
  liveModelIds: string[],
  currentModelId?: string
): ProviderModelOption[] {
  const byId = new Map<string, ProviderModelOption>();
  for (const option of getCatalogModelOptions(kind)) {
    byId.set(option.id, option);
  }
  for (const id of liveModelIds) {
    if (!byId.has(id)) {
      byId.set(id, resolveProviderModelOption(kind, id));
    }
  }
  if (currentModelId && !byId.has(currentModelId)) {
    byId.set(currentModelId, resolveProviderModelOption(kind, currentModelId));
  }
  return [...byId.values()];
}

function inferReasoningModes(kind: ProviderKind, modelId: string): ReasoningMode[] {
  const normalized = modelId.toLowerCase();
  if (kind === "deepseek" && normalized.startsWith("deepseek-v4-")) {
    return ["off", "high", "xhigh"];
  }
  if (kind === "kimi" && /^kimi-k2\.(5|6)\b/.test(normalized)) {
    return ["off", "auto"];
  }
  if (kind === "minimax" && normalized === "minimax-m3") {
    return ["off", "auto"];
  }
  if (kind === "doubao" && normalized.includes("seed")) {
    return ["off", "minimal", "low", "medium", "high"];
  }
  if (kind === "qwen" && /(qwen|qwq)/.test(normalized)) {
    return ["off", "auto"];
  }
  return [];
}

function inferReasoningAlwaysOn(kind: ProviderKind, modelId: string): boolean | undefined {
  const normalized = modelId.toLowerCase();
  if (kind === "kimi" && normalized === "kimi-k2.7-code") {
    return true;
  }
  if (kind === "minimax" && /^minimax-m2\./.test(normalized)) {
    return true;
  }
  return undefined;
}

function inferModelInputModalities(kind: ProviderKind, modelId: string): ModelInputModality[] {
  const normalized = modelId.toLowerCase();
  if (kind === "kimi" && /^kimi-k2\.(5|6)\b/.test(normalized)) {
    return ["text", "image", "video"];
  }
  if (kind === "kimi" && normalized === "kimi-k2.7-code") {
    return ["text", "image", "video"];
  }
  if (kind === "minimax" && normalized === "minimax-m3") {
    return ["text", "image", "video"];
  }
  if (kind === "doubao" && normalized.includes("seed-1-6")) {
    return ["text", "image", "video"];
  }
  if (kind === "qwen" && /^qwen3\.5-(plus|flash)\b/.test(normalized)) {
    return ["text", "image", "video"];
  }
  return ["text"];
}

export function resolveModelContextInfo(
  kind: ProviderKind,
  modelId: string
): ModelContextInfo {
  const option = resolveProviderModelOption(kind, modelId);
  return {
    contextWindowTokens: option.contextWindowTokens,
    autoCompactThresholdRatio: option.autoCompactThresholdRatio
  };
}

export function resolveModelPricingInfo(
  kind: ProviderKind,
  modelId: string
): ModelPricingInfo {
  return (
    resolveProviderModelOption(kind, modelId).pricing ?? {
      currency: "USD"
    }
  );
}

export function estimateProviderModelCostUsd(
  kind: ProviderKind,
  modelId: string,
  usage: Parameters<typeof estimateModelCostUsd>[1]
): number | undefined {
  return estimateModelCostUsd(resolveModelPricingInfo(kind, modelId), usage);
}

function inferModelContextInfo(kind: ProviderKind, modelId: string): ModelContextInfo {
  const normalized = modelId.toLowerCase();
  if (kind === "deepseek" && normalized.startsWith("deepseek-v4-")) {
    return CONTEXT_1M;
  }
  if (kind === "kimi" && /^kimi-k2\.(5|6)\b/.test(normalized)) {
    return CONTEXT_256K;
  }
  if (kind === "kimi" && normalized === "kimi-k2.7-code") {
    return CONTEXT_256K;
  }
  if (kind === "minimax" && normalized === "minimax-m3") {
    return CONTEXT_1M;
  }
  if (kind === "doubao" && normalized.includes("seed-1-6")) {
    return CONTEXT_256K;
  }
  if (
    kind === "qwen" &&
    /^(qwen-plus|qwen-flash|qwen3\.5-plus|qwen3\.5-flash)\b/.test(normalized)
  ) {
    return CONTEXT_1M;
  }
  if (kind === "qwen" && normalized.startsWith("qwen3-max")) {
    return CONTEXT_256K;
  }
  return {
    autoCompactThresholdRatio: DEFAULT_CONTEXT_COMPACT_THRESHOLD_RATIO
  };
}

function inferModelPricingInfo(
  kind: ProviderKind,
  modelId: string
): { pricing?: ModelPricingInfo } {
  const normalized = modelId.toLowerCase();
  if (kind === "deepseek" && normalized === "deepseek-v4-flash") {
    return { pricing: usdPricing(0.14, 0.28, PRICING_SOURCES.deepseek, 0.0028) };
  }
  if (kind === "deepseek" && normalized === "deepseek-v4-pro") {
    return { pricing: usdPricing(0.435, 0.87, PRICING_SOURCES.deepseek, 0.003625) };
  }
  if (kind === "kimi" && normalized === "kimi-k2.7-code") {
    return { pricing: usdPricing(0.95, 4, PRICING_SOURCES.kimi, 0.19) };
  }
  if (kind === "kimi" && normalized === "kimi-k2.6") {
    return { pricing: usdPricing(0.95, 4, PRICING_SOURCES.kimi, 0.16) };
  }
  if (kind === "kimi" && normalized === "kimi-k2.5") {
    return { pricing: usdPricing(0.6, 3, PRICING_SOURCES.kimi, 0.1) };
  }
  if (kind === "minimax" && normalized === "minimax-m3") {
    return { pricing: usdPricing(0.3, 1.2, PRICING_SOURCES.minimax, 0.06) };
  }
  if (kind === "doubao" && normalized.includes("seed-1-6")) {
    return { pricing: usdPricing(0.8, 8, PRICING_SOURCES.doubao) };
  }
  if (kind === "qwen" && normalized === "qwen-plus") {
    return { pricing: usdPricing(0.4, 1.2, PRICING_SOURCES.qwen) };
  }
  if (kind === "qwen" && normalized === "qwen-flash") {
    return { pricing: usdPricing(0.05, 0.4, PRICING_SOURCES.qwen) };
  }
  if (kind === "qwen" && normalized.startsWith("qwen3.5-plus")) {
    return { pricing: usdPricing(0.115, 0.688, PRICING_SOURCES.qwen) };
  }
  if (kind === "qwen" && normalized.startsWith("qwen3.5-flash")) {
    return { pricing: usdPricing(0.029, 0.287, PRICING_SOURCES.qwen) };
  }
  if (kind === "qwen" && normalized.startsWith("qwen3-max")) {
    return { pricing: usdPricing(0.359, 1.434, PRICING_SOURCES.qwen) };
  }
  return {};
}
