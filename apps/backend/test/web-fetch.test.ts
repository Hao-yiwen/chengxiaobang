import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
  clearWebFetchCache,
  createWebFetchTool,
  type WebFetchContentProcessor,
  type WebFetchContentProcessorInput
} from "../src/tools/web-fetch";

type FetchHandler = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> | Response;

const originalFetch = globalThis.fetch;

beforeEach(() => {
  clearWebFetchCache();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  clearWebFetchCache();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("WebFetch", () => {
  it("converts HTML to Markdown and returns the injected model result", async () => {
    let observed: WebFetchContentProcessorInput | undefined;
    installFetch(() =>
      new Response("<html><body><h1>标题</h1><script>ignore()</script><p>正文</p></body></html>", {
        headers: { "content-type": "text/html" }
      })
    );

    const result = await runWebFetch(
      { url: "https://example.com/docs", prompt: "提取正文" },
      async (input) => {
        observed = input;
        return {
          text: "已提取正文",
          usage: {
            promptTokens: 10,
            completionTokens: 3,
            totalTokens: 13
          },
          providerId: "test-provider",
          model: "test-model"
        };
      }
    );

    expect(result).toContain("WebFetch 结果");
    expect(result).toContain("HTTP：200");
    expect(result).toContain("处理模型：test-provider/test-model");
    expect(result).toContain("模型用量：prompt=10, completion=3, total=13");
    expect(result).toContain("已提取正文");
    expect(observed?.markdown).toContain("标题");
    expect(observed?.markdown).toContain("正文");
    expect(observed?.markdown).not.toContain("ignore");
    expect(observed?.markdown).not.toContain("<script");
  });

  it("rejects unsupported URL forms before fetching", async () => {
    const fetchMock = installFetch(() => new Response("should not fetch"));
    const processor = vi.fn<WebFetchContentProcessor>(async () => ({ text: "不会执行" }));

    await expect(
      runWebFetch({ url: "file:///etc/passwd", prompt: "读取" }, processor)
    ).rejects.toThrow("仅支持 http");
    await expect(
      runWebFetch({ url: "https://user:pass@example.com", prompt: "读取" }, processor)
    ).rejects.toThrow("用户名或密码");
    await expect(
      runWebFetch({ url: "http://localhost:3000", prompt: "读取" }, processor)
    ).rejects.toThrow("公网");
    await expect(
      runWebFetch({ url: "http://127.0.0.1", prompt: "读取" }, processor)
    ).rejects.toThrow("公网");
    await expect(
      runWebFetch({ url: "http://192.168.1.20", prompt: "读取" }, processor)
    ).rejects.toThrow("公网");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(processor).not.toHaveBeenCalled();
  });

  it("upgrades HTTP URLs to HTTPS before fetching", async () => {
    const fetchMock = installFetch(() =>
      new Response("hello", { headers: { "content-type": "text/plain" } })
    );

    await runWebFetch({ url: "http://example.com/a?token=hidden", prompt: "总结" });

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://example.com/a?token=hidden");
    expect(fetchMock.mock.calls[0]?.[1]?.redirect).toBe("manual");
  });

  it("follows same-host redirects and reports cross-host redirects without processing", async () => {
    const sameHostFetch = installFetch((input) => {
      if (String(input) === "https://example.com/start") {
        return new Response(null, {
          status: 302,
          headers: { location: "https://www.example.com/final" }
        });
      }
      return new Response("same host content", {
        headers: { "content-type": "text/plain" }
      });
    });
    const processor = vi.fn<WebFetchContentProcessor>(async (input) => ({
      text: `最终地址：${input.finalUrl}`
    }));

    const followed = await runWebFetch(
      { url: "https://example.com/start", prompt: "总结" },
      processor
    );

    expect(sameHostFetch).toHaveBeenCalledTimes(2);
    expect(followed).toContain("最终地址：https://www.example.com/final");

    clearWebFetchCache();
    const crossHostProcessor = vi.fn<WebFetchContentProcessor>(async () => ({ text: "不应执行" }));
    installFetch(() =>
      new Response(null, {
        status: 302,
        headers: { location: "https://other.example/final" }
      })
    );

    const redirected = await runWebFetch(
      { url: "https://example.com/start", prompt: "继续抓取" },
      crossHostProcessor
    );

    expect(redirected).toContain("REDIRECT DETECTED");
    expect(redirected).toContain("https://other.example/final");
    expect(crossHostProcessor).not.toHaveBeenCalled();
  });

  it("supports text and JSON but rejects binary content", async () => {
    let observedMarkdown = "";
    installFetch(() =>
      new Response(JSON.stringify({ ok: true }), {
        headers: { "content-type": "application/json" }
      })
    );

    const jsonResult = await runWebFetch(
      { url: "https://example.com/api", prompt: "读取 JSON" },
      async (input) => {
        observedMarkdown = input.markdown;
        return { text: "JSON 已处理" };
      }
    );

    expect(jsonResult).toContain("JSON 已处理");
    expect(observedMarkdown).toContain('"ok": true');

    clearWebFetchCache();
    installFetch(() =>
      new Response("pdf bytes", {
        headers: { "content-type": "application/pdf" }
      })
    );

    await expect(
      runWebFetch({ url: "https://example.com/file.pdf", prompt: "读 PDF" })
    ).rejects.toThrow("只支持网页和文本内容");
  });

  it("rejects responses larger than the configured limit", async () => {
    installFetch(() =>
      new Response("", {
        headers: {
          "content-type": "text/plain",
          "content-length": String(10 * 1024 * 1024 + 1)
        }
      })
    );

    await expect(
      runWebFetch({ url: "https://example.com/large.txt", prompt: "总结" })
    ).rejects.toThrow("响应内容过大");
  });

  it("truncates oversized Markdown before model processing", async () => {
    const largeText = "程".repeat(100_200);
    let observedLength = 0;
    installFetch(() =>
      new Response(largeText, {
        headers: { "content-type": "text/plain" }
      })
    );

    await runWebFetch(
      { url: "https://example.com/long.txt", prompt: "总结" },
      async (input) => {
        observedLength = input.markdown.length;
        return { text: "已处理长文本" };
      }
    );

    expect(observedLength).toBeGreaterThan(100_000);
    expect(observedLength).toBeLessThan(100_100);
  });

  it("caches fetched URL content but processes each prompt separately", async () => {
    const fetchMock = installFetch(() =>
      new Response("cached content", { headers: { "content-type": "text/plain" } })
    );
    const processor = vi.fn<WebFetchContentProcessor>(async (input) => ({
      text: `处理：${input.prompt}`
    }));

    const first = await runWebFetch({ url: "https://example.com/cache", prompt: "第一次" }, processor);
    const second = await runWebFetch({ url: "https://example.com/cache", prompt: "第二次" }, processor);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(processor).toHaveBeenCalledTimes(2);
    expect(first).toContain("缓存：未命中");
    expect(second).toContain("缓存：命中");
    expect(second).toContain("处理：第二次");
  });

  it("aborts slow fetches when the request timeout fires", async () => {
    vi.useFakeTimers();
    installFetch((_input, init) => {
      const signal = init?.signal as AbortSignal | undefined;
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    });

    const pending = expect(
      runWebFetch({ url: "https://example.com/slow", prompt: "总结" })
    ).rejects.toThrow("WebFetch 请求超时");
    await vi.advanceTimersByTimeAsync(60_001);

    await pending;
  });
});

async function runWebFetch(
  args: { url: string; prompt: string },
  processContent: WebFetchContentProcessor = async () => ({ text: "默认处理结果" }),
  signal?: AbortSignal
): Promise<string> {
  const tool = createWebFetchTool({ processContent }) as AgentTool<any>;
  const result = await tool.execute("tool_web_fetch", args, signal);
  return result.content
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

function installFetch(handler: FetchHandler) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(input, init)
  );
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}
