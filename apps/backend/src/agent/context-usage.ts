import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { Message as PiMessage } from "@earendil-works/pi-ai";
import {
  contextCompactThresholdTokens,
  resolveProviderConfigModelContextInfo,
  type ProviderConfig,
  type SessionContextUsage
} from "@chengxiaobang/shared";

export interface ContextUsageInput {
  sessionId: string;
  provider: ProviderConfig;
  systemPrompt: string;
  messages: PiMessage[];
  tools: AgentTool<any>[];
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
  const context = resolveProviderConfigModelContextInfo(input.provider, input.provider.model);
  const autoCompactThresholdTokens = contextCompactThresholdTokens(context);
  const usedRatio = context.contextWindowTokens
    ? estimatedTokens / context.contextWindowTokens
    : undefined;
  const remainingTokens = context.contextWindowTokens
    ? Math.max(0, context.contextWindowTokens - estimatedTokens)
    : undefined;
  const sessionCostCny = input.sessionCostCny ?? 0;
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
    status: contextStatus(estimatedTokens, autoCompactThresholdTokens),
    sessionCostCny
  };
}

export function shouldAutoCompactContext(usage: SessionContextUsage): boolean {
  return Boolean(
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
  autoCompactThresholdTokens: number | undefined
): SessionContextUsage["status"] {
  if (!autoCompactThresholdTokens) {
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
