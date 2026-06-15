import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { WebSearchExecutor } from "../web-search/web-search-config-service";
import { textResult } from "./tool-result";

const MAX_FETCH_CHARS = 20_000;

const fetchUrlParams = Type.Object({
  url: Type.String({ description: "要抓取的 http(s) 地址" }),
  prompt: Type.String({ description: "抓取后要当前模型完成的处理要求；工具只返回内容，不另起模型" })
});

const webSearchParams = Type.Object({
  query: Type.String({ description: "要搜索的公网信息关键词或问题" }),
  allowed_domains: Type.Optional(Type.Array(Type.String(), { description: "只允许搜索这些域名，最多 20 个" })),
  blocked_domains: Type.Optional(Type.Array(Type.String(), { description: "排除这些域名，最多 20 个" })),
  maxUses: Type.Optional(
    Type.Number({
      description: "返回结果数量，默认 5，范围 1-8",
      minimum: 1,
      maximum: 8
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
    name: "WebFetch",
    label: "抓取网页",
    description:
      "抓取一个网页或接口的内容并返回纯文本，同时附上 prompt 交给当前模型继续处理；不会另起嵌套模型。",
    parameters: fetchUrlParams,
    execute: async (_id, params) =>
      textResult(["用户要求：", params.prompt, "", "抓取内容：", await fetchUrl(params.url)].join("\n"))
  };

  if (!webSearch) {
    return [fetchUrlTool];
  }
  const webSearchTool: AgentTool<typeof webSearchParams> = {
    name: "WebSearch",
    label: "网络搜索",
    description:
      "使用 Tavily 纯搜索 API 查询实时公网信息，返回标题、URL 与摘要；适合新闻、文档、资料调研和需要来源的事实核查。",
    parameters: webSearchParams,
    execute: async (_id, params) => {
      if (params.allowed_domains?.length && params.blocked_domains?.length) {
        throw new Error("WebSearch 的 allowed_domains 和 blocked_domains 不能同时传入");
      }
      return textResult(
        await webSearch({
          query: params.query,
          maxResults: params.maxUses,
          allowedDomains: params.allowed_domains,
          blockedDomains: params.blocked_domains
        })
      );
    }
  };

  return [fetchUrlTool, webSearchTool];
}
