import {
  createId,
  getCatalogDefaultEnabledModelIds,
  getCatalogModelOptions,
  getProviderConfigDefaultEnabledModelIds,
  getProviderConfigModelOptions,
  mergeProviderConfigModelOptions,
  nowIso,
  providerInputSchema,
  type ProviderConfig,
  type ProviderModelOverrides,
  type ProviderModelOption,
  type ProviderInput
} from "@chengxiaobang/shared";
import type { SecretStore } from "../secrets/secret-store";
import { listProviderModels, testProvider } from "./pi-model";

type TestProviderFn = (provider: ProviderConfig, apiKey?: string) => Promise<void>;
type ListModelsFn = (provider: ProviderConfig, apiKey?: string) => Promise<string[]>;
export type ProviderRepository = Pick<
  import("../repository/state-store").StateStore,
  "listProviders" | "getProvider" | "upsertProvider" | "deleteProvider"
>;

export class ProviderService {
  constructor(
    private readonly providers: ProviderRepository,
    private readonly secrets: SecretStore,
    private readonly testProviderFn: TestProviderFn = testProvider,
    private readonly listModelsFn: ListModelsFn = listProviderModels
  ) {}

  async listProviders(): Promise<ProviderConfig[]> {
    return this.providers.listProviders();
  }

  async saveProvider(input: ProviderInput): Promise<ProviderConfig> {
    const parsed = providerInputSchema.parse(input);
    const id = parsed.id ?? parsed.kind ?? createId("provider");
    const existing = await this.providers.getProvider(id);
    const timestamp = nowIso();
    const apiKeyRef =
      parsed.apiKey && parsed.apiKey.length > 0
        ? await this.secrets.setSecret(id, parsed.apiKey)
        : existing?.apiKeyRef;
    // 启用模型去重并按 YAML 目录过滤；默认模型必须在启用列表内，不在则回退到列表第一个。
    const models = normalizeSelectedModels(parsed, existing);
    const model = models.includes(parsed.model) ? parsed.model : models[0]!;
    const modelOverrides = filterModelOverrides(parsed.modelOverrides, models);

    console.info(
      `[provider-service] 保存供应商 providerId=${id} kind=${parsed.kind} selectedModelCount=${
        models.length
      } defaultModel=${model} modelOverrides=${Object.keys(modelOverrides ?? {}).length} hasApiKey=${Boolean(apiKeyRef)}`
    );
    return this.providers.upsertProvider({
      id,
      kind: parsed.kind,
      name: parsed.name,
      baseURL: parsed.baseURL,
      model,
      region: parsed.region ?? existing?.region,
      api: parsed.api ?? existing?.api ?? "openai-completions",
      auth: parsed.auth ?? existing?.auth,
      apiKeyUrl: existing?.apiKeyUrl,
      piProviderSlug: existing?.piProviderSlug,
      catalog: existing?.catalog,
      models,
      modelOverrides,
      reasoningMode: parsed.reasoningMode ?? existing?.reasoningMode,
      apiKeyRef,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp
    });
  }

  async deleteProvider(id: string): Promise<boolean> {
    return this.providers.deleteProvider(id);
  }

  async testProvider(id: string): Promise<void> {
    const provider = await this.providers.getProvider(id);
    if (!provider) {
      throw new Error("模型配置不存在");
    }
    const apiKey = provider.apiKeyRef
      ? await this.secrets.getSecret(provider.apiKeyRef)
      : undefined;
    if (!apiKey) {
      console.warn(`[provider-service] 测试连接失败：缺少 API Key providerId=${id}`);
      throw new Error("请先填写 API Key");
    }
    await this.testProviderFn(provider, apiKey);
  }

  async listModels(id: string): Promise<string[]> {
    const provider = await this.providers.getProvider(id);
    if (!provider) {
      console.warn(`[provider-service] listModels 失败：模型配置不存在 id=${id}`);
      throw new Error("模型配置不存在");
    }
    const apiKey = provider.apiKeyRef
      ? await this.secrets.getSecret(provider.apiKeyRef)
      : undefined;
    if (!apiKey) {
      console.warn(`[provider-service] listModels 失败：缺少 API Key providerId=${id}`);
      throw new Error("请先填写 API Key");
    }
    return this.listModelsFn(provider, apiKey);
  }

  async listModelOptions(id: string): Promise<ProviderModelOption[]> {
    const provider = await this.providers.getProvider(id);
    if (!provider) {
      console.warn(`[provider-service] listModelOptions 失败：模型配置不存在 id=${id}`);
      throw new Error("模型配置不存在");
    }
    const apiKey = provider.apiKeyRef
      ? await this.secrets.getSecret(provider.apiKeyRef)
      : undefined;
    let liveModels: string[] = [];
    if (apiKey) {
      try {
        liveModels = await this.listModelsFn(provider, apiKey);
      } catch (error) {
        console.warn(
          `[provider-service] 拉取在线模型失败，使用静态目录 providerId=${id} error=${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }
    const options = mergeProviderConfigModelOptions(
      provider,
      [...liveModels, ...(provider.models ?? [])],
      provider.model
    );
    console.info(
      `[provider-service] 返回模型选项 providerId=${id} kind=${provider.kind} count=${options.length}`
    );
    return options;
  }
}

function normalizeSelectedModels(
  parsed: ProviderInput,
  existing: ProviderConfig | undefined
): string[] {
  const allowed = selectableModelIds(parsed.kind, existing);
  const submitted =
    parsed.models !== undefined
      ? parsed.models
      : existing?.models ?? defaultEnabledModelIds(parsed.kind, existing);
  const models = uniqueStrings(submitted).filter(
    (modelId) => allowed.size === 0 || allowed.has(modelId)
  );
  if (models.length === 0) {
    console.warn("[provider-service] 保存供应商失败：没有可启用模型", {
      kind: parsed.kind,
      submittedModelCount: submitted.length,
      allowedModelCount: allowed.size
    });
    throw new Error("请至少勾选一个模型");
  }
  return models;
}

function selectableModelIds(
  kind: string,
  existing: ProviderConfig | undefined
): Set<string> {
  const ids = existing
    ? getProviderConfigModelOptions(existing).map((model) => model.id)
    : getCatalogModelOptions(kind).map((model) => model.id);
  return new Set(ids);
}

function defaultEnabledModelIds(
  kind: string,
  existing: ProviderConfig | undefined
): string[] {
  const ids = existing
    ? getProviderConfigDefaultEnabledModelIds(existing)
    : getCatalogDefaultEnabledModelIds(kind);
  return ids.length > 0 ? ids : [existing?.model ?? ""].filter(Boolean);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function filterModelOverrides(
  overrides: ProviderModelOverrides | undefined,
  enabledModels: string[] | undefined
): ProviderModelOverrides | undefined {
  if (!overrides) {
    return undefined;
  }
  const enabled = enabledModels ? new Set(enabledModels) : undefined;
  const next = Object.fromEntries(
    Object.entries(overrides).filter(([modelId]) => !enabled || enabled.has(modelId))
  );
  return Object.keys(next).length > 0 ? next : undefined;
}
