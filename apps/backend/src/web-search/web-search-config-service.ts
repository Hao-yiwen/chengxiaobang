import {
  defaultWebSearchConfig,
  nowIso,
  webSearchConfigSchema,
  type WebSearchConfig,
  type WebSearchConfigInput
} from "@chengxiaobang/shared";
import type { StateStore } from "../repository/state-store";
import type { SecretStore } from "../secrets/secret-store";
import { searchTavily } from "./tavily-client";

const SETTINGS_KEY = "web-search";
const SECRET_ACCOUNT = "web-search:tavily";

export interface WebSearchRequest {
  query: string;
  maxResults?: number;
  allowedDomains?: string[];
  blockedDomains?: string[];
  signal?: AbortSignal;
}

export type WebSearchExecutor = (input: WebSearchRequest) => Promise<string>;

/** 管理 Tavily 网络搜索配置；明文 API Key 只进入 SecretStore。 */
export class WebSearchConfigService {
  constructor(
    private readonly store: StateStore,
    private readonly secrets: SecretStore
  ) {}

  async load(): Promise<WebSearchConfig> {
    const raw = await this.store.getSetting(SETTINGS_KEY);
    if (!raw) {
      return defaultWebSearchConfig();
    }
    try {
      return webSearchConfigSchema.parse(JSON.parse(raw));
    } catch (error) {
      console.warn("[web-search-config] 配置解析失败，已回退到默认值", {
        error: error instanceof Error ? error.message : String(error)
      });
      return defaultWebSearchConfig();
    }
  }

  async save(input: WebSearchConfigInput): Promise<WebSearchConfig> {
    const current = await this.load();
    const secret = input.apiKey?.trim();
    const apiKeyRef = secret
      ? await this.secrets.setSecret(SECRET_ACCOUNT, secret)
      : current.apiKeyRef;
    if (input.enabled && !apiKeyRef) {
      throw new Error("请填写 Tavily API Key 后再启用网络搜索");
    }
    const config: WebSearchConfig = {
      enabled: input.enabled,
      ...(apiKeyRef ? { apiKeyRef } : {}),
      updatedAt: nowIso()
    };
    await this.store.setSetting(SETTINGS_KEY, JSON.stringify(config));
    console.info("[web-search-config] 已保存网络搜索配置", {
      enabled: config.enabled,
      hasApiKey: Boolean(config.apiKeyRef)
    });
    return config;
  }

  async createSearcher(): Promise<WebSearchExecutor | undefined> {
    const config = await this.load();
    if (!config.enabled) {
      return undefined;
    }
    const apiKey = await this.getApiKey(config);
    if (!apiKey) {
      console.warn("[web-search-config] 网络搜索已启用但缺少 Tavily API Key，跳过工具注册");
      return undefined;
    }
    return (input) => searchTavily({ ...input, apiKey });
  }

  async test(): Promise<void> {
    const searcher = await this.createSearcher();
    if (!searcher) {
      throw new Error("请先启用网络搜索并保存 Tavily API Key");
    }
    console.info("[web-search-config] 开始测试 Tavily 网络搜索");
    await searcher({ query: "Tavily Search API", maxResults: 1 });
    console.info("[web-search-config] Tavily 网络搜索测试通过");
  }

  async getApiKey(config: WebSearchConfig): Promise<string | undefined> {
    if (!config.apiKeyRef) {
      return undefined;
    }
    return this.secrets.getSecret(config.apiKeyRef);
  }
}
