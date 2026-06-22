import type { Api, Model, SimpleStreamOptions, ThinkingLevel, Usage } from "@earendil-works/pi-ai";
import {
  resolveProviderConfigModelContextInfo,
  resolveProviderConfigModelPricingInfo,
  resolveProviderConfigModelInputModalities,
  resolveProviderConfigModelOption,
  getProviderPiProviderSlug,
  type ProviderConfig,
  type ReasoningMode,
  type TokenUsage
} from "@chengxiaobang/shared";

import { getLogger } from "../logging/logger";

const log = getLogger({ module: "model/pi-model" });

const DEFAULT_MODEL_MAX_RETRIES = 5;

type ModelStreamOptions = Pick<
  SimpleStreamOptions,
  "reasoning" | "onPayload" | "onResponse" | "maxRetries"
>;

/** 将 YAML 供应商配置转换成 pi 模型描述。 */
export function buildModel(provider: ProviderConfig): Model<Api> {
  const api = provider.api ?? "openai-completions";
  const reasoning = usesPiReasoning(provider);
  const context = resolveProviderConfigModelContextInfo(provider, provider.model);
  const pricing = resolveProviderConfigModelPricingInfo(provider, provider.model);
  const inputModalities = resolveProviderConfigModelInputModalities(provider, provider.model);
  const piInputModalities = inputModalities.filter(
    (modality): modality is "text" | "image" => modality === "text" || modality === "image"
  );
  log.info("[pi-model] 构建模型能力", {
    providerId: provider.id,
    kind: provider.kind,
    api,
    model: provider.model,
    inputModalities,
    piInputModalities,
    reasoningMode: effectiveReasoningMode(provider) ?? "default",
    maxRetries: DEFAULT_MODEL_MAX_RETRIES
  });
  return {
    id: provider.model,
    name: provider.name,
    api,
    provider: provider.piProviderSlug ?? getProviderPiProviderSlug(provider.kind) ?? provider.kind,
    baseUrl: trimSlash(provider.baseURL),
    reasoning,
    ...(reasoning ? { thinkingLevelMap: thinkingLevelMap(provider) } : {}),
    ...(reasoning ? { compat: compatOverride(provider) } : {}),
    input: piInputModalities.length > 0 ? piInputModalities : ["text"],
    cost: {
      input: pricing.inputCostPerMillion ?? 0,
      output: pricing.outputCostPerMillion ?? 0,
      cacheRead: pricing.cacheReadCostPerMillion ?? 0,
      cacheWrite: pricing.cacheWriteCostPerMillion ?? 0
    },
    contextWindow: context.contextWindowTokens ?? 131_072,
    maxTokens: 8192
  };
}

export function buildModelStreamOptions(provider: ProviderConfig): ModelStreamOptions {
  const base = { maxRetries: DEFAULT_MODEL_MAX_RETRIES };
  const mode = supportedReasoningMode(provider);
  if (!mode) {
    return base;
  }
  if (provider.kind === "kimi") {
    return { ...base, onPayload: createKimiPayloadHook(provider, mode) };
  }
  if (provider.kind === "minimax") {
    return { ...base, onPayload: createMiniMaxPayloadHook(mode) };
  }
  if (mode === "off") {
    return base;
  }
  const reasoning = toPiThinkingLevel(provider, mode);
  return reasoning ? { ...base, reasoning } : base;
}

export function toTokenUsage(usage: Usage): TokenUsage {
  // pi 的 input 已扣除缓存命中；UI 需要展示完整 prompt 大小并单独标出缓存命中。
  return {
    promptTokens: usage.input + usage.cacheRead + usage.cacheWrite,
    completionTokens: usage.output,
    totalTokens: usage.totalTokens,
    ...(usage.cacheRead > 0 ? { cachedPromptTokens: usage.cacheRead } : {}),
    ...(usage.cost.total > 0 ? { costUsd: usage.cost.total } : {})
  };
}

function usesPiReasoning(provider: ProviderConfig): boolean {
  const mode = supportedReasoningMode(provider);
  if (!mode || mode === "off") {
    return false;
  }
  const api = provider.api ?? "openai-completions";
  if (api === "openai-responses" || api === "anthropic-messages") {
    return true;
  }
  return ["deepseek", "doubao", "qwen", "xiaomi", "openrouter"].includes(provider.kind);
}

function supportedReasoningMode(provider: ProviderConfig): ReasoningMode | undefined {
  const mode = effectiveReasoningMode(provider);
  if (!mode) {
    return undefined;
  }
  const option = resolveProviderConfigModelOption(provider, provider.model);
  if (!option.reasoningModes.includes(mode)) {
    log.warn(
      `[pi-model] 忽略不支持的推理模式 providerId=${provider.id} kind=${provider.kind} model=${provider.model} reasoningMode=${mode}`
    );
    return undefined;
  }
  return mode;
}

function effectiveReasoningMode(provider: ProviderConfig): ReasoningMode | undefined {
  return provider.reasoningMode ?? resolveProviderConfigModelOption(provider, provider.model).defaultReasoningMode;
}

function toPiThinkingLevel(
  provider: ProviderConfig,
  mode: ReasoningMode
): ThinkingLevel | undefined {
  if (mode === "auto") {
    return provider.kind === "qwen" ? "medium" : undefined;
  }
  return mode === "off" ? undefined : mode;
}

function thinkingLevelMap(provider: ProviderConfig): Model<Api>["thinkingLevelMap"] {
  if (provider.kind === "deepseek") {
    return { xhigh: "max" };
  }
  return undefined;
}

