import { getCatalogModelOptions } from "@chengxiaobang/shared";
import type { ProviderConfig, ProviderKind, ReasoningMode } from "@chengxiaobang/shared";
import type { AppState } from "../types";

export function isConfiguredProvider(provider: ProviderConfig | undefined): provider is ProviderConfig {
  return Boolean(provider?.apiKeyRef);
}

export function firstConfiguredProvider(providers: ProviderConfig[]): ProviderConfig | undefined {
  return providers.find(isConfiguredProvider);
}

export function configuredProviderById(
  providers: ProviderConfig[],
  id: string | undefined
): ProviderConfig | undefined {
  if (!id) {
    return undefined;
  }
  const provider = providers.find((item) => item.id === id);
  return isConfiguredProvider(provider) ? provider : undefined;
}

const CATALOG_PROVIDER_KINDS: ProviderKind[] = [
  "deepseek",
  "kimi",
  "minimax",
  "doubao",
  "qwen"
];

function catalogOwnsModel(kind: ProviderKind, model: string): boolean {
  return getCatalogModelOptions(kind).some((option) => option.id === model);
}

function modelBelongsToAnotherCatalog(provider: ProviderConfig, model: string): boolean {
  return CATALOG_PROVIDER_KINDS.some(
    (kind) => kind !== provider.kind && catalogOwnsModel(kind, model)
  );
}

function providerAcceptsModel(provider: ProviderConfig, model: string | undefined): boolean {
  if (!model || model === provider.model) {
    return true;
  }
  if (provider.models && provider.models.length > 0) {
    return provider.models.includes(model);
  }
  if (catalogOwnsModel(provider.kind, model)) {
    return true;
  }
  return provider.kind === "custom" || provider.kind === "openai-compatible"
    ? true
    : !modelBelongsToAnotherCatalog(provider, model);
}

export function normalizeModelForProvider(
  provider: ProviderConfig,
  model: string | undefined,
  reasoningMode: ReasoningMode | undefined,
  source: string
): Pick<AppState, "model" | "reasoningMode"> {
  if (providerAcceptsModel(provider, model)) {
    return { model, reasoningMode };
  }
  console.warn("[store] 模型不属于当前供应商，已回退到供应商默认模型", {
    source,
    providerId: provider.id,
    providerKind: provider.kind,
    staleModel: model,
    fallbackModel: provider.model
  });
  return { model: undefined, reasoningMode: undefined };
}
