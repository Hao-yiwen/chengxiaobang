import {
  createId,
  mergeProviderModelOptions,
  nowIso,
  providerInputSchema,
  type ProviderConfig,
  type ProviderModelOption,
  type ProviderInput
} from "@chengxiaobang/shared";
import type { StateStore } from "../repository/state-store";
import type { SecretStore } from "../secrets/secret-store";
import { listProviderModels, testProvider } from "./pi-model";

type TestProviderFn = (provider: ProviderConfig, apiKey?: string) => Promise<void>;
type ListModelsFn = (provider: ProviderConfig, apiKey?: string) => Promise<string[]>;

export class ProviderService {
  constructor(
    private readonly store: StateStore,
    private readonly secrets: SecretStore,
    private readonly testProviderFn: TestProviderFn = testProvider,
    private readonly listModelsFn: ListModelsFn = listProviderModels
  ) {}

  async listProviders(): Promise<ProviderConfig[]> {
    return this.store.listProviders();
  }

  async saveProvider(input: ProviderInput): Promise<ProviderConfig> {
    const parsed = providerInputSchema.parse(input);
    const existing = parsed.id ? await this.store.getProvider(parsed.id) : undefined;
    const timestamp = nowIso();
    const id = parsed.id ?? createId("provider");
    const apiKeyRef =
      parsed.apiKey && parsed.apiKey.length > 0
        ? await this.secrets.setSecret(id, parsed.apiKey)
        : existing?.apiKeyRef;
    // 没有新密钥也没有已存密钥的配置无法发起任何请求，直接拒绝保存。
    if (!apiKeyRef) {
      console.warn(`[provider-service] 保存被拒：缺少 API Key id=${id} kind=${parsed.kind}`);
      throw new Error("请填写 API Key");
    }
    // 启用模型去重；默认模型必须在启用列表内，不在则回退到列表第一个。
    const models =
      parsed.models && parsed.models.length > 0 ? [...new Set(parsed.models)] : undefined;
    const model = models && !models.includes(parsed.model) ? models[0] : parsed.model;

    console.info(
      `[provider-service] 保存供应商 id=${id} kind=${parsed.kind} models=${models?.length ?? "默认"}`
    );
    return this.store.upsertProvider({
      id,
      kind: parsed.kind,
      name: parsed.name,
      baseURL: parsed.baseURL,
      model,
      models,
      reasoningMode: parsed.reasoningMode,
      apiKeyRef,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp
    });
  }

  async deleteProvider(id: string): Promise<boolean> {
    return this.store.deleteProvider(id);
  }

  async testProvider(id: string): Promise<void> {
    const provider = await this.store.getProvider(id);
    if (!provider) {
      throw new Error("模型配置不存在");
    }
    const apiKey = provider.apiKeyRef
      ? await this.secrets.getSecret(provider.apiKeyRef)
      : undefined;
    await this.testProviderFn(provider, apiKey);
  }

  async listModels(id: string): Promise<string[]> {
    const provider = await this.store.getProvider(id);
    if (!provider) {
      console.warn(`[provider-service] listModels 失败：模型配置不存在 id=${id}`);
      throw new Error("模型配置不存在");
    }
    const apiKey = provider.apiKeyRef
      ? await this.secrets.getSecret(provider.apiKeyRef)
      : undefined;
    return this.listModelsFn(provider, apiKey);
  }

  async listModelOptions(id: string): Promise<ProviderModelOption[]> {
    const provider = await this.store.getProvider(id);
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
    const options = mergeProviderModelOptions(
      provider.kind,
      [...liveModels, ...(provider.models ?? [])],
      provider.model
    );
    console.info(
      `[provider-service] 返回模型选项 providerId=${id} kind=${provider.kind} count=${options.length}`
    );
    return options;
  }
}
