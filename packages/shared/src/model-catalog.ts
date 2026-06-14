import { z } from "zod";

import {
  estimateModelCostUsd,
  MAX_CONFIGURABLE_TOOL_ITERATIONS,
  modelInputModalitySchema,
  reasoningModeSchema,
  type ModelContextInfo,
  type ModelInputModality,
  type ModelPricingInfo
} from "./model";
import { PROVIDER_CATALOG, PROVIDER_CATALOG_SETTINGS } from "./provider-catalog.generated";
import { providerKindSchema, type ProviderConfig, type ProviderKind } from "./provider";

export const providerModelOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).optional(),
  providerKind: providerKindSchema,
  reasoningModes: z.array(reasoningModeSchema),
  defaultReasoningMode: reasoningModeSchema.optional(),
  reasoningAlwaysOn: z.boolean().optional(),
  contextWindowTokens: z.number().int().positive().optional(),
  autoCompactThresholdTokens: z.number().int().positive().optional(),
  enabled: z.boolean().default(true),
  inputModalities: z.array(modelInputModalitySchema).nonempty().default(["text"]),
  autoCompactThresholdRatio: z
    .number()
    .positive()
    .max(1)
    .default(getCatalogDefaultAutoCompactThresholdRatio()),
  maxToolIterations: z
    .number()
    .int()
    .positive()
    .max(MAX_CONFIGURABLE_TOOL_ITERATIONS)
    .default(getCatalogDefaultMaxToolIterations()),
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

type CatalogRecord = Record<string, unknown>;
type CatalogEntryLike = {
  kind: string;
  models: readonly CatalogRecord[];
  modelFallbacks: readonly CatalogRecord[];
};

export function getCatalogDefaultMaxToolIterations(): number {
  return PROVIDER_CATALOG_SETTINGS.runtimeDefaults.maxToolIterations;
}

export function getCatalogDefaultAutoCompactThresholdRatio(): number {
  return PROVIDER_CATALOG_SETTINGS.runtimeDefaults.autoCompactThresholdRatio;
}

export function getCatalogUsdToCnyExchangeRate(): number {
  return PROVIDER_CATALOG_SETTINGS.currency.usdToCnyExchangeRate;
}

export function getCatalogModelOptions(kind: ProviderKind): ProviderModelOption[] {
  const entry = getGeneratedCatalogEntry(kind);
  if (!entry) {
    return [];
  }
  return entry.models.map((model) =>
    providerModelOptionSchema.parse({
      ...copyCapability(model),
      id: model.id,
      providerKind: kind,
      source: "catalog" as const
    })
  );
}

export function getCatalogDefaultEnabledModelIds(kind: ProviderKind): string[] {
  return getCatalogModelOptions(kind)
    .filter((model) => model.enabled)
    .map((model) => model.id);
}

export function getProviderConfigModelOptions(provider: ProviderConfig): ProviderModelOption[] {
  const entry = getProviderCatalogEntryLike(provider);
  return entry.models.map((model) =>
    providerModelOptionSchema.parse({
      ...copyCapability(model),
      id: String(model.id),
      providerKind: provider.kind,
      source: "catalog" as const
    })
  );
}

export function getProviderConfigDefaultEnabledModelIds(provider: ProviderConfig): string[] {
  return getProviderConfigModelOptions(provider)
    .filter((model) => model.enabled)
    .map((model) => model.id);
}

export function resolveProviderModelOption(
  kind: ProviderKind,
  modelId: string
): ProviderModelOption {
  const exact = getCatalogModelOptions(kind).find((option) => option.id === modelId);
  if (exact) {
    return exact;
  }
  return resolveLiveModelOption(kind, modelId);
}

export function resolveProviderConfigModelOption(
  provider: ProviderConfig,
  modelId = provider.model
): ProviderModelOption {
  const exact = getProviderConfigModelOptions(provider).find((option) => option.id === modelId);
  if (exact) {
    return exact;
  }
  return resolveLiveModelOption(provider.kind, modelId, getProviderCatalogEntryLike(provider));
}

export function resolveProviderModelMaxToolIterations(
  provider: Pick<ProviderConfig, "kind" | "model" | "modelOverrides">,
  modelId = provider.model
): number {
  return (
    provider.modelOverrides?.[modelId]?.maxToolIterations ??
    resolveProviderModelOption(provider.kind, modelId).maxToolIterations
  );
}

export function resolveProviderConfigModelMaxToolIterations(
  provider: ProviderConfig,
  modelId = provider.model
): number {
  return (
    provider.modelOverrides?.[modelId]?.maxToolIterations ??
    resolveProviderConfigModelOption(provider, modelId).maxToolIterations
  );
}

export function resolveModelInputModalities(
  kind: ProviderKind,
  modelId: string
): ModelInputModality[] {
  return resolveProviderModelOption(kind, modelId).inputModalities;
}

