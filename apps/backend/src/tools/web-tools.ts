import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { WebSearchExecutor } from "../web-search/web-search-config-service";
import { textResult } from "./tool-result";

const MAX_FETCH_CHARS = 20_000;

const fetchUrlParams = Type.Object({
  url: Type.String({ description: "要抓取的 http(s) 地址" })
});

const webSearchParams = Type.Object({
  query: Type.String({ description: "要搜索的公网信息关键词或问题" }),
  maxResults: Type.Optional(
    Type.Number({
      description: "返回结果数量，默认 5，范围 1-10",
      minimum: 1,
      maximum: 10
    })
  )
});

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function fetchUrl(url: string): Promise<string> {
  if (!/^https?:\/\//i.test(url)) {
    throw new Error("仅支持 http(s) 地址");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "chengxiaobang/0.1 (+local-agent)" }
    });
    if (!response.ok) {
      throw new Error(`请求失败 ${response.status} ${response.statusText}`);
    }
    const contentType = response.headers.get("content-type") ?? "";
    const raw = await response.text();
    const text = /html/i.test(contentType) ? htmlToText(raw) : raw.trim();
    return text.length > MAX_FETCH_CHARS
      ? `${text.slice(0, MAX_FETCH_CHARS)}\n…（内容已截断，共 ${text.length} 字）`
      : text || "（无内容）";
  } finally {
    clearTimeout(timeout);
  }
}

export function createWebTools(webSearch?: WebSearchExecutor): AgentTool<any>[] {
  const fetchUrlTool: AgentTool<typeof fetchUrlParams> = {
    name: "fetch_url",
    label: "抓取网页",
    description: "抓取一个网页或接口的内容并返回纯文本，用于联网查资料、读取文档或 API 数据。",
    parameters: fetchUrlParams,
    execute: async (_id, params) => textResult(await fetchUrl(params.url))
  };

  if (!webSearch) {
    return [fetchUrlTool];
  }
  const webSearchTool: AgentTool<typeof webSearchParams> = {
    name: "web_search",
    label: "网络搜索",
    description:
      "使用 Tavily 纯搜索 API 查询实时公网信息，返回标题、URL 与摘要；适合新闻、文档、资料调研和需要来源的事实核查。",
    parameters: webSearchParams,
    execute: async (_id, params) =>
      textResult(
        await webSearch({
          query: params.query,
          maxResults: params.maxResults
        })
      )
  };

  return [fetchUrlTool, webSearchTool];
}
