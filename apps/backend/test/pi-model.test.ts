import { afterEach, describe, expect, it } from "vitest";
import { streamSimple } from "@earendil-works/pi-ai";
import { nowIso, type ProviderConfig } from "@chengxiaobang/shared";
import {
  buildModel,
  buildModelStreamOptions,
  testProvider,
  toTokenUsage
} from "../src/model/pi-model";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function provider(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  const timestamp = nowIso();
  return {
    id: "deepseek",
    kind: "deepseek",
    name: "DeepSeek",
    baseURL: "https://api.deepseek.com",
    model: "deepseek-v4-flash",
    apiKeyRef: "memory:deepseek",
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides
  };
}

describe("buildModel", () => {
  it("maps builtin provider kinds to pi slugs so compat auto-detects", () => {
    expect(buildModel(provider())).toMatchObject({
      id: "deepseek-v4-flash",
      api: "openai-completions",
      provider: "deepseek",
      baseUrl: "https://api.deepseek.com",
      reasoning: false
    });
    expect(
      buildModel(
        provider({ id: "kimi", kind: "kimi", baseURL: "https://api.moonshot.ai/v1/", model: "kimi-k2.6" })
      )
    ).toMatchObject({
      provider: "moonshotai",
      baseUrl: "https://api.moonshot.ai/v1"
    });
    // Unknown kinds pass through so baseUrl-based compat detection still applies.
    expect(buildModel(provider({ kind: "custom" }))).toMatchObject({ provider: "custom" });
  });

  it("enables DeepSeek reasoning only when a mode is selected", () => {
    expect(buildModel(provider())).toMatchObject({ reasoning: false });
    expect(buildModel(provider({ reasoningMode: "high" }))).toMatchObject({
      reasoning: true,
      compat: { thinkingFormat: "deepseek", supportsReasoningEffort: true }
    });
  });
});

describe("toTokenUsage", () => {
  it("restores full prompt size and surfaces cache reads", () => {
    expect(
      toTokenUsage({
        input: 6,
        output: 5,
        cacheRead: 4,
        cacheWrite: 0,
        totalTokens: 15,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
      })
    ).toEqual({
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
      cachedPromptTokens: 4
    });
  });

  it("omits cachedPromptTokens when nothing was cached", () => {
    expect(
      toTokenUsage({
        input: 10,
        output: 5,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 15,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
      })
    ).not.toHaveProperty("cachedPromptTokens");
  });
});

describe("testProvider", () => {
  it("requires an api key and probes /models", async () => {
    await expect(testProvider(provider())).rejects.toThrow("请先填写 API Key");

    const requests: Array<{ url: string; auth: string | undefined }> = [];
    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: String(url),
        auth: (init?.headers as Record<string, string>)?.Authorization
      });
      return new Response("{}", { status: 200 });
    }) as typeof fetch;

    await testProvider(provider({ baseURL: "https://api.deepseek.com/" }), "sk-test");
    expect(requests).toEqual([
      { url: "https://api.deepseek.com/models", auth: "Bearer sk-test" }
    ]);

    globalThis.fetch = (async () => new Response("nope", { status: 401, statusText: "Unauthorized" })) as typeof fetch;
    await expect(testProvider(provider(), "sk-bad")).rejects.toThrow("连接失败 401");
  });
});

