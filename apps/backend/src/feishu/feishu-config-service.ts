import {
  defaultFeishuConfig,
  feishuConfigSchema,
  type FeishuConfig,
  type FeishuConfigInput
} from "@chengxiaobang/shared";
import type { StateStore } from "../repository/state-store";
import type { SecretStore } from "../secrets/secret-store";

const SETTINGS_KEY = "feishu";
const SECRET_ACCOUNT = "feishu";

/** Loads/saves the Feishu bot config; the App Secret lives in the secret store. */
export class FeishuConfigService {
  constructor(
    private readonly store: StateStore,
    private readonly secrets: SecretStore
  ) {}

  async load(): Promise<FeishuConfig> {
    const raw = await this.store.getSetting(SETTINGS_KEY);
    if (!raw) {
      return defaultFeishuConfig();
    }
    try {
      return feishuConfigSchema.parse(JSON.parse(raw));
    } catch {
      // A corrupt value must never break backend boot — fall back to defaults.
      return defaultFeishuConfig();
    }
  }

  async save(input: FeishuConfigInput): Promise<FeishuConfig> {
    const current = await this.load();
    const secret = input.appSecret?.trim();
    // An empty secret field means "keep the stored one" (mirrors providers).
    const appSecretRef = secret
      ? await this.secrets.setSecret(SECRET_ACCOUNT, secret)
      : current.appSecretRef;
    const config: FeishuConfig = {
      enabled: input.enabled,
      appId: input.appId.trim(),
      ...(appSecretRef ? { appSecretRef } : {}),
      domain: input.domain,
      fullAccess: input.fullAccess
    };
    await this.store.setSetting(SETTINGS_KEY, JSON.stringify(config));
    return config;
  }

  async getAppSecret(config: FeishuConfig): Promise<string | undefined> {
    if (!config.appSecretRef) {
      return undefined;
    }
    return this.secrets.getSecret(config.appSecretRef);
  }
}