export function resolveProviderConfigModelInputModalities(
  provider: ProviderConfig,
  modelId = provider.model
): ModelInputModality[] {
  return resolveProviderConfigModelOption(provider, modelId).inputModalities;
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

export function mergeProviderConfigModelOptions(
  provider: ProviderConfig,
  liveModelIds: string[],
  currentModelId = provider.model
): ProviderModelOption[] {
  const byId = new Map<string, ProviderModelOption>();
  for (const option of getProviderConfigModelOptions(provider)) {
    byId.set(option.id, option);
  }
  for (const id of liveModelIds) {
    if (!byId.has(id)) {
      byId.set(id, resolveProviderConfigModelOption(provider, id));
    }
  }
  if (currentModelId && !byId.has(currentModelId)) {
    byId.set(currentModelId, resolveProviderConfigModelOption(provider, currentModelId));
  }
  return [...byId.values()];
}

export function resolveModelContextInfo(
  kind: ProviderKind,
  modelId: string
): ModelContextInfo {
  const option = resolveProviderModelOption(kind, modelId);
  return {
    contextWindowTokens: option.contextWindowTokens,
    autoCompactThresholdTokens: option.autoCompactThresholdTokens,
    autoCompactThresholdRatio: option.autoCompactThresholdRatio
  };
}

export function resolveProviderConfigModelContextInfo(
  provider: ProviderConfig,
  modelId = provider.model
): ModelContextInfo {
  const option = resolveProviderConfigModelOption(provider, modelId);
  return {
    contextWindowTokens: option.contextWindowTokens,
    autoCompactThresholdTokens: option.autoCompactThresholdTokens,
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

export function resolveProviderConfigModelPricingInfo(
  provider: ProviderConfig,
  modelId = provider.model
): ModelPricingInfo {
  return (
    resolveProviderConfigModelOption(provider, modelId).pricing ?? {
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

export function estimateProviderConfigModelCostUsd(
  provider: ProviderConfig,
  usage: Parameters<typeof estimateModelCostUsd>[1],
  modelId = provider.model
): number | undefined {
  return estimateModelCostUsd(resolveProviderConfigModelPricingInfo(provider, modelId), usage);
}

function resolveLiveModelOption(
  kind: ProviderKind,
  modelId: string,
  catalogEntry = getGeneratedCatalogEntry(kind)
): ProviderModelOption {
  const normalized = modelId.toLowerCase();
  let draft: CatalogRecord = {
    id: modelId,
    providerKind: kind,
    reasoningModes: [],
    inputModalities: ["text"],
    autoCompactThresholdRatio: getCatalogDefaultAutoCompactThresholdRatio(),
    maxToolIterations: getCatalogDefaultMaxToolIterations(),
    source: "live" as const
  };

  for (const fallback of catalogEntry?.modelFallbacks ?? []) {
    if (typeof fallback.pattern !== "string") {
      continue;
    }
    if (new RegExp(fallback.pattern, "i").test(normalized)) {
      draft = {
        ...draft,
        ...copyCapability(fallback)
      };
    }
  }

  return providerModelOptionSchema.parse(draft);
}

function getGeneratedCatalogEntry(kind: ProviderKind): CatalogEntryLike | undefined {
  const entry = (PROVIDER_CATALOG as unknown as Record<string, CatalogEntryLike | undefined>)[kind];
  if (!entry) {
    return undefined;
  }
  return {
    kind,
    models: [...entry.models],
    modelFallbacks: [...entry.modelFallbacks]
  };
}

function getProviderCatalogEntryLike(provider: ProviderConfig): CatalogEntryLike {
  const catalog = provider.catalog;
  if (isRecord(catalog)) {
    const models = Array.isArray(catalog.models)
      ? catalog.models.filter(isRecord)
      : [];
    const modelFallbacks = Array.isArray(catalog.modelFallbacks)
      ? catalog.modelFallbacks.filter(isRecord)
      : [];
    return {
      kind: provider.kind,
      models,
      modelFallbacks
    };
  }
  return getGeneratedCatalogEntry(provider.kind) ?? {
    kind: provider.kind,
    models: [],
    modelFallbacks: []
  };
}

function copyCapability(input: CatalogRecord): CatalogRecord {
  const output: CatalogRecord = {};
  copyString(input, output, "label");
  copyString(input, output, "currency");
  copyBoolean(input, output, "reasoningAlwaysOn");
  copyBoolean(input, output, "enabled");
  copyString(input, output, "defaultReasoningMode");
  copyNumber(input, output, "contextWindowTokens");
  copyNumber(input, output, "autoCompactThresholdTokens");
  copyNumber(input, output, "autoCompactThresholdRatio");
  copyNumber(input, output, "maxToolIterations");
  copyStringArray(input, output, "reasoningModes");
  copyStringArray(input, output, "inputModalities");
  if (isRecord(input.pricing)) {
    output.pricing = { ...input.pricing };
  }
  return output;
}

function copyString(input: CatalogRecord, output: CatalogRecord, key: string): void {
  if (typeof input[key] === "string") {
    output[key] = input[key];
  }
}

function copyBoolean(input: CatalogRecord, output: CatalogRecord, key: string): void {
  if (typeof input[key] === "boolean") {
    output[key] = input[key];
  }
}

function copyNumber(input: CatalogRecord, output: CatalogRecord, key: string): void {
  if (typeof input[key] === "number") {
    output[key] = input[key];
  }
}

function copyStringArray(input: CatalogRecord, output: CatalogRecord, key: string): void {
  if (Array.isArray(input[key])) {
    output[key] = [...input[key]];
  }
}

function isRecord(value: unknown): value is CatalogRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
