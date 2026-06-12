import { z } from "zod";

import { reasoningModeSchema, type ReasoningMode } from "./model";
import { providerKindSchema, type ProviderKind } from "./provider";

export const providerModelOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).optional(),
  providerKind: providerKindSchema,
  reasoningModes: z.array(reasoningModeSchema),
  reasoningAlwaysOn: z.boolean().optional(),
  source: z.enum(["catalog", "live"])
});
export type ProviderModelOption = z.infer<typeof providerModelOptionSchema>;

type CatalogEntry = Omit<ProviderModelOption, "providerKind" | "source">;

const CATALOG: Record<ProviderKind, CatalogEntry[]> = {
  deepseek: [
    {
      id: "deepseek-v4-flash",
      label: "DeepSeek V4 Flash",
      reasoningModes: ["off", "high", "xhigh"]
    },
    {
      id: "deepseek-v4-pro",
      label: "DeepSeek V4 Pro",
      reasoningModes: ["off", "high", "xhigh"]
    }
  ],
  kimi: [
    {
      id: "kimi-k2.7-code",
      label: "Kimi K2.7 Code",
      reasoningModes: [],
      reasoningAlwaysOn: true
    },
    {
      id: "kimi-k2.6",
      label: "Kimi K2.6",
      reasoningModes: ["off", "auto"]
    },
    {
      id: "kimi-k2.5",
      label: "Kimi K2.5",
      reasoningModes: ["off", "auto"]
    }
  ],
  minimax: [
    {
      id: "MiniMax-M3",
      label: "MiniMax M3",
      reasoningModes: ["off", "auto"]
    }
  ],
  doubao: [
    {
      id: "doubao-seed-1-6-250615",
      label: "Doubao Seed 1.6",
      reasoningModes: ["off", "minimal", "low", "medium", "high"]
    }
  ],
  qwen: [
    {
      id: "qwen-plus",
      label: "Qwen Plus",
      reasoningModes: ["off", "auto"]
    },
    {
      id: "qwen-flash",
      label: "Qwen Flash",
      reasoningModes: ["off", "auto"]
    },
    {
      id: "qwen3.5-plus",
      label: "Qwen3.5 Plus",
      reasoningModes: ["off", "auto"]
    },
    {
      id: "qwen3.5-flash",
      label: "Qwen3.5 Flash",
      reasoningModes: ["off", "auto"]
    },
    {
      id: "qwen3-max",
      label: "Qwen3 Max",
      reasoningModes: ["off", "auto"]
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
    source: "live"
  };
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
