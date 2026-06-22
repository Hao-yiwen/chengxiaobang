import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { WebSearchExecutor } from "../web-search/web-search-config-service";
import { textResult } from "./tool-result";
import { createWebFetchTool, type WebFetchRuntime } from "./web-fetch";

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

export function createWebTools(
  webSearch?: WebSearchExecutor,
  webFetch?: WebFetchRuntime
): AgentTool<any>[] {
  const fetchUrlTool = createWebFetchTool(webFetch);

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
