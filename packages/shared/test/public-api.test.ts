import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

import {
  accessModeSchema,
  activeRunSnapshotSchema,
  connectPhoneInstallPollResultSchema,
  connectPhoneInstallStartInputSchema,
  DEFAULT_CONTEXT_COMPACT_THRESHOLD_RATIO,
  DEFAULT_MAX_TOOL_ITERATIONS,
  defaultFeishuConfig,
  defaultProviders,
  defaultWechatConfig,
  defaultWebSearchConfig,
  contextCompactThresholdTokens,
  estimateProviderModelCostUsd,
  getCatalogDefaultMaxToolIterations,
  getCatalogDefaultAutoCompactThresholdRatio,
  getCatalogModelOptions,
  getCatalogUsdToCnyExchangeRate,
  getProviderApiKeyUrl,
  getProviderKindOptions,
  getProviderPiProviderSlug,
  getProviderPreset,
  mergeProviderModelOptions,
  providerModelOptionSchema,
  providerInputSchema,
  providerKindSchema,
  resolveModelContextInfo,
  resolveModelInputModalities,
  resolveModelPricingInfo,
  resolveProviderModelOption,
  resolveProviderModelMaxToolIterations,
  usageStatsSchema,
  type StreamEvent
} from "../src/index";

const execFileAsync = promisify(execFile);

