import { afterEach, describe, expect, it } from "vitest";
import { streamSimple } from "@earendil-works/pi-ai";
import { nowIso, type ProviderConfig } from "@chengxiaobang/shared";
import { buildModel, testProvider, toTokenUsage } from "../src/model/pi-model";

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
