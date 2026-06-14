import { z } from "zod";

import { modelRuntimeOverrideSchema, reasoningModeSchema } from "./model";
import { PROVIDER_CATALOG, PROVIDER_KINDS } from "./provider-catalog.generated";
import { nowIso } from "./utils";

export const providerKindSchema = z.string().min(1);
export type ProviderKind = z.infer<typeof providerKindSchema>;

export type KnownProviderKind = (typeof PROVIDER_KINDS)[number];
export type ProviderCatalogEntry = (typeof PROVIDER_CATALOG)[KnownProviderKind];

export const providerRegionSchema = z.enum(["cn", "global", "gateway", "custom"]);
export type ProviderRegion = z.infer<typeof providerRegionSchema>;

export const providerApiSchema = z.enum([
  "openai-completions",
  "openai-responses",
  "anthropic-messages",
  "google-generative-ai"
]);
export type ProviderApi = z.infer<typeof providerApiSchema>;

export const providerAuthSchema = z
  .object({
    type: z.enum(["bearer", "x-api-key", "anthropic"]).default("bearer"),
    header: z.string().min(1).optional(),
    prefix: z.string().optional(),
    versionHeader: z.string().min(1).optional(),
    version: z.string().min(1).optional()
  })
  .default({ type: "bearer" });
export type ProviderAuth = z.infer<typeof providerAuthSchema>;

const providerCatalogPayloadSchema = z.record(z.string(), z.unknown());

export const providerModelOverridesSchema = z.record(
  z.string().min(1),
  modelRuntimeOverrideSchema
);
export type ProviderModelOverrides = z.infer<typeof providerModelOverridesSchema>;

