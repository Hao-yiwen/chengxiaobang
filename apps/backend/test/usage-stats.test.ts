import { describe, expect, it } from "vitest";
import type { UsageStatsSourceRun } from "../src/repository/state-store";
import { buildUsageStatsFromRuns } from "../src/usage/usage-stats";

describe("usage stats", () => {
  it("aggregates daily, weekly, total, fallback, and unknown-price runs", () => {
    const stats = buildUsageStatsFromRuns(
      [
        usageRun({
          id: "run_today",
          createdAt: "2026-06-13T01:00:00.000Z",
          promptTokens: 1_000_000,
          completionTokens: 1_000_000,
          totalTokens: 2_000_000
        }),
        usageRun({
          id: "run_local_today",
          createdAt: "2026-06-12T16:30:00.000Z",
          promptTokens: 1_000,
          completionTokens: 500,
          totalTokens: 1_500
        }),
        usageRun({
          id: "run_fallback",
          createdAt: "2026-06-09T03:00:00.000Z",
          providerKind: undefined,
          model: undefined,
          fallbackProviderKind: "deepseek",
          fallbackModel: "deepseek-v4-pro",
          promptTokens: 2_000,
          completionTokens: 1_000,
          totalTokens: 3_000
        }),
        usageRun({
          id: "run_unknown_price",
          createdAt: "2026-06-13T03:00:00.000Z",
          providerKind: "custom",
          model: "custom-model",
          promptTokens: 5_000,
          completionTokens: 2_000,
          totalTokens: 7_000
        }),
        {
          id: "run_missing_usage",
          sessionId: "session_1",
          status: "completed",
          createdAt: "2026-06-13T04:00:00.000Z",
          providerId: "deepseek",
          providerKind: "deepseek",
          model: "deepseek-v4-flash"
        }
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
    expect(stats.today.totalTokens).toBe(2_008_500);
    expect(stats.week.runCount).toBe(5);
    expect(stats.total.fallbackModelRunCount).toBe(1);
    expect(stats.total.unknownPriceRunCount).toBe(1);
    expect(stats.total.missingUsageRunCount).toBe(1);
    expect(stats.today.costCny).toBeGreaterThanOrEqual(2.84);
    expect(stats.topModels[0]).toMatchObject({
      providerKind: "deepseek",
      model: "deepseek-v4-flash"
    });
  });

  it("uses cache-read pricing instead of full input pricing for cached prompt tokens", () => {
    const stats = buildUsageStatsFromRuns(
      [
        usageRun({
          id: "run_cached",
          createdAt: "2026-06-13T08:00:00.000Z",
          promptTokens: 1_000_000,
          cachedPromptTokens: 800_000,
          completionTokens: 0,
          totalTokens: 1_000_000
        })
      ],
      {
        timezoneOffsetMinutes: -480,
        now: new Date("2026-06-13T12:00:00.000Z")
      }
    );

    expect(stats.today.cachedPromptTokens).toBe(800_000);
    expect(stats.today.costCny).toBeLessThanOrEqual(0.2);
    expect(stats.today.pricedRunCount).toBe(1);
  });
});

function usageRun(
  input: {
    id: string;
    createdAt: string;
    providerKind?: UsageStatsSourceRun["providerKind"];
    model?: string;
    fallbackProviderKind?: UsageStatsSourceRun["fallbackProviderKind"];
    fallbackModel?: string;
    promptTokens: number;
    cachedPromptTokens?: number;
    completionTokens: number;
    totalTokens: number;
  }
): UsageStatsSourceRun {
  return {
    id: input.id,
    sessionId: "session_1",
    status: "completed",
    createdAt: input.createdAt,
    ...("providerKind" in input
      ? input.providerKind
        ? { providerId: input.providerKind, providerKind: input.providerKind }
        : {}
      : { providerId: "deepseek", providerKind: "deepseek" as const }),
    ...("model" in input ? (input.model ? { model: input.model } : {}) : { model: "deepseek-v4-flash" }),
    ...(input.fallbackProviderKind ? { fallbackProviderKind: input.fallbackProviderKind } : {}),
    ...(input.fallbackModel ? { fallbackModel: input.fallbackModel } : {}),
    usage: {
      promptTokens: input.promptTokens,
      completionTokens: input.completionTokens,
      totalTokens: input.totalTokens,
      ...(input.cachedPromptTokens !== undefined
        ? { cachedPromptTokens: input.cachedPromptTokens }
        : {})
    }
  };
}
