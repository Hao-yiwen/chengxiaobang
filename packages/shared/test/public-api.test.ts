import { describe, expect, it } from "vitest";

import {
  accessModeSchema,
  defaultFeishuConfig,
  defaultProviders,
  mergeProviderModelOptions,
  providerInputSchema,
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
    expect(defaultFeishuConfig()).toEqual({
      enabled: false,
      appId: "",
      domain: "feishu",
      fullAccess: false
    });
    expect(
      providerInputSchema.parse({
        kind: "custom",
        name: "自定义",
        baseURL: "https://example.com/v1",
        model: "model",
        reasoningMode: "high"
      }).kind
    ).toBe("custom");
    expect(event.type).toBe("delta");
  });
});
