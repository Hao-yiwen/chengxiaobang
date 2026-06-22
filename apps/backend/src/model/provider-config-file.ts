import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createRequire } from "node:module";
import {
  PROVIDER_CATALOG,
  PROVIDER_CATALOG_SETTINGS,
  nowIso,
  providerAuthSchema,
  providerConfigSchema,
  type ProviderApi,
  type ProviderAuth,
  type ProviderConfig,
  type ProviderRegion
} from "@chengxiaobang/shared";

import { getLogger } from "../logging/logger";

const log = getLogger({ module: "model/provider-config-file" });

type YamlModule = {
  load(source: string): unknown;
  dump(value: unknown, options?: Record<string, unknown>): string;
};

type ProviderConfigDocument = {
  runtimeDefaults?: Record<string, unknown>;
  currency?: Record<string, unknown>;
  providers: Record<string, ProviderConfigRecord>;
};

type ProviderConfigRecord = Record<string, unknown>;

const yaml = createRequire(import.meta.url)("js-yaml") as YamlModule;
const FALLBACK_CREATED_AT = "1970-01-01T00:00:00.000Z";

export class ProviderConfigFileService {
  constructor(private readonly configPath: string) {}

  getConfigPath(): string {
    return this.configPath;
  }

  async initialize(): Promise<void> {
    await mkdir(dirname(this.configPath), { recursive: true });
    if (await pathExists(this.configPath)) {
      log.info("[provider-config-file] 使用已有供应商配置", {
        configPath: this.configPath
      });
      return;
    }
    await this.writeConfig(defaultProviderConfigDocument());
    log.info("[provider-config-file] 已创建默认供应商配置", {
      configPath: this.configPath,
      providerCount: Object.keys(PROVIDER_CATALOG).length
    });
  }

  async listProviders(): Promise<ProviderConfig[]> {
    const document = await this.readConfig();
    return Object.entries(document.providers)
      .map(([id, entry]) => this.mapProvider(id, entry))
      .filter((provider): provider is ProviderConfig => Boolean(provider));
  }

  async getProvider(id: string): Promise<ProviderConfig | undefined> {
    const document = await this.readConfig();
    const entry = document.providers[id];
    return entry ? this.mapProvider(id, entry) : undefined;
  }

  async upsertProvider(provider: ProviderConfig): Promise<ProviderConfig> {
    const document = await this.readConfig();
    const current = document.providers[provider.id] ?? defaultProviderEntry(provider.kind);
    const next: ProviderConfigRecord = {
      ...current,
      kind: provider.kind,
      name: provider.name,
      baseURL: provider.baseURL,
      model: provider.model,
      enabledModels: provider.models,
      apiKeyRef: provider.apiKeyRef,
      createdAt: provider.createdAt,
      updatedAt: provider.updatedAt
    };
    document.providers[provider.id] = compactObject(next);
    await this.writeConfig(document);
    const saved = await this.getProvider(provider.id);
    if (!saved) {
      throw new Error("供应商配置写入失败");
    }
    log.info("[provider-config-file] 已写入供应商配置", {
      configPath: this.configPath,
      providerId: saved.id,
      kind: saved.kind,
      hasApiKeyRef: Boolean(saved.apiKeyRef),
      modelCount: saved.models?.length ?? 0
    });
    return saved;
  }

  async deleteProvider(id: string): Promise<boolean> {
    const document = await this.readConfig();
    const current = document.providers[id];
    if (!current) {
      return false;
    }
    const isBuiltin = defaultProviderEntry(id) !== undefined;
    if (isBuiltin) {
      document.providers[id] = compactObject({
        ...current,
        apiKeyRef: undefined,
        updatedAt: nowIso()
      });
      log.info("[provider-config-file] 已清空内置供应商密钥引用", {
        configPath: this.configPath,
        providerId: id
      });
    } else {
      delete document.providers[id];
      log.info("[provider-config-file] 已删除自定义供应商配置", {
        configPath: this.configPath,
        providerId: id
      });
    }
    await this.writeConfig(document);
    return true;
  }

  private async readConfig(): Promise<ProviderConfigDocument> {
    await this.initializeIfNeeded();
    const raw = await readFile(this.configPath, "utf8");
    const parsed = yaml.load(raw);
    if (!isRecord(parsed) || !isRecord(parsed.providers)) {
      log.warn("[provider-config-file] 配置文件结构无效，已回退为空 providers", {
        configPath: this.configPath
      });
      return { ...defaultProviderConfigDocument(), providers: {} };
    }
    return {
      runtimeDefaults: isRecord(parsed.runtimeDefaults)
        ? { ...parsed.runtimeDefaults }
        : undefined,
      currency: isRecord(parsed.currency) ? { ...parsed.currency } : undefined,
      providers: Object.fromEntries(
        Object.entries(parsed.providers).filter((entry): entry is [string, ProviderConfigRecord] =>
          isRecord(entry[1])
        )
      )
    };
  }

  private async initializeIfNeeded(): Promise<void> {
    if (!(await pathExists(this.configPath))) {
      await this.initialize();
    }
  }

