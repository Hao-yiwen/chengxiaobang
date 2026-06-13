import { afterEach, describe, expect, it, vi } from "vitest";
import { formatTavilyResponse, searchTavily } from "../src/web-search/tavily-client";

describe("searchTavily", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("sends a Basic Search request and formats results", async () => {
    const fetchMock = vi.fn(async (..._args: Parameters<typeof fetch>) =>
      new Response(
        JSON.stringify({
          results: [
            {
              title: "Tavily Docs",
              url: "https://docs.tavily.com",
              content: "Search API reference",
              score: 0.92
            }
          ],
          usage: { credits: 1 }
        }),
        { headers: { "content-type": "application/json" } }
      )
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await searchTavily({
      apiKey: "tvly-key",
      query: " tavily search ",
      maxResults: 3
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.tavily.com/search",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer tvly-key" })
      })
    );
    const request = fetchMock.mock.calls[0]![1]!;
    expect(JSON.parse(String(request.body))).toMatchObject({
      query: "tavily search",
      search_depth: "basic",
      topic: "general",
      max_results: 3,
      include_raw_content: false
    });
    expect(result).toContain("Tavily 网络搜索结果");
    expect(result).toContain("https://docs.tavily.com");
    expect(result).toContain("1 credits");
  });

  it("surfaces Tavily HTTP errors", async () => {
    globalThis.fetch = (async () =>
      new Response("bad key", { status: 401, statusText: "Unauthorized" })) as typeof fetch;

    await expect(searchTavily({ apiKey: "bad", query: "x" })).rejects.toThrow(
      "Tavily 搜索失败 401"
    );
  });
});

describe("formatTavilyResponse", () => {
  it("handles empty result arrays", () => {
    expect(formatTavilyResponse("query", { results: [] }, 12)).toContain("没有返回可用结果");
  });
});
