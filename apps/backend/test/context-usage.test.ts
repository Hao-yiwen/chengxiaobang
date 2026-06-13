import { describe, expect, it } from "vitest";
import type { ProviderConfig } from "@chengxiaobang/shared";
import {
  buildSessionContextUsage,
  estimateTextTokens,
  estimateSessionCostCny,
  shouldAutoCompactContext
} from "../src/agent/context-usage";

const provider: ProviderConfig = {
  id: "deepseek",
  kind: "deepseek",
  name: "DeepSeek",
  baseURL: "https://api.deepseek.com",
  model: "deepseek-v4-flash",
  createdAt: "2026-06-13T00:00:00.000Z",
  updatedAt: "2026-06-13T00:00:00.000Z"
};

describe("context usage", () => {
  it("estimates CJK text conservatively", () => {
    expect(estimateTextTokens("你好世界")).toBe(4);
    expect(estimateTextTokens("hello world")).toBe(3);
  });

  it("builds a usage report with the model window and threshold", () => {
    const usage = buildSessionContextUsage({
      sessionId: "session_1",
      provider,
      systemPrompt: "你是程小帮",
      messages: [{ role: "user", content: "你好", timestamp: 0 }],
      tools: [
        {
          name: "read_file",
          label: "读取文件",
          description: "读取文件",
          parameters: { type: "object" },
          execute: async () => ({ content: [], details: undefined })
        }
      ],
      sessionCostCny: 0.16,
      compactedUpToMessageId: "msg_1"
    });

    expect(usage.contextWindowTokens).toBe(1_000_000);
    expect(usage.autoCompactThresholdTokens).toBe(800_000);
    expect(usage.compacted).toBe(true);
    expect(usage.messageCount).toBe(1);
    expect(usage.estimatedTokens).toBeGreaterThan(usage.messageTokens);
    expect(usage.sessionCostCny).toBe(0.16);
    expect(shouldAutoCompactContext(usage)).toBe(false);
  });

  it("marks usage over the automatic compaction threshold", () => {
    const usage = buildSessionContextUsage({
      sessionId: "session_1",
      provider,
      systemPrompt: "",
      messages: [{ role: "user", content: "你".repeat(810_000), timestamp: 0 }],
      tools: [],
      sessionCostCny: 0
    });

    expect(usage.status).toBe("over_threshold");
    expect(shouldAutoCompactContext(usage)).toBe(true);
  });

  it("uses provider-reported cost in the estimate", () => {
    const cost = estimateSessionCostCny({
      provider,
      estimatedContextTokens: 10_000,
      runs: [
        {
          id: "run_1",
          sessionId: "session_1",
          status: "completed",
          usage: {
            promptTokens: 100,
            completionTokens: 50,
            totalTokens: 150,
            costUsd: 0.0015
          },
          createdAt: "2026-06-13T00:00:00.000Z",
          updatedAt: "2026-06-13T00:00:01.000Z"
        }
      ]
    });

    expect(cost).toBe(0.01);
  });

  it("estimates failed runs that did not return usage", () => {
    const cost = estimateSessionCostCny({
      provider,
      estimatedContextTokens: 100_000,
      runs: [
        {
          id: "run_1",
          sessionId: "session_1",
          status: "failed",
          error: "429 rate limit",
          createdAt: "2026-06-13T00:00:00.000Z",
          updatedAt: "2026-06-13T00:00:01.000Z"
        }
      ]
    });

    expect(cost).toBeGreaterThan(0);
  });

  it("does not invent estimated cost when model pricing is missing", () => {
    const cost = estimateSessionCostCny({
      provider: { ...provider, kind: "custom", model: "expensive-image-model" },
      estimatedContextTokens: 100_000,
      runs: [
        {
          id: "run_1",
          sessionId: "session_1",
          status: "failed",
          error: "provider error",
          createdAt: "2026-06-13T00:00:00.000Z",
          updatedAt: "2026-06-13T00:00:01.000Z"
        }
      ]
    });

    expect(cost).toBe(0);
  });
});
