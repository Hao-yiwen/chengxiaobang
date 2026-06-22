import {
  estimateProviderConfigModelCostUsd,
  estimateProviderModelCostUsd,
  getCatalogUsdToCnyExchangeRate,
  nowIso,
  type ProviderConfig,
  type ProviderKind,
  type TokenUsage,
  type UsageStats
} from "@chengxiaobang/shared";
import type {
  StateStore,
  UpsertUsageCostEntryInput,
  UsageCostEntry,
  UsageCostSource,
  UsageTokenCountSource
} from "../repository/state-store";
import { classifyUsageCostError } from "./usage-cost-errors";
import {
  TokenAccountingService,
  type ModelInputSnapshot,
  type TokenCountResult
} from "./token-accounting";
import { buildUsageStatsFromCostEntries } from "./usage-stats";

import { getLogger } from "../logging/logger";

const log = getLogger({ module: "usage/usage-cost-ledger" });

export interface UsageCostAttempt {
  runId: string;
  sessionId: string;
  attemptIndex: number;
  providerId?: string;
  providerKind?: ProviderKind;
  model?: string;
  provider?: ProviderConfig;
  inputEstimatedTokens: number;
  tokenCountSource: UsageTokenCountSource;
  entryCreatedAt: string;
  receivedResponse: boolean;
  statusCode?: number;
}

export interface UsageCostResponseMeta {
  statusCode?: number;
  receivedResponse?: boolean;
}

export interface UsageTokenCounter {
  countInputTokens(input: ModelInputSnapshot): TokenCountResult;
}

export class UsageCostLedgerService {
  constructor(
    private readonly store: StateStore,
    private readonly tokenAccounting: UsageTokenCounter = new TokenAccountingService()
  ) {}

  async startAttempt(input: {
    runId: string;
    sessionId: string;
    attemptIndex: number;
    provider: ProviderConfig;
    inputSnapshot: ModelInputSnapshot;
  }): Promise<UsageCostAttempt> {
    const tokenCount = this.tokenAccounting.countInputTokens(input.inputSnapshot);
    const attempt: UsageCostAttempt = {
      runId: input.runId,
      sessionId: input.sessionId,
      attemptIndex: input.attemptIndex,
      providerId: input.provider.id,
      providerKind: input.provider.kind,
      model: input.provider.model,
      provider: input.provider,
      inputEstimatedTokens: tokenCount.tokens,
      tokenCountSource: tokenCount.source,
      entryCreatedAt: nowIso(),
      receivedResponse: false
    };
    await this.store.upsertUsageCostEntry({
      ...attemptBaseEntry(attempt),
      costSource: "pending",
      tokenCountSource: attempt.tokenCountSource,
      billable: false
    });
    log.debug("[usage-cost-ledger] 已创建模型请求费用 attempt", {
      runId: attempt.runId,
      sessionId: attempt.sessionId,
      attemptIndex: attempt.attemptIndex,
      providerId: attempt.providerId,
      model: attempt.model,
      inputEstimatedTokens: attempt.inputEstimatedTokens,
      tokenCountSource: attempt.tokenCountSource
    });
    return attempt;
  }

  recordResponse(attempt: UsageCostAttempt, meta: UsageCostResponseMeta): void {
    attempt.receivedResponse = meta.receivedResponse ?? true;
    if (meta.statusCode !== undefined) {
      attempt.statusCode = meta.statusCode;
    }
  }

  async finishAttemptWithUsage(input: {
    attempt: UsageCostAttempt;
    usage: TokenUsage;
    responseMeta?: UsageCostResponseMeta;
  }): Promise<UsageCostEntry> {
    if (input.responseMeta) {
      this.recordResponse(input.attempt, input.responseMeta);
    }
    const priced = priceUsage(input.attempt, input.usage);
    const costSource: UsageCostSource =
      input.usage.costUsd !== undefined
        ? "reported_usage"
        : priced.costUsd !== undefined
          ? "catalog_usage"
          : "unpriced";
    const costUsd = input.usage.costUsd ?? priced.costUsd ?? 0;
    const entry = await this.store.upsertUsageCostEntry({
      ...attemptBaseEntry(input.attempt),
      statusCode: input.attempt.statusCode,
      promptTokens: input.usage.promptTokens,
      completionTokens: input.usage.completionTokens,
      cachedPromptTokens: input.usage.cachedPromptTokens ?? 0,
      totalTokens: input.usage.totalTokens,
      inputEstimatedTokens: input.attempt.inputEstimatedTokens,
      costUsd,
      costCny: toCny(costUsd),
      costSource,
      tokenCountSource: "provider_usage",
      billable: costSource !== "unpriced"
    });
    log.info("[usage-cost-ledger] 已按上游 usage 写入费用", {
      runId: entry.runId,
      sessionId: entry.sessionId,
      attemptIndex: entry.attemptIndex,
      costSource: entry.costSource,
      statusCode: entry.statusCode,
      promptTokens: entry.promptTokens,
      completionTokens: entry.completionTokens,
      costCny: entry.costCny
    });
    return entry;
  }