describe("shared public API", () => {
  const builtinProviderIds = [
    "deepseek",
    "kimi",
    "minimax",
    "doubao",
    "qwen",
    "zhipu",
    "hunyuan",
    "qianfan",
    "xiaomi",
    "openai",
    "anthropic",
    "gemini",
    "openrouter",
    "litellm"
  ];
  const providerKindIds = [...builtinProviderIds, "openai-compatible", "custom"];

  it("keeps the generated provider catalog in sync with YAML", async () => {
    await expect(
      execFileAsync(process.execPath, [
        fileURLToPath(new URL("../scripts/generate-provider-catalog.mjs", import.meta.url)),
        "--check"
      ])
    ).resolves.toMatchObject({
      stderr: ""
    });
  });

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
    expect(defaultProviders(timestamp).map((provider) => provider.id)).toEqual(
      builtinProviderIds
    );
    expect(providerKindSchema.parse("openai-compatible")).toBe("openai-compatible");
    expect(getProviderKindOptions().map((option) => option.value)).toEqual(providerKindIds);
    expect(getProviderKindOptions()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: "deepseek", region: "cn" }),
        expect.objectContaining({ value: "openai", region: "global" }),
        expect.objectContaining({ value: "openrouter", region: "gateway" }),
        expect.objectContaining({ value: "custom", region: "custom" })
      ])
    );
    expect(getProviderPreset("qwen")).toMatchObject({
      name: "千问",
      baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      model: "qwen3.7-max"
    });
    expect(getProviderPreset("gemini")).toMatchObject({
      api: "google-generative-ai",
      model: "gemini-3.5-flash",
      auth: { type: "x-api-key", header: "x-goog-api-key" }
    });
    expect(getProviderApiKeyUrl("kimi")).toBe("https://platform.kimi.ai/console/api-keys");
    expect(getProviderPiProviderSlug("kimi")).toBe("moonshotai");
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
    expect(getCatalogDefaultAutoCompactThresholdRatio()).toBe(
      DEFAULT_CONTEXT_COMPACT_THRESHOLD_RATIO
    );
    expect(getCatalogDefaultMaxToolIterations()).toBe(DEFAULT_MAX_TOOL_ITERATIONS);
    expect(getCatalogUsdToCnyExchangeRate()).toBe(6.7625);
    expect(
      getProviderKindOptions()
        .flatMap((option) => getCatalogModelOptions(option.value))
        .every((model) => model.maxToolIterations === DEFAULT_MAX_TOOL_ITERATIONS)
    ).toBe(true);
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
    expect(defaultWechatConfig()).toEqual({
      enabled: false,
      accountId: ""
    });
    expect(connectPhoneInstallStartInputSchema.parse({ target: "wechat" })).toEqual({
      target: "wechat"
    });
    expect(
      connectPhoneInstallPollResultSchema.parse({
        done: true,
        target: "wechat",
        config: { enabled: true, accountId: "wechat_account" },
        status: { status: "connected", accountId: "wechat_account" }
      }).target
    ).toBe("wechat");
    expect(defaultWebSearchConfig()).toEqual({ enabled: false });
    expect(
      providerInputSchema.parse({
        kind: "custom",
        name: "自定义",
        baseURL: "https://example.com/v1",
        model: "model",
        modelOverrides: { model: { maxToolIterations: 777 } },
        reasoningMode: "high"
      })
    ).toMatchObject({
      kind: "custom",
      modelOverrides: { model: { maxToolIterations: 777 } }
    });
    expect(
      providerInputSchema.parse({
        kind: "gemini",
        name: "Gemini",
        baseURL: "https://generativelanguage.googleapis.com/v1beta",
        model: "gemini-3.5-flash",
        api: "google-generative-ai",
        auth: { type: "x-api-key", header: "x-goog-api-key" }
      }).api
    ).toBe("google-generative-ai");
    expect(
      resolveProviderModelMaxToolIterations({
        kind: "custom",
        model: "model",
        modelOverrides: { model: { maxToolIterations: 777 } }
      })
    ).toBe(777);
    expect(resolveProviderModelMaxToolIterations({ kind: "deepseek", model: "deepseek-v4-flash" })).toBe(
      DEFAULT_MAX_TOOL_ITERATIONS
    );
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
    expect(resolveModelInputModalities("qwen", "qwen3.7-max")).toEqual(["text"]);
    expect(resolveModelInputModalities("kimi", "kimi-k2.6")).toEqual([
      "text",
      "image",
      "video"
    ]);
    expect(resolveModelInputModalities("minimax", "MiniMax-M3")).toContain("image");
    expect(resolveModelInputModalities("doubao", "doubao-seed-2.0-pro")).toContain("image");
    expect(resolveModelInputModalities("qwen", "qwen3.7-plus")).toContain("image");
    expect(resolveModelInputModalities("gemini", "gemini-3.5-flash")).toContain("video");
    expect(resolveModelInputModalities("custom", "unknown-model")).toEqual(["text"]);
    expect(resolveProviderModelOption("qwen", "qwen3.7-max-2026-06-08")).toMatchObject({
      source: "live",
      reasoningModes: ["off", "auto"],
      inputModalities: ["text"],
      contextWindowTokens: 1_000_000,
      pricing: {
        inputCostPerMillion: 1.774,
        outputCostPerMillion: 5.323
      }
    });
    expect(resolveProviderModelOption("openai", "gpt-5.5-pro")).toMatchObject({
      source: "catalog",
      contextWindowTokens: 1_000_000,
      pricing: {
        inputCostPerMillion: 30,
        outputCostPerMillion: 180
      }
    });
    expect(
      contextCompactThresholdTokens({
        autoCompactThresholdTokens: 123_456,
        autoCompactThresholdRatio: 0.8,
        contextWindowTokens: 1_000_000
      })
    ).toBe(123_456);
    expect(resolveProviderModelOption("minimax", "MiniMax-M2.1")).toMatchObject({
      source: "live",
      reasoningModes: [],
      reasoningAlwaysOn: true,
      inputModalities: ["text"],
      maxToolIterations: DEFAULT_MAX_TOOL_ITERATIONS
    });
    expect(
      providerModelOptionSchema.parse({
        id: "legacy-live-model",
        providerKind: "custom",
        reasoningModes: [],
        source: "live"
      })
    ).toMatchObject({
      inputModalities: ["text"],
      maxToolIterations: DEFAULT_MAX_TOOL_ITERATIONS
    });
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
