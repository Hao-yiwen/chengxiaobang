import { afterEach, describe, expect, it } from "vitest";
import { streamSimple } from "@earendil-works/pi-ai";
import { nowIso, type ProviderConfig } from "@chengxiaobang/shared";
import {
  buildModel,
  buildModelStreamOptions,
  listProviderModels,
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
      reasoning: false,
      cost: { input: 0.14, output: 0.28, cacheRead: 0.0028, cacheWrite: 0 },
      contextWindow: 1_000_000
    });
    expect(
      buildModel(
        provider({ id: "kimi", kind: "kimi", baseURL: "https://api.moonshot.ai/v1/", model: "kimi-k2.6" })
      )
    ).toMatchObject({
      provider: "moonshotai",
      baseUrl: "https://api.moonshot.ai/v1"
    });
    // 未知 kind 原样透传，仍可依赖 baseUrl 做兼容探测。
    expect(buildModel(provider({ kind: "custom" }))).toMatchObject({ provider: "custom" });
  });

  it("maps Gemini to the native Google Gen AI protocol", () => {
    expect(
      buildModel(
        provider({
          id: "gemini",
          kind: "gemini",
          name: "Gemini",
          baseURL: "https://generativelanguage.googleapis.com/v1beta/",
          model: "gemini-3.5-flash",
          api: "google-generative-ai",
          auth: { type: "x-api-key", header: "x-goog-api-key" }
        })
      )
    ).toMatchObject({
      id: "gemini-3.5-flash",
      api: "google-generative-ai",
      provider: "google",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      input: ["text", "image"],
      contextWindow: 1_048_576
    });
  });

  it("enables DeepSeek reasoning only when a mode is selected", () => {
    expect(buildModel(provider())).toMatchObject({ reasoning: false });
    expect(buildModel(provider({ reasoningMode: "high" }))).toMatchObject({
      reasoning: true,
      compat: { thinkingFormat: "deepseek", supportsReasoningEffort: true }
    });
  });

  it("maps shared model input modalities to pi model input capabilities", () => {
    expect(buildModel(provider()).input).toEqual(["text"]);
    expect(
      buildModel(
        provider({
          id: "kimi",
          kind: "kimi",
          name: "Kimi",
          baseURL: "https://api.moonshot.ai/v1",
          model: "kimi-k2.6"
        })
      ).input
    ).toEqual(["text", "image"]);
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

  it("surfaces provider-reported cost", () => {
    expect(
      toTokenUsage({
        input: 10,
        output: 5,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 15,
        cost: {
          input: 0.0000014,
          output: 0.0000014,
          cacheRead: 0,
          cacheWrite: 0,
          total: 0.0000028
        }
      })
    ).toMatchObject({
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
      costUsd: 0.0000028
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

describe("buildModelStreamOptions", () => {
  it("defaults plain and reasoning model requests to five retries", () => {
    expect(buildModelStreamOptions(provider())).toMatchObject({ maxRetries: 5 });
    expect(buildModelStreamOptions(provider({ reasoningMode: "high" }))).toMatchObject({
      maxRetries: 5,
      reasoning: "high"
    });
  });

  it("keeps vendor payload hooks while applying the retry default", async () => {
    const kimi = provider({
      id: "kimi",
      kind: "kimi",
      name: "Kimi",
      baseURL: "https://api.moonshot.ai/v1",
      model: "kimi-k2.6",
      reasoningMode: "off"
    });
    const kimiOptions = buildModelStreamOptions(kimi);
    expect(kimiOptions.maxRetries).toBe(5);
    await expect(
      Promise.resolve(kimiOptions.onPayload?.({ model: kimi.model }, buildModel(kimi)))
    ).resolves.toMatchObject({ thinking: { type: "disabled" } });

    const minimax = provider({
      id: "minimax",
      kind: "minimax",
      name: "MiniMax",
      baseURL: "https://api.minimaxi.com/v1",
      model: "MiniMax-M3",
      reasoningMode: "auto"
    });
    const minimaxOptions = buildModelStreamOptions(minimax);
    expect(minimaxOptions.maxRetries).toBe(5);
    await expect(
      Promise.resolve(
        minimaxOptions.onPayload?.({ model: minimax.model }, buildModel(minimax))
      )
    ).resolves.toMatchObject({
      thinking: { type: "adaptive" },
      reasoning_split: true
    });
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

describe("listProviderModels", () => {
  it("parses Google Gen AI model names and sends the configured API key header", async () => {
    const requests: Array<{ url: string; apiKey: string | undefined }> = [];
    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: String(url),
        apiKey: (init?.headers as Record<string, string>)?.["x-goog-api-key"]
      });
      return Response.json({
        models: [
          { name: "models/gemini-3.5-flash" },
          { name: "models/gemini-3.1-pro-preview" }
        ]
      });
    }) as typeof fetch;

    await expect(
      listProviderModels(
        provider({
          id: "gemini",
          kind: "gemini",
          name: "Gemini",
          baseURL: "https://generativelanguage.googleapis.com/v1beta/",
          model: "gemini-3.5-flash",
          api: "google-generative-ai",
          auth: { type: "x-api-key", header: "x-goog-api-key" }
        }),
        "gemini-key"
      )
    ).resolves.toEqual(["gemini-3.5-flash", "gemini-3.1-pro-preview"]);
    expect(requests).toEqual([
      {
        url: "https://generativelanguage.googleapis.com/v1beta/models",
        apiKey: "gemini-key"
      }
    ]);
  });
});

describe("reasoning wire options", () => {
  it("maps DeepSeek high/xhigh to thinking fields and keeps off silent", async () => {
    await expect(expectRequestBody(provider({ reasoningMode: "high" }))).resolves.toMatchObject({
      thinking: { type: "enabled" },
      reasoning_effort: "high"
    });
    await expect(expectRequestBody(provider({ reasoningMode: "xhigh" }))).resolves.toMatchObject({
      thinking: { type: "enabled" },
      reasoning_effort: "max"
    });
    const off = await expectRequestBody(provider({ reasoningMode: "off" }));
    expect(off).not.toHaveProperty("thinking");
    expect(off).not.toHaveProperty("reasoning_effort");
  });

  it("maps Qwen auto to enable_thinking and keeps off silent", async () => {
    await expect(
      expectRequestBody(
        provider({
          id: "qwen",
          kind: "qwen",
          name: "千问",
          baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
          model: "qwen3.7-max",
          reasoningMode: "auto"
        })
      )
    ).resolves.toMatchObject({ enable_thinking: true });
    const off = await expectRequestBody(
      provider({
        id: "qwen",
        kind: "qwen",
        name: "千问",
        baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        model: "qwen3.7-max",
        reasoningMode: "off"
      })
    );
    expect(off).not.toHaveProperty("enable_thinking");
  });

  it("maps Doubao effort modes through Ark-compatible thinking fields", async () => {
    await expect(
      expectRequestBody(
        provider({
          id: "doubao",
          kind: "doubao",
          name: "豆包",
          baseURL: "https://ark.cn-beijing.volces.com/api/v3",
          model: "doubao-seed-2.0-pro",
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
    const usage = toTokenUsage(message.usage);
    expect(usage).toMatchObject({
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
      cachedPromptTokens: 4
    });
    expect(usage.costUsd).toBeCloseTo(0.0000022512);
    // reasoning:false 时不应向请求体写入任何 thinking 参数。
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
