import { describe, expect, it } from "vitest";
import type { UsageCostEntry } from "../src/repository/state-store";
import { buildUsageStatsFromCostEntries } from "../src/usage/usage-stats";

describe("usage stats", () => {
  it("aggregates daily, weekly, total, missing-usage, and unknown-price ledger entries", () => {
    const stats = buildUsageStatsFromCostEntries(
      [
        costEntry({
          runId: "run_today",
          attemptIndex: 0,
          entryCreatedAt: "2026-06-13T01:00:00.000Z",
          promptTokens: 1_000_000,
          completionTokens: 1_000_000,
          totalTokens: 2_000_000,
          costCny: 10
        }),
        costEntry({
          runId: "run_today",
          attemptIndex: 1,
          entryCreatedAt: "2026-06-13T02:00:00.000Z",
          promptTokens: 100,
          completionTokens: 20,
          totalTokens: 120,
          costCny: 0.01
        }),
        costEntry({
          runId: "run_local_today",
          entryCreatedAt: "2026-06-12T16:30:00.000Z",
          promptTokens: 1_000,
          completionTokens: 500,
          totalTokens: 1_500,
          costCny: 0.02
        }),
        costEntry({
          runId: "run_estimated_error",
          entryCreatedAt: "2026-06-09T03:00:00.000Z",
          providerKind: undefined,
          model: undefined,
          promptTokens: 2_000,
          completionTokens: 0,
          totalTokens: 2_000,
          inputEstimatedTokens: 2_000,
          costCny: 0.03,
          costSource: "input_estimate_error",
          tokenCountSource: "js_tiktoken"
        }),
        costEntry({
          runId: "run_unknown_price",
          entryCreatedAt: "2026-06-13T03:00:00.000Z",
          providerKind: "custom",
          model: "custom-model",
          promptTokens: 5_000,
          completionTokens: 2_000,
          totalTokens: 7_000,
          costCny: 0,
          costSource: "unpriced",
          billable: false
        }),
        costEntry({
          runId: "run_non_billable",
          entryCreatedAt: "2026-06-13T04:00:00.000Z",
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          costCny: 0,
          costSource: "non_billable_error",
          tokenCountSource: "fallback_estimate",
          billable: false
        })
      ],
      {
        timezoneOffsetMinutes: -480,
        now: new Date("2026-06-13T12:00:00.000Z")
      }
    );

    expect(stats.dailyBuckets).toHaveLength(371);
    expect(stats.weeklyBuckets).toHaveLength(52);
    expect(stats.monthlyBuckets).toHaveLength(12);
    expect(stats.today.runCount).toBe(4);
    expect(stats.today.totalTokens).toBe(2_008_620);
    expect(stats.week.runCount).toBe(5);
    expect(stats.total.runCount).toBe(5);
    expect(stats.total.fallbackModelRunCount).toBe(1);
    expect(stats.total.unknownPriceRunCount).toBe(1);
    expect(stats.total.missingUsageRunCount).toBe(2);
    expect(stats.total.pricedRunCount).toBe(3);
    expect(stats.today.costCny).toBe(10.03);
    expect(stats.topModels[0]).toMatchObject({
      providerKind: "deepseek",
      model: "deepseek-v4-flash",
      runCount: 3
    });
  });

  it("preserves cached prompt tokens and ledger-provided cost without repricing", () => {
    const stats = buildUsageStatsFromCostEntries(
      [
        costEntry({
          runId: "run_cached",
          entryCreatedAt: "2026-06-13T08:00:00.000Z",
          promptTokens: 1_000_000,
          cachedPromptTokens: 800_000,
          completionTokens: 0,
          totalTokens: 1_000_000,
          costCny: 0.12
        })
      ],
      {
        timezoneOffsetMinutes: -480,
        now: new Date("2026-06-13T12:00:00.000Z")
      }
    );

    expect(stats.today.cachedPromptTokens).toBe(800_000);
    expect(stats.today.costCny).toBe(0.12);
    expect(stats.today.pricedRunCount).toBe(1);
  });
});

function costEntry(
  input: {
    runId: string;
    attemptIndex?: number;
    entryCreatedAt: string;
    providerKind?: UsageCostEntry["providerKind"] | undefined;
    model?: string | undefined;
    promptTokens: number;
    cachedPromptTokens?: number;
    completionTokens: number;
    totalTokens: number;
    inputEstimatedTokens?: number;
    costCny: number;
    costSource?: UsageCostEntry["costSource"];
    tokenCountSource?: UsageCostEntry["tokenCountSource"];
    billable?: boolean;
  }
): UsageCostEntry {
  const hasProviderKind = !("providerKind" in input) || input.providerKind !== undefined;
  const hasModel = !("model" in input) || input.model !== undefined;
  const providerKind = hasProviderKind ? (input.providerKind ?? "deepseek") : undefined;
  const model = hasModel ? (input.model ?? "deepseek-v4-flash") : undefined;
  const attemptIndex = input.attemptIndex ?? 0;
  return {
    id: `usage_cost_${input.runId}_${attemptIndex}`,
    runId: input.runId,
    sessionId: "session_1",
    attemptIndex,
    ...(providerKind ? { providerId: providerKind, providerKind } : {}),
    ...(model ? { model } : {}),
    promptTokens: input.promptTokens,
    completionTokens: input.completionTokens,
    cachedPromptTokens: input.cachedPromptTokens ?? 0,
    totalTokens: input.totalTokens,
    inputEstimatedTokens: input.inputEstimatedTokens ?? input.promptTokens,
    costUsd: input.costCny / 7,
    costCny: input.costCny,
    costSource: input.costSource ?? "catalog_usage",
    tokenCountSource: input.tokenCountSource ?? "provider_usage",
    billable: input.billable ?? true,
    entryCreatedAt: input.entryCreatedAt,
    recordedAt: input.entryCreatedAt
  };
}
