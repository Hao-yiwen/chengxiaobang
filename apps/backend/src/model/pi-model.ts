import type { Model, SimpleStreamOptions, ThinkingLevel, Usage } from "@earendil-works/pi-ai";
import {
  resolveProviderModelOption,
  type ProviderConfig,
  type ReasoningMode,
  type TokenUsage
} from "@chengxiaobang/shared";

/**
 * 内置供应商映射到 pi 的 provider slug；pi 会结合 slug/baseUrl 自动识别兼容差异，
 * 比如 DeepSeek 的 reasoning_content、Moonshot 的 max_tokens 行为。
 */
const PROVIDER_SLUGS: Partial<Record<ProviderConfig["kind"], string>> = {
  deepseek: "deepseek",
  kimi: "moonshotai",
  minimax: "minimax",
  qwen: "qwen"
};

/** 将 OpenAI-compatible 供应商配置转换成 pi 模型描述。 */
export function buildModel(provider: ProviderConfig): Model<"openai-completions"> {
  const reasoning = usesPiReasoning(provider);
  return {
    id: provider.model,
    name: provider.name,
    api: "openai-completions",
    provider: PROVIDER_SLUGS[provider.kind] ?? provider.kind,
    baseUrl: trimSlash(provider.baseURL),
    // 只有用户显式选择推理模式时才让 pi 写入推理参数；未选择表示沿用平台默认。
    reasoning,
    ...(reasoning ? { thinkingLevelMap: thinkingLevelMap(provider) } : {}),
    ...(reasoning ? { compat: compatOverride(provider) } : {}),
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 131_072,
    maxTokens: 8192
  };
}

export function buildModelStreamOptions(
  provider: ProviderConfig
): Pick<SimpleStreamOptions, "reasoning" | "onPayload"> {
  const mode = supportedReasoningMode(provider);
  if (!mode) {
    return {};
  }
  if (provider.kind === "kimi") {
    return { onPayload: createKimiPayloadHook(provider, mode) };
  }
  if (provider.kind === "minimax") {
    return { onPayload: createMiniMaxPayloadHook(mode) };
  }
  if (mode === "off") {
    return {};
  }
  const reasoning = toPiThinkingLevel(provider, mode);
  return reasoning ? { reasoning } : {};
}

export function toTokenUsage(usage: Usage): TokenUsage {
  // pi 的 input 已扣除缓存命中；UI 需要展示完整 prompt 大小并单独标出缓存命中。
  return {
    promptTokens: usage.input + usage.cacheRead + usage.cacheWrite,
    completionTokens: usage.output,
    totalTokens: usage.totalTokens,
    ...(usage.cacheRead > 0 ? { cachedPromptTokens: usage.cacheRead } : {})
  };
}

function usesPiReasoning(provider: ProviderConfig): boolean {
  const mode = supportedReasoningMode(provider);
  return Boolean(mode && ["deepseek", "doubao", "qwen"].includes(provider.kind));
}

function supportedReasoningMode(provider: ProviderConfig): ReasoningMode | undefined {
  const mode = provider.reasoningMode;
  if (!mode) {
    return undefined;
  }
  const option = resolveProviderModelOption(provider.kind, provider.model);
  if (!option.reasoningModes.includes(mode)) {
    console.warn(
      `[pi-model] 忽略不支持的推理模式 providerId=${provider.id} kind=${provider.kind} model=${provider.model} reasoningMode=${mode}`
    );
    return undefined;
  }
  return mode;
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

function thinkingLevelMap(provider: ProviderConfig): Model<"openai-completions">["thinkingLevelMap"] {
  if (provider.kind === "deepseek") {
    return { xhigh: "max" };
  }
  return undefined;
}

function compatOverride(provider: ProviderConfig): Model<"openai-completions">["compat"] {
  if (provider.kind === "deepseek" || provider.kind === "doubao") {
    return { thinkingFormat: "deepseek", supportsReasoningEffort: true };
  }
  if (provider.kind === "qwen") {
    return { thinkingFormat: "qwen" };
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
      console.warn(
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
    console.warn(
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
    console.warn(`[pi-model] MiniMax M3 不支持该推理档位 reasoningMode=${mode}`);
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
  const response = await fetch(`${trimSlash(provider.baseURL)}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` }
  });
  if (!response.ok) {
    throw new Error(`连接失败 ${response.status}: ${response.statusText}`);
  }
}

/** 实时读取 provider 的模型列表，不持久化。 */
export async function listProviderModels(
  provider: ProviderConfig,
  apiKey?: string
): Promise<string[]> {
  if (!apiKey) {
    console.warn(`[pi-model] 拉取模型列表失败：缺少 API Key providerId=${provider.id}`);
    throw new Error("请先填写 API Key");
  }
  const response = await fetch(`${trimSlash(provider.baseURL)}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` }
  });
  if (!response.ok) {
    console.warn(
      `[pi-model] 拉取模型列表失败 providerId=${provider.id} status=${response.status} statusText=${response.statusText}`
    );
    throw new Error(`连接失败 ${response.status}: ${response.statusText}`);
  }
  const payload = (await response.json()) as { data?: Array<{ id?: unknown }> };
  const models = (payload.data ?? [])
    .map((item) => item.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  console.info(`[pi-model] 拉取模型列表成功 providerId=${provider.id} count=${models.length}`);
  return models;
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
