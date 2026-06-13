import { describe, expect, it } from "vitest";

import {
  accessModeSchema,
  activeRunSnapshotSchema,
  defaultFeishuConfig,
  defaultProviders,
  defaultWebSearchConfig,
  contextCompactThresholdTokens,
  estimateProviderModelCostUsd,
  mergeProviderModelOptions,
  providerModelOptionSchema,
  providerInputSchema,
  resolveModelContextInfo,
  resolveModelInputModalities,
  resolveModelPricingInfo,
  usageStatsSchema,
  type StreamEvent
} from "../src/index";

describe("shared public API", () => {
  it("keeps root exports available after module split", () => {
    const timestamp = "2026-06-11T00:00:00.000Z";
    const event: StreamEvent = {
      type: "delta",
      runId: "run_1",
      channel: "text",
      delta: "你好"
    };

    expect(accessModeSchema.parse("approval")).toBe("approval");
    expect(accessModeSchema.parse("smart_approval")).toBe("smart_approval");
    expect(
      activeRunSnapshotSchema.parse({
        run: {
          id: "run_1",
          sessionId: "session_1",
          status: "running",
          createdAt: timestamp,
          updatedAt: timestamp
        },
        toolCalls: []
      }).run.id
    ).toBe("run_1");
    expect(defaultProviders(timestamp).map((provider) => provider.id)).toEqual([
      "deepseek",
      "kimi",
      "minimax",
      "doubao",
      "qwen"
    ]);
    expect(
      mergeProviderModelOptions("deepseek", ["deepseek-v4-pro"], "deepseek-custom").map(
        (model) => model.id
      )
    ).toEqual(["deepseek-v4-flash", "deepseek-v4-pro", "deepseek-custom"]);
    expect(resolveModelContextInfo("kimi", "kimi-k2.6").contextWindowTokens).toBe(262_144);
    expect(
      contextCompactThresholdTokens(resolveModelContextInfo("deepseek", "deepseek-v4-pro"))
    ).toBe(800_000);
    expect(resolveModelPricingInfo("kimi", "kimi-k2.7-code").inputCostPerMillion).toBe(0.95);
    expect(
      estimateProviderModelCostUsd("deepseek", "deepseek-v4-flash", {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000
      })
    ).toBeCloseTo(0.42);
    expect(defaultFeishuConfig()).toEqual({
      enabled: false,
      appId: "",
      domain: "feishu",
      fullAccess: false
    });
    expect(defaultWebSearchConfig()).toEqual({ enabled: false });
    expect(
      providerInputSchema.parse({
        kind: "custom",
        name: "自定义",
        baseURL: "https://example.com/v1",
        model: "model",
        reasoningMode: "high"
      }).kind
    ).toBe("custom");
    expect(
      usageStatsSchema.parse({
        generatedAt: timestamp,
        timezoneOffsetMinutes: -480,
        currency: "CNY",
        today: emptyUsageStatsSummary(),
        week: emptyUsageStatsSummary(),
        total: emptyUsageStatsSummary(),
        dailyBuckets: [],
        weeklyBuckets: [],
        monthlyBuckets: [],
        topModels: [],
        dataQuality: {
          totalRunCount: 0,
          usageRunCount: 0,
          missingUsageRunCount: 0,
          pricedRunCount: 0,
          unknownPriceRunCount: 0,
          fallbackModelRunCount: 0
        }
      }).currency
    ).toBe("CNY");
    expect(event.type).toBe("delta");
  });

  it("resolves builtin model input modalities conservatively", () => {
    expect(resolveModelInputModalities("deepseek", "deepseek-v4-flash")).toEqual(["text"]);
    expect(resolveModelInputModalities("qwen", "qwen3-max")).toEqual(["text"]);
    expect(resolveModelInputModalities("kimi", "kimi-k2.6")).toEqual([
      "text",
      "image",
      "video"
    ]);
    expect(resolveModelInputModalities("minimax", "MiniMax-M3")).toContain("image");
    expect(resolveModelInputModalities("doubao", "doubao-seed-1-6-250615")).toContain("image");
    expect(resolveModelInputModalities("qwen", "qwen3.5-plus")).toContain("image");
    expect(resolveModelInputModalities("custom", "unknown-model")).toEqual(["text"]);
    expect(
      providerModelOptionSchema.parse({
        id: "legacy-live-model",
        providerKind: "custom",
        reasoningModes: [],
        source: "live"
      }).inputModalities
    ).toEqual(["text"]);
  });
});

function emptyUsageStatsSummary() {
  return {
    costCny: 0,
    promptTokens: 0,
    completionTokens: 0,
    cachedPromptTokens: 0,
    totalTokens: 0,
    runCount: 0,
    usageRunCount: 0,
    missingUsageRunCount: 0,
    pricedRunCount: 0,
    unknownPriceRunCount: 0,
    fallbackModelRunCount: 0
  };
}
