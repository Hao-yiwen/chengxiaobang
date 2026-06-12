import { describe, expect, it } from "vitest";
import { nowIso, type ProviderConfig } from "@chengxiaobang/shared";
import {
  buildTitleContext,
  generateSessionTitle,
  normalizeTitle
} from "../src/agent/session-title";
import { scriptedStreamFn } from "./helpers/scripted-stream";

function testProvider(): ProviderConfig {
  const timestamp = nowIso();
  return {
    id: "deepseek",
    kind: "deepseek",
    name: "DeepSeek",
    baseURL: "https://api.deepseek.com",
    model: "deepseek-v4-flash",
    apiKeyRef: "ref",
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

describe("normalizeTitle", () => {
  it("strips quotes, label prefixes and trailing punctuation", () => {
    expect(normalizeTitle("「修复登录问题」")).toBe("修复登录问题");
    expect(normalizeTitle('标题："分析销售数据"。')).toBe("分析销售数据");
    expect(normalizeTitle("  整理周报\n这是解释文字")).toBe("整理周报");
  });

  it("caps overlong answers and rejects empty ones", () => {
    expect(normalizeTitle("一".repeat(40))).toBe("一".repeat(20));
    expect(normalizeTitle("  「」。 ")).toBeUndefined();
    expect(normalizeTitle("")).toBeUndefined();
  });
});

describe("buildTitleContext", () => {
  it("clips long prompts and keeps the naming instruction", () => {
    const context = buildTitleContext(`  ${"长".repeat(3000)}  `);
    expect(context.systemPrompt).toContain("简短的中文标题");
    expect(context.messages).toHaveLength(1);
    const content = context.messages[0].content as string;
    expect(content).toHaveLength(2000);
  });
});

describe("generateSessionTitle", () => {
  it("returns the normalized model answer", async () => {
    const scripted = scriptedStreamFn([{ text: "「修复登录问题」" }]);
    const title = await generateSessionTitle({
      prompt: "帮我修复一下登录页面报错的问题",
      provider: testProvider(),
      apiKey: "test-key",
      signal: new AbortController().signal,
      streamFn: scripted.streamFn
    });
    expect(title).toBe("修复登录问题");
    expect(scripted.calls).toHaveLength(1);
    expect(scripted.calls[0].context.systemPrompt).toContain("会话命名助手");
  });

  it("throws on model errors", async () => {
    const scripted = scriptedStreamFn([{ error: "boom" }]);
    await expect(
      generateSessionTitle({
        prompt: "你好",
        provider: testProvider(),
        apiKey: "test-key",
        signal: new AbortController().signal,
        streamFn: scripted.streamFn
      })
    ).rejects.toThrow("boom");
  });

  it("returns undefined for aborted calls instead of a partial title", async () => {
    const scripted = scriptedStreamFn([{ text: "修复登", abort: true }]);
    const title = await generateSessionTitle({
      prompt: "帮我修复登录问题",
      provider: testProvider(),
      apiKey: "test-key",
      signal: new AbortController().signal,
      streamFn: scripted.streamFn
    });
    expect(title).toBeUndefined();
  });
});