describe("reasoning wire options", () => {
  it("maps DeepSeek high/xhigh/off to thinking and reasoning_effort", async () => {
    await expect(expectRequestBody(provider({ reasoningMode: "high" }))).resolves.toMatchObject({
      thinking: { type: "enabled" },
      reasoning_effort: "high"
    });
    await expect(expectRequestBody(provider({ reasoningMode: "xhigh" }))).resolves.toMatchObject({
      thinking: { type: "enabled" },
      reasoning_effort: "max"
    });
    const off = await expectRequestBody(provider({ reasoningMode: "off" }));
    expect(off).toMatchObject({ thinking: { type: "disabled" } });
    expect(off).not.toHaveProperty("reasoning_effort");
  });

  it("maps Qwen auto/off to enable_thinking", async () => {
    await expect(
      expectRequestBody(
        provider({
          id: "qwen",
          kind: "qwen",
          name: "千问",
          baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
          model: "qwen-plus",
          reasoningMode: "auto"
        })
      )
    ).resolves.toMatchObject({ enable_thinking: true });
    await expect(
      expectRequestBody(
        provider({
          id: "qwen",
          kind: "qwen",
          name: "千问",
          baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
          model: "qwen-plus",
          reasoningMode: "off"
        })
      )
    ).resolves.toMatchObject({ enable_thinking: false });
  });

  it("maps Doubao effort modes through Ark-compatible thinking fields", async () => {
    await expect(
      expectRequestBody(
        provider({
          id: "doubao",
          kind: "doubao",
          name: "豆包",
          baseURL: "https://ark.cn-beijing.volces.com/api/v3",
          model: "doubao-seed-1-6-250615",
          reasoningMode: "medium"
        })
      )
    ).resolves.toMatchObject({
      thinking: { type: "enabled" },
      reasoning_effort: "medium"
    });
  });

  it("patches Kimi and MiniMax vendor-specific thinking payloads", async () => {
    const kimi = provider({
      id: "kimi",
      kind: "kimi",
      name: "Kimi",
      baseURL: "https://api.moonshot.ai/v1",
      model: "kimi-k2.6",
      reasoningMode: "off"
    });
    await expect(
      Promise.resolve(
        buildModelStreamOptions(kimi).onPayload?.({ model: kimi.model }, buildModel(kimi))
      )
    ).resolves.toMatchObject({ thinking: { type: "disabled" } });

    const minimax = provider({
      id: "minimax",
      kind: "minimax",
      name: "MiniMax",
      baseURL: "https://api.minimaxi.com/v1",
      model: "MiniMax-M3",
      reasoningMode: "auto"
    });
    await expect(
      Promise.resolve(
        buildModelStreamOptions(minimax).onPayload?.(
          { model: minimax.model },
          buildModel(minimax)
        )
      )
    ).resolves.toMatchObject({
      thinking: { type: "adaptive" },
      reasoning_split: true
    });
  });
});

describe("deepseek wire format through pi", () => {
  it("surfaces reasoning_content as thinking deltas and maps cached usage", async () => {
    const sse = [
      `data: ${JSON.stringify({
        id: "x",
        choices: [{ index: 0, delta: { role: "assistant", reasoning_content: "先想" } }]
      })}`,
      `data: ${JSON.stringify({
        id: "x",
        choices: [{ index: 0, delta: { reasoning_content: "一想" } }]
      })}`,
      `data: ${JSON.stringify({
        id: "x",
        choices: [{ index: 0, delta: { content: "答案" } }]
      })}`,
      `data: ${JSON.stringify({
        id: "x",
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }]
      })}`,
      `data: ${JSON.stringify({
        id: "x",
        choices: [],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
          prompt_cache_hit_tokens: 4
        }
      })}`,
      "data: [DONE]",
      ""
    ].join("\n\n");

    let requestBody: Record<string, unknown> | undefined;
    globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response(sse, {
        status: 200,
        headers: { "content-type": "text/event-stream" }
      });
    }) as typeof fetch;

    const model = buildModel(provider());
    const stream = streamSimple(
      model,
      { messages: [{ role: "user", content: "你好", timestamp: Date.now() }] },
      { apiKey: "sk-test" }
    );

    let thinking = "";
    let text = "";
    for await (const event of stream) {
      if (event.type === "thinking_delta") {
        thinking += event.delta;
      }
      if (event.type === "text_delta") {
        text += event.delta;
      }
    }
    const message = await stream.result();

    expect(thinking).toBe("先想一想");
    expect(text).toBe("答案");
    expect(message.stopReason).toBe("stop");
    expect(toTokenUsage(message.usage)).toEqual({
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
      cachedPromptTokens: 4
    });
    // reasoning:false keeps thinking request params off the wire entirely.
    expect(requestBody).not.toHaveProperty("thinking");
    expect(requestBody).toMatchObject({ model: "deepseek-v4-flash", stream: true });
  });
});

async function expectRequestBody(config: ProviderConfig): Promise<Record<string, unknown>> {
  const sse = [
    `data: ${JSON.stringify({
      id: "x",
      choices: [{ index: 0, delta: { role: "assistant", content: "好" } }]
    })}`,
    `data: ${JSON.stringify({
      id: "x",
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }]
    })}`,
    `data: ${JSON.stringify({
      id: "x",
      choices: [],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
    })}`,
    "data: [DONE]",
    ""
  ].join("\n\n");
  let requestBody: Record<string, unknown> | undefined;
  globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body));
    return new Response(sse, {
      status: 200,
      headers: { "content-type": "text/event-stream" }
    });
  }) as typeof fetch;

  const stream = streamSimple(
    buildModel(config),
    { messages: [{ role: "user", content: "你好", timestamp: Date.now() }] },
    { apiKey: "sk-test", ...buildModelStreamOptions(config) }
  );
  for await (const _event of stream) {
    // 消费完整流，确保 pi 已经构造并发送请求体。
  }
  await stream.result();
  return requestBody ?? {};
}
