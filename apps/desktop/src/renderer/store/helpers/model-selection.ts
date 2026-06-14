import { getCatalogModelOptions, getCatalogProviderKinds } from "@chengxiaobang/shared";
import type { ProviderConfig, ProviderKind, ReasoningMode, Session } from "@chengxiaobang/shared";
import type { AppState, ModelSelection } from "../types";
import { configuredProviderById } from "./providers";

const CATALOG_PROVIDER_KINDS = getCatalogProviderKinds();

type NormalizedModelSelection = { model: string; reasoningMode?: ReasoningMode };

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

export function normalizeModelSelectionForProvider(
  provider: ProviderConfig,
  model: string | undefined,
  reasoningMode: ReasoningMode | undefined,
  source: string
): NormalizedModelSelection {
  const effectiveModel = model ?? provider.model;
  if (providerAcceptsModel(provider, effectiveModel)) {
    return { model: effectiveModel, reasoningMode };
  }
  console.warn("[store] 模型不属于当前供应商，已回退到供应商默认模型", {
    source,
    providerId: provider.id,
    providerKind: provider.kind,
    staleModel: model,
    fallbackModel: provider.model
  });
  return { model: provider.model, reasoningMode: undefined };
}

export function restoreHomeModelSelection(
  state: AppState,
  providers: ProviderConfig[],
  source: string
): Pick<AppState, "providerId" | "model" | "reasoningMode" | "homeModelSelection"> {
  const selection = state.homeModelSelection;
  const provider = configuredProviderById(providers, selection.providerId);
  if (!provider) {
    if (selection.providerId) {
      console.warn("[store] 首页模型选择记忆已失效，清空模型选择", {
        source,
        providerId: selection.providerId
      });
    }
    return {
      providerId: undefined,
      model: undefined,
      reasoningMode: undefined,
      homeModelSelection: {}
    };
  }
  const modelState = normalizeModelSelectionForProvider(
    provider,
    selection.model,
    selection.reasoningMode,
    source
  );
  const homeModelSelection = { providerId: provider.id, ...modelState };
  console.debug("[store] 恢复首页模型选择记忆", {
    source,
    providerId: provider.id,
    model: modelState.model,
    reasoningMode: modelState.reasoningMode ?? "default"
  });
  return {
    providerId: provider.id,
    ...modelState,
    homeModelSelection
  };
}

export function resolveSessionModelSelection(
  session: Session | undefined,
  provider: ProviderConfig | undefined,
  source: string
): Pick<AppState, "model" | "reasoningMode"> {
  if (!provider) {
    return { model: undefined, reasoningMode: undefined };
  }
  const modelState = normalizeModelSelectionForProvider(
    provider,
    session?.model,
    session?.reasoningMode,
    source
  );
  console.debug("[store] 恢复会话模型选择", {
    source,
    sessionId: session?.id,
    providerId: provider.id,
    model: modelState.model,
    reasoningMode: modelState.reasoningMode ?? "default"
  });
  return modelState;
}
