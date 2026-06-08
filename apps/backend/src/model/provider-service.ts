import {
  createId,
  nowIso,
  providerInputSchema,
  type ProviderConfig,
  type ProviderInput
} from "@chengxiaobang/shared";
import type { StateStore } from "../repository/state-store";
import type { SecretStore } from "../secrets/secret-store";
import type { ModelClient } from "./openai-compatible";

export class ProviderService {
  constructor(
    private readonly store: StateStore,
    private readonly secrets: SecretStore,
    private readonly modelClient: ModelClient
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

    return this.store.upsertProvider({
      id,
      kind: parsed.kind,
      name: parsed.name,
      baseURL: parsed.baseURL,
      model: parsed.model,
      apiKeyRef,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp
    });
  }

  async testProvider(id: string): Promise<void> {
    const provider = await this.store.getProvider(id);
    if (!provider) {
      throw new Error("模型配置不存在");
    }
    const apiKey = provider.apiKeyRef
      ? await this.secrets.getSecret(provider.apiKeyRef)
      : undefined;
    await this.modelClient.testProvider(provider, apiKey);
  }
}