export const providerConfigSchema = z.object({
  id: z.string().min(1),
  kind: providerKindSchema,
  name: z.string().min(1),
  baseURL: z.string().url(),
  model: z.string().min(1),
  region: providerRegionSchema.optional(),
  api: providerApiSchema.optional(),
  auth: providerAuthSchema.optional(),
  apiKeyUrl: z.string().url().optional(),
  piProviderSlug: z.string().min(1).optional(),
  /** 该供应商启用的模型列表（共用同一个 API Key）；缺省表示不限制。 */
  models: z.array(z.string().min(1)).optional(),
  /** 运行时 YAML 中的完整供应商目录片段；前后端用它解析模型能力。 */
  catalog: providerCatalogPayloadSchema.optional(),
  /** 按模型 ID 覆盖的运行参数；缺省时使用模型目录默认值。 */
  modelOverrides: providerModelOverridesSchema.optional(),
  reasoningMode: reasoningModeSchema.optional(),
  apiKeyRef: z.string().min(1).optional(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type ProviderConfig = z.infer<typeof providerConfigSchema>;

export const providerInputSchema = z.object({
  id: z.string().min(1).optional(),
  kind: providerKindSchema,
  name: z.string().min(1),
  baseURL: z.string().url(),
  model: z.string().min(1),
  region: providerRegionSchema.optional(),
  api: providerApiSchema.optional(),
  auth: providerAuthSchema.optional(),
  models: z.array(z.string().min(1)).optional(),
  modelOverrides: providerModelOverridesSchema.optional(),
  reasoningMode: reasoningModeSchema.optional(),
  apiKey: z.string().optional()
});
export type ProviderInput = z.infer<typeof providerInputSchema>;

export type ProviderPreset = Omit<ProviderInput, "apiKey">;
export type ProviderKindOption = {
  value: ProviderKind;
  label: string;
  region?: ProviderRegion;
  api?: ProviderApi;
};

const PROVIDER_CATALOG_RECORD = PROVIDER_CATALOG as Record<
  KnownProviderKind,
  ProviderCatalogEntry
>;

export function getProviderCatalogEntry(kind: ProviderKind): ProviderCatalogEntry | undefined {
  return (PROVIDER_CATALOG as Record<string, ProviderCatalogEntry | undefined>)[kind];
}

export function getProviderCatalogEntries(): ProviderCatalogEntry[] {
  return PROVIDER_KINDS.map((kind) => PROVIDER_CATALOG_RECORD[kind]);
}

export function getCatalogProviderKinds(): ProviderKind[] {
  return getProviderCatalogEntries()
    .filter((provider) => provider.models.length > 0)
    .map((provider) => provider.kind);
}

export function getProviderPreset(kind: ProviderKind): ProviderPreset {
  const provider = getProviderCatalogEntry(kind);
  if (!provider) {
    throw new Error(`未知供应商类型: ${kind}`);
  }
  return {
    kind: provider.kind,
    name: provider.name,
    baseURL: provider.defaultBaseURL,
    model: provider.defaultModel,
    region: optionalProviderString(provider, "region") as ProviderRegion | undefined,
    api: (optionalProviderString(provider, "api") as ProviderApi | undefined) ?? "openai-completions",
    auth: providerAuthSchema.parse((provider as Record<string, unknown>).auth ?? undefined),
    models: defaultEnabledModelIds(provider)
  };
}

export function getProviderPresets(): Record<string, ProviderPreset> {
  return Object.fromEntries(
    PROVIDER_KINDS.map((kind) => [kind, getProviderPreset(kind)])
  ) as Record<string, ProviderPreset>;
}

export function getProviderKindOptions(): ProviderKindOption[] {
  return getProviderCatalogEntries().map((provider) => ({
    value: provider.kind,
    label: provider.label,
    region: optionalProviderString(provider, "region") as ProviderRegion | undefined,
    api: optionalProviderString(provider, "api") as ProviderApi | undefined
  }));
}

export function getProviderApiKeyUrl(kind: ProviderKind): string | undefined {
  const provider = getProviderCatalogEntry(kind);
  return provider ? optionalProviderString(provider, "apiKeyUrl") : undefined;
}

export function getProviderApiKeyUrls(): Partial<Record<string, string>> {
  return Object.fromEntries(
    getProviderCatalogEntries()
      .map(
        (provider) =>
          [provider.kind, optionalProviderString(provider, "apiKeyUrl")] as [string, string | undefined]
      )
      .filter((entry): entry is [string, string] => typeof entry[1] === "string")
  );
}

export function getProviderPiProviderSlug(kind: ProviderKind): string | undefined {
  const provider = getProviderCatalogEntry(kind);
  return provider ? optionalProviderString(provider, "piProviderSlug") : undefined;
}

export function defaultProviders(timestamp = nowIso()): ProviderConfig[] {
  return getProviderCatalogEntries()
    .filter((provider) => provider.builtinDefault === true)
    .map((provider) => ({
      id: provider.kind,
      kind: provider.kind,
      name: provider.name,
      baseURL: provider.defaultBaseURL,
      model: provider.defaultModel,
      region: optionalProviderString(provider, "region") as ProviderRegion | undefined,
      api: (optionalProviderString(provider, "api") as ProviderApi | undefined) ?? "openai-completions",
      auth: providerAuthSchema.parse((provider as Record<string, unknown>).auth ?? undefined),
      apiKeyUrl: optionalProviderString(provider, "apiKeyUrl"),
      piProviderSlug: optionalProviderString(provider, "piProviderSlug"),
      models: defaultEnabledModelIds(provider),
      createdAt: timestamp,
      updatedAt: timestamp
    }));
}

function defaultEnabledModelIds(provider: ProviderCatalogEntry): string[] {
  const models = Array.isArray(provider.models) ? provider.models : [];
  return models
    .filter((model) => isRecord(model) && model.enabled !== false)
    .map((model) => optionalProviderString(model, "id"))
    .filter((id): id is string => Boolean(id));
}

function optionalProviderString(provider: Record<string, unknown>, key: string): string | undefined {
  const value = (provider as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