  private async writeConfig(document: ProviderConfigDocument): Promise<void> {
    await mkdir(dirname(this.configPath), { recursive: true });
    const content = yaml.dump(document, {
      lineWidth: 100,
      noRefs: true,
      sortKeys: false
    });
    await writeFile(this.configPath, content, "utf8");
  }

  private mapProvider(id: string, entry: ProviderConfigRecord): ProviderConfig | undefined {
    const kind = optionalString(entry.kind) ?? id;
    const defaultEntry = defaultProviderEntry(kind) ?? defaultProviderEntry(id);
    const models = providerModelIds(entry, defaultEntry);
    const model = optionalString(entry.model) ?? optionalString(entry.defaultModel) ?? models[0];
    if (!model) {
      log.warn("[provider-config-file] 跳过缺少默认模型的供应商", {
        configPath: this.configPath,
        providerId: id,
        kind
      });
      return undefined;
    }
    const now = nowIso();
    const catalog = {
      ...defaultEntry,
      ...entry,
      kind,
      models: providerModelRecords(entry, defaultEntry),
      modelFallbacks: providerFallbackRecords(entry, defaultEntry)
    };
    const rawProvider = {
      id,
      kind,
      name: optionalString(entry.name) ?? optionalString(defaultEntry?.name) ?? id,
      baseURL:
        optionalString(entry.baseURL) ??
        optionalString(entry.defaultBaseURL) ??
        optionalString(defaultEntry?.defaultBaseURL) ??
        "",
      model,
      region: optionalString(entry.region) ?? optionalString(defaultEntry?.region),
      api: optionalString(entry.api) ?? optionalString(defaultEntry?.api) ?? "openai-completions",
      auth: normalizeProviderAuth(entry.auth ?? defaultEntry?.auth),
      apiKeyUrl: optionalString(entry.apiKeyUrl) ?? optionalString(defaultEntry?.apiKeyUrl),
      piProviderSlug:
        optionalString(entry.piProviderSlug) ?? optionalString(defaultEntry?.piProviderSlug),
      models,
      catalog,
      apiKeyRef: optionalString(entry.apiKeyRef),
      createdAt: optionalString(entry.createdAt) ?? FALLBACK_CREATED_AT,
      updatedAt: optionalString(entry.updatedAt) ?? now
    };
    const parsed = providerConfigSchema.safeParse(rawProvider);
    if (!parsed.success) {
      log.warn("[provider-config-file] 解析供应商配置失败，已跳过该项", {
        configPath: this.configPath,
        providerId: id,
        kind,
        error: parsed.error.message
      });
      return undefined;
    }
    return parsed.data;
  }
}

function defaultProviderConfigDocument(): ProviderConfigDocument {
  return {
    runtimeDefaults: { ...PROVIDER_CATALOG_SETTINGS.runtimeDefaults },
    currency: { ...PROVIDER_CATALOG_SETTINGS.currency },
    providers: structuredClone(PROVIDER_CATALOG) as Record<string, ProviderConfigRecord>
  };
}

function defaultProviderEntry(kind: string): ProviderConfigRecord | undefined {
  return (PROVIDER_CATALOG as Record<string, ProviderConfigRecord | undefined>)[kind];
}

function providerModelIds(
  entry: ProviderConfigRecord,
  defaultEntry: ProviderConfigRecord | undefined
): string[] {
  const enabledModels = entry.enabledModels;
  if (Array.isArray(enabledModels)) {
    return uniqueStrings(enabledModels);
  }
  const models = providerModelRecords(entry, defaultEntry);
  const defaultEnabled = models
    .filter((model) => model.enabled !== false)
    .map((model) => optionalString(model.id))
    .filter((id): id is string => Boolean(id));
  if (defaultEnabled.length > 0) {
    return defaultEnabled;
  }
  return models.map((model) => optionalString(model.id)).filter((id): id is string => Boolean(id));
}

function providerModelRecords(
  entry: ProviderConfigRecord,
  defaultEntry: ProviderConfigRecord | undefined
): ProviderConfigRecord[] {
  const models = Array.isArray(entry.models) ? entry.models : defaultEntry?.models;
  return Array.isArray(models) ? models.filter(isRecord) : [];
}

function providerFallbackRecords(
  entry: ProviderConfigRecord,
  defaultEntry: ProviderConfigRecord | undefined
): ProviderConfigRecord[] {
  const fallbacks = Array.isArray(entry.modelFallbacks)
    ? entry.modelFallbacks
    : defaultEntry?.modelFallbacks;
  return Array.isArray(fallbacks) ? fallbacks.filter(isRecord) : [];
}

function normalizeProviderAuth(value: unknown): ProviderAuth {
  const parsed = providerAuthSchema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }
  log.warn("[provider-config-file] 认证配置无效，已回退 Bearer", {
    error: parsed.error.message
  });
  return { type: "bearer" };
}

function uniqueStrings(value: unknown[]): string[] {
  return [...new Set(value.filter((item): item is string => typeof item === "string"))];
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function compactObject<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined)
  ) as T;
}

function isRecord(value: unknown): value is ProviderConfigRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