function compatOverride(provider: ProviderConfig): Model<Api>["compat"] {
  if (provider.kind === "deepseek" || provider.kind === "doubao") {
    return { thinkingFormat: "deepseek", supportsReasoningEffort: true } as Model<Api>["compat"];
  }
  if (provider.kind === "qwen") {
    return { thinkingFormat: "qwen" } as Model<Api>["compat"];
  }
  if (provider.kind === "xiaomi") {
    return {
      thinkingFormat: "deepseek",
      requiresReasoningContentOnAssistantMessages: true
    } as Model<Api>["compat"];
  }
  return undefined;
}

function createKimiPayloadHook(
  provider: ProviderConfig,
  mode: ReasoningMode
): NonNullable<SimpleStreamOptions["onPayload"]> {
  return (payload) => {
    const normalized = provider.model.toLowerCase();
    if (normalized === "kimi-k2.7-code") {
      log.warn(
        `[pi-model] Kimi K2.7 Code 固定开启推理，已跳过 thinking 参数 providerId=${provider.id}`
      );
      return undefined;
    }
    if (mode === "off") {
      return patchPayload(payload, { thinking: { type: "disabled" } });
    }
    if (mode === "auto") {
      return patchPayload(payload, { thinking: { type: "enabled" } });
    }
    log.warn(
      `[pi-model] Kimi 不支持该推理档位 providerId=${provider.id} model=${provider.model} reasoningMode=${mode}`
    );
    return undefined;
  };
}

function createMiniMaxPayloadHook(
  mode: ReasoningMode
): NonNullable<SimpleStreamOptions["onPayload"]> {
  return (payload) => {
    if (mode === "off") {
      return patchPayload(payload, { thinking: { type: "disabled" } });
    }
    if (mode === "auto") {
      return patchPayload(payload, { thinking: { type: "adaptive" }, reasoning_split: true });
    }
    log.warn(`[pi-model] MiniMax M3 不支持该推理档位 reasoningMode=${mode}`);
    return undefined;
  };
}

function patchPayload(payload: unknown, patch: Record<string, unknown>): unknown {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return undefined;
  }
  return { ...(payload as Record<string, unknown>), ...patch };
}

/** 使用供应商 /models 接口做轻量连通性检查。 */
export async function testProvider(provider: ProviderConfig, apiKey?: string): Promise<void> {
  if (!apiKey) {
    throw new Error("请先填写 API Key");
  }
  const endpoint = providerModelsEndpoint(provider);
  log.info("[pi-model] 开始测试供应商连接", {
    providerId: provider.id,
    kind: provider.kind,
    api: provider.api ?? "openai-completions",
    endpoint
  });
  const response = await fetch(endpoint, {
    headers: providerAuthHeaders(provider, apiKey)
  });
  if (!response.ok) {
    log.warn("[pi-model] 测试供应商连接失败", {
      providerId: provider.id,
      kind: provider.kind,
      api: provider.api ?? "openai-completions",
      status: response.status,
      statusText: response.statusText
    });
    throw new Error(`连接失败 ${response.status}: ${response.statusText}`);
  }
  log.info("[pi-model] 测试供应商连接成功", {
    providerId: provider.id,
    kind: provider.kind,
    api: provider.api ?? "openai-completions"
  });
}

/** 实时读取 provider 的模型列表，不持久化。 */
export async function listProviderModels(
  provider: ProviderConfig,
  apiKey?: string
): Promise<string[]> {
  if (!apiKey) {
    log.warn(`[pi-model] 拉取模型列表失败：缺少 API Key providerId=${provider.id}`);
    throw new Error("请先填写 API Key");
  }
  const endpoint = providerModelsEndpoint(provider);
  log.info("[pi-model] 开始拉取模型列表", {
    providerId: provider.id,
    kind: provider.kind,
    api: provider.api ?? "openai-completions",
    endpoint
  });
  const response = await fetch(endpoint, {
    headers: providerAuthHeaders(provider, apiKey)
  });
  if (!response.ok) {
    log.warn(
      `[pi-model] 拉取模型列表失败 providerId=${provider.id} status=${response.status} statusText=${response.statusText}`
    );
    throw new Error(`连接失败 ${response.status}: ${response.statusText}`);
  }
  const payload = await response.json();
  const models = parseProviderModelList(provider, payload);
  log.info(
    `[pi-model] 拉取模型列表成功 providerId=${provider.id} api=${
      provider.api ?? "openai-completions"
    } count=${models.length}`
  );
  return models;
}

function providerModelsEndpoint(provider: ProviderConfig): string {
  return `${trimSlash(provider.baseURL)}/models`;
}

function parseProviderModelList(provider: ProviderConfig, payload: unknown): string[] {
  if (provider.api === "google-generative-ai") {
    const models = isRecord(payload) && Array.isArray(payload.models) ? payload.models : [];
    return models
      .map((item) => (isRecord(item) ? item.name : undefined))
      .filter((name): name is string => typeof name === "string" && name.length > 0)
      .map((name) => name.replace(/^models\//, ""));
  }

  const data = isRecord(payload) && Array.isArray(payload.data) ? payload.data : [];
  return data
    .map((item) => (isRecord(item) ? item.id : undefined))
    .filter((id): id is string => typeof id === "string" && id.length > 0);
}

function providerAuthHeaders(provider: ProviderConfig, apiKey: string): Record<string, string> {
  const auth = provider.auth ?? { type: "bearer" as const };
  if (auth.type === "anthropic") {
    return {
      [auth.header ?? "x-api-key"]: apiKey,
      [auth.versionHeader ?? "anthropic-version"]: auth.version ?? "2023-06-01"
    };
  }
  if (auth.type === "x-api-key") {
    return { [auth.header ?? "x-api-key"]: apiKey };
  }
  return { [auth.header ?? "Authorization"]: `${auth.prefix ?? "Bearer"} ${apiKey}` };
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
