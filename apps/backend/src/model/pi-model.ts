import type { Model, Usage } from "@earendil-works/pi-ai";
import type { ProviderConfig, TokenUsage } from "@chengxiaobang/shared";

/**
 * pi provider slugs for the builtin kinds. pi auto-detects wire compat
 * (DeepSeek reasoning_content, Moonshot max_tokens, …) from this slug or the
 * baseUrl, so user-configured endpoints keep working without manual compat.
 */
const PROVIDER_SLUGS: Partial<Record<ProviderConfig["kind"], string>> = {
  deepseek: "deepseek",
  kimi: "moonshotai",
  minimax: "minimax"
};

/** Build the pi model description for an OpenAI-compatible provider config. */
export function buildModel(provider: ProviderConfig): Model<"openai-completions"> {
  return {
    id: provider.model,
    name: provider.name,
    api: "openai-completions",
    provider: PROVIDER_SLUGS[provider.kind] ?? provider.kind,
    baseUrl: trimSlash(provider.baseURL),
    // Thinking request params stay off (matching the previous client); pi still
    // surfaces reasoning_content deltas the provider sends on its own.
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 131_072,
    maxTokens: 8192
  };
}

export function toTokenUsage(usage: Usage): TokenUsage {
  // pi reports `input` net of cache hits; the UI expects the full prompt size
  // (matching providers' prompt_tokens) with the cached share called out.
  return {
    promptTokens: usage.input + usage.cacheRead + usage.cacheWrite,
    completionTokens: usage.output,
    totalTokens: usage.totalTokens,
    ...(usage.cacheRead > 0 ? { cachedPromptTokens: usage.cacheRead } : {})
  };
}

/** Cheap connectivity probe against the provider's /models listing. */
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

function trimSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
