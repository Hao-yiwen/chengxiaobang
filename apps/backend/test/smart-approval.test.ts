import { describe, expect, it } from "vitest";
import { nowIso, type ProviderConfig } from "@chengxiaobang/shared";
import { buildSmartApprovalProvider } from "../src/agent/smart-approval";

function provider(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  const timestamp = nowIso();
  return {
    id: "deepseek",
    kind: "deepseek",
    name: "DeepSeek",
    baseURL: "https://api.deepseek.com",
    model: "deepseek-v4-pro",
    reasoningMode: "xhigh",
    apiKeyRef: "memory:deepseek",
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides
  };
}

describe("smart approval fast provider", () => {
  it("uses the faster DeepSeek flash model and disables reasoning", () => {
    const approvalProvider = buildSmartApprovalProvider(provider());

    expect(approvalProvider).toMatchObject({
      model: "deepseek-v4-flash",
      reasoningMode: "off"
    });
  });

  it("respects the provider enabled model list while still disabling reasoning", () => {
    const approvalProvider = buildSmartApprovalProvider(
      provider({
        id: "qwen",
        kind: "qwen",
        name: "千问",
        baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        model: "qwen-plus",
        models: ["qwen-plus"],
        reasoningMode: "auto"
      })
    );

    expect(approvalProvider).toMatchObject({
      model: "qwen-plus",
      reasoningMode: "off"
    });
  });

  it("moves away from always-on reasoning catalog models when a controllable sibling exists", () => {
    const approvalProvider = buildSmartApprovalProvider(
      provider({
        id: "kimi",
        kind: "kimi",
        name: "Kimi",
        baseURL: "https://api.moonshot.ai/v1",
        model: "kimi-k2.7-code"
      })
    );

    expect(approvalProvider).toMatchObject({
      model: "kimi-k2.5",
      reasoningMode: "off"
    });
  });

  it("drops unsupported reasoning modes for custom compatible models", () => {
    const approvalProvider = buildSmartApprovalProvider(
      provider({
        id: "custom",
        kind: "openai-compatible",
        name: "Custom",
        baseURL: "https://example.com/v1",
        model: "custom-fast",
        reasoningMode: "high"
      })
    );

    expect(approvalProvider.model).toBe("custom-fast");
    expect(approvalProvider).not.toHaveProperty("reasoningMode");
  });
});