  async finishAttemptWithError(input: {
    attempt: UsageCostAttempt;
    stopReason: "error" | "aborted";
    errorMessage?: string;
    responseMeta?: UsageCostResponseMeta;
    signalAborted?: boolean;
  }): Promise<UsageCostEntry> {
    if (input.responseMeta) {
      this.recordResponse(input.attempt, input.responseMeta);
    }
    const classification = classifyUsageCostError({
      stopReason: input.stopReason,
      errorMessage: input.errorMessage,
      statusCode: input.attempt.statusCode,
      signalAborted: input.signalAborted,
      receivedResponse: input.attempt.receivedResponse
    });
    const costUsd = classification.billable
      ? estimateInputCostUsd(input.attempt) ?? 0
      : 0;
    const costSource =
      classification.billable && costUsd === 0
        ? ("unpriced" as const)
        : classification.costSource;
    const entry = await this.store.upsertUsageCostEntry({
      ...attemptBaseEntry(input.attempt),
      statusCode: classification.statusCode,
      errorCode: classification.reasonCode,
      errorMessage: trimError(input.errorMessage),
      promptTokens: classification.billable ? input.attempt.inputEstimatedTokens : 0,
      totalTokens: classification.billable ? input.attempt.inputEstimatedTokens : 0,
      inputEstimatedTokens: input.attempt.inputEstimatedTokens,
      costUsd,
      costCny: toCny(costUsd),
      costSource,
      tokenCountSource: input.attempt.tokenCountSource,
      billable: classification.billable && costSource !== "unpriced"
    });
    log.info("[usage-cost-ledger] 已按错误分类写入费用", {
      runId: entry.runId,
      sessionId: entry.sessionId,
      attemptIndex: entry.attemptIndex,
      stopReason: input.stopReason,
      statusCode: entry.statusCode,
      reasonCode: entry.errorCode,
      billable: entry.billable,
      inputEstimatedTokens: entry.inputEstimatedTokens,
      costCny: entry.costCny
    });
    return entry;
  }

  async getSessionCostCny(sessionId: string): Promise<number> {
    return this.store.getSessionUsageCostCny(sessionId);
  }

  async buildUsageStats(options: {
    timezoneOffsetMinutes: number;
    now?: Date;
  }): Promise<UsageStats> {
    const entries = await this.store.listUsageCostEntries({ finalizedOnly: true });
    log.info("[usage-cost-ledger] 开始从费用账本聚合全局统计", {
      entryCount: entries.length,
      timezoneOffsetMinutes: options.timezoneOffsetMinutes
    });
    return buildUsageStatsFromCostEntries(entries, options);
  }
}

function attemptBaseEntry(attempt: UsageCostAttempt): Omit<
  UpsertUsageCostEntryInput,
  | "costSource"
  | "tokenCountSource"
  | "billable"
> {
  return {
    runId: attempt.runId,
    sessionId: attempt.sessionId,
    attemptIndex: attempt.attemptIndex,
    providerId: attempt.providerId,
    providerKind: attempt.providerKind,
    model: attempt.model,
    statusCode: attempt.statusCode,
    promptTokens: 0,
    completionTokens: 0,
    cachedPromptTokens: 0,
    totalTokens: 0,
    inputEstimatedTokens: attempt.inputEstimatedTokens,
    costUsd: 0,
    costCny: 0,
    entryCreatedAt: attempt.entryCreatedAt
  };
}

function priceUsage(
  attempt: UsageCostAttempt,
  usage: TokenUsage
): { costUsd?: number } {
  if (!attempt.providerKind || !attempt.model) {
    return {};
  }
  const cachedPromptTokens = usage.cachedPromptTokens ?? 0;
  const costUsage = {
    inputTokens: Math.max(0, usage.promptTokens - cachedPromptTokens),
    outputTokens: usage.completionTokens,
    cacheReadTokens: cachedPromptTokens
  };
  const costUsd = attempt.provider
    ? estimateProviderConfigModelCostUsd(attempt.provider, costUsage, attempt.model)
    : estimateProviderModelCostUsd(attempt.providerKind, attempt.model, costUsage);
  return costUsd === undefined ? {} : { costUsd };
}

function estimateInputCostUsd(attempt: UsageCostAttempt): number | undefined {
  if (!attempt.providerKind || !attempt.model) {
    return undefined;
  }
  const costUsage = {
    inputTokens: attempt.inputEstimatedTokens
  };
  return attempt.provider
    ? estimateProviderConfigModelCostUsd(attempt.provider, costUsage, attempt.model)
    : estimateProviderModelCostUsd(attempt.providerKind, attempt.model, costUsage);
}

function toCny(costUsd: number): number {
  return roundCurrency(costUsd * getCatalogUsdToCnyExchangeRate());
}

function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function trimError(error: string | undefined): string | undefined {
  if (!error) {
    return undefined;
  }
  return error.length > 500 ? `${error.slice(0, 500)}...` : error;
}
