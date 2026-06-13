import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { Message as PiMessage } from "@earendil-works/pi-ai";
import {
  contextCompactThresholdTokens,
  estimateModelCostUsd,
  resolveModelContextInfo,
  resolveModelPricingInfo,
  type ProviderConfig,
  type RunRecord,
  type SessionContextUsage
} from "@chengxiaobang/shared";

// 用户界面按人民币展示；底层模型 usage 仍以 USD 入库。
const USD_TO_CNY_EXCHANGE_RATE = 6.7625;

export interface ContextUsageInput {
  sessionId: string;
  provider: ProviderConfig;
  systemPrompt: string;
  messages: PiMessage[];
  tools: AgentTool<any>[];
  runs?: RunRecord[];
  sessionCostCny?: number;
  compactedUpToMessageId?: string;
}

export function buildSessionContextUsage(input: ContextUsageInput): SessionContextUsage {
  const systemPromptTokens = estimateTextTokens(input.systemPrompt);
  const messageTokens = input.messages.reduce(
    (sum, message) => sum + estimateJsonTokens(message) + 4,
    0
  );
  const toolTokens = input.tools.reduce((sum, tool) => sum + estimateToolTokens(tool), 0);
  const estimatedTokens = systemPromptTokens + messageTokens + toolTokens;
  const context = resolveModelContextInfo(input.provider.kind, input.provider.model);
  const autoCompactThresholdTokens = contextCompactThresholdTokens(context);
  const usedRatio = context.contextWindowTokens
    ? estimatedTokens / context.contextWindowTokens
    : undefined;
  const remainingTokens = context.contextWindowTokens
    ? Math.max(0, context.contextWindowTokens - estimatedTokens)
    : undefined;
  const sessionCostCny = input.runs
    ? estimateSessionCostCny({
        provider: input.provider,
        runs: input.runs,
        estimatedContextTokens: estimatedTokens
      })
    : input.sessionCostCny ?? 0;
  return {
    sessionId: input.sessionId,
    providerId: input.provider.id,
    model: input.provider.model,
    estimatedTokens,
    systemPromptTokens,
    messageTokens,
    toolTokens,
    messageCount: input.messages.length,
    compacted: Boolean(input.compactedUpToMessageId),
    contextWindowTokens: context.contextWindowTokens,
    autoCompactThresholdRatio: context.autoCompactThresholdRatio,
    autoCompactThresholdTokens,
    usedRatio,
    remainingTokens,
    status: contextStatus(estimatedTokens, context.contextWindowTokens, autoCompactThresholdTokens),
    sessionCostCny
  };
}

export function estimateSessionCostCny(input: {
  provider: ProviderConfig;
  runs: RunRecord[];
  estimatedContextTokens: number;
}): number {
  const pricing = resolveModelPricingInfo(input.provider.kind, input.provider.model);
  const hasPricing = hasModelPricing(pricing);
  let costUsd = 0;

  for (const run of input.runs) {
    if (run.usage?.costUsd !== undefined) {
      costUsd += run.usage.costUsd;
      continue;
    }

    if (run.usage) {
      const estimated = estimateUsageCostUsd(pricing, run.usage);
      if (estimated !== undefined) {
        costUsd += estimated;
      }
      continue;
    }

    if (run.status !== "failed" && run.status !== "aborted") {
      continue;
    }
    if (!hasPricing) {
      continue;
    }
    const estimated = estimateModelCostUsd(pricing, {
      inputTokens: input.estimatedContextTokens
    }) ?? 0;
    costUsd += estimated;
  }

  return roundCurrency(costUsd * USD_TO_CNY_EXCHANGE_RATE);
}

function estimateUsageCostUsd(
  pricing: ReturnType<typeof resolveModelPricingInfo>,
  usage: NonNullable<RunRecord["usage"]>
): number | undefined {
  if (!hasModelPricing(pricing)) {
    return undefined;
  }
  const cacheReadTokens = usage.cachedPromptTokens ?? 0;
  return (
    estimateModelCostUsd(pricing, {
      inputTokens: Math.max(0, usage.promptTokens - cacheReadTokens),
      outputTokens: usage.completionTokens,
      cacheReadTokens
    }) ?? 0
  );
}

function hasModelPricing(pricing: ReturnType<typeof resolveModelPricingInfo>): boolean {
  return (
    pricing.inputCostPerMillion !== undefined ||
    pricing.outputCostPerMillion !== undefined ||
    pricing.cacheReadCostPerMillion !== undefined ||
    pricing.cacheWriteCostPerMillion !== undefined
  );
}

function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function shouldAutoCompactContext(usage: SessionContextUsage): boolean {
  return Boolean(
    usage.contextWindowTokens &&
      usage.autoCompactThresholdTokens &&
      usage.estimatedTokens >= usage.autoCompactThresholdTokens
  );
}

export function estimateTextTokens(text: string): number {
  if (text.length === 0) {
    return 0;
  }
  const cjkCount = text.match(/[\u3400-\u9fff\uf900-\ufaff]/gu)?.length ?? 0;
  const nonCjkCount = Math.max(0, text.length - cjkCount);
  return Math.ceil(cjkCount + nonCjkCount / 4);
}

function estimateToolTokens(tool: AgentTool<any>): number {
  return estimateJsonTokens({
    name: tool.name,
    label: tool.label,
    description: tool.description,
    parameters: tool.parameters
  }) + 8;
}

function estimateJsonTokens(value: unknown): number {
  return estimateTextTokens(stableJson(value));
}

function stableJson(value: unknown): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(value, (key, next) => {
    if (typeof next === "function") {
      return undefined;
    }
    if (key === "data" && typeof next === "string" && next.length > 512) {
      return `[image-base64:${next.length}]`;
    }
    if (typeof next !== "object" || next === null) {
      return next;
    }
    if (seen.has(next)) {
      return "[Circular]";
    }
    seen.add(next);
    return next;
  }) ?? "";
}

function contextStatus(
  estimatedTokens: number,
  contextWindowTokens: number | undefined,
  autoCompactThresholdTokens: number | undefined
): SessionContextUsage["status"] {
  if (!contextWindowTokens || !autoCompactThresholdTokens) {
    return "unknown";
  }
  if (estimatedTokens >= autoCompactThresholdTokens) {
    return "over_threshold";
  }
  if (estimatedTokens >= autoCompactThresholdTokens * 0.9) {
    return "near_threshold";
  }
  return "ok";
}
