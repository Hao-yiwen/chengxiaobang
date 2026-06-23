import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { isDeferredToolName, toolMetadata } from "@chengxiaobang/shared";
import { getLogger } from "../logging/logger";
import { isMcpToolName } from "../mcp/mcp-tool-bridge";
import { textResult } from "./tool-result";

const DEFAULT_MAX_RESULTS = 8;
const MAX_RESULTS = 20;
const log = getLogger({ module: "tool-search-tool" });

const toolSearchParams = Type.Object({
  query: Type.String({
    description:
      "搜索关键词，或使用 select:ToolA,ToolB 精确加载 deferred 工具；命中的工具会在下一轮可调用。"
  }),
  max_results: Type.Optional(
    Type.Number({
      description: "最多返回/加载多少个结果，默认 8，最大 20。",
      minimum: 1,
      maximum: MAX_RESULTS
    })
  )
});

export interface ToolSearchRuntime {
  tools: () => AgentTool<any>[];
  enabledDeferredToolNames: Set<string>;
}

export function createToolSearchTool(runtime: ToolSearchRuntime): AgentTool<typeof toolSearchParams> {
  return {
    name: "ToolSearch",
    label: "搜索工具",
    description:
      "按名称或关键词查找 deferred 工具，尤其是 MCP 工具；用 select:ToolA,ToolB 可精确加载到下一轮。",
    parameters: toolSearchParams,
    execute: async (_id, params) => {
      const query = params.query.trim();
      const maxResults = normalizeMaxResults(params.max_results);
      const candidates = deferredCandidates(runtime.tools(), runtime.enabledDeferredToolNames);
      if (!query) {
        log.info("ToolSearch 收到空查询", {
          action: "tool_search.empty_query",
          deferredTools: candidates.length
        });
        return textResult(renderNoQuery(candidates));
      }

      const result = query.toLowerCase().startsWith("select:")
        ? selectExactTools(query.slice("select:".length), candidates, maxResults)
        : searchTools(query, candidates, maxResults);

      for (const match of result.matches) {
        runtime.enabledDeferredToolNames.add(match.name);
      }

      log.info("ToolSearch 已处理查询", {
        action: "tool_search.executed",
        query,
        requested: result.requested,
        matched: result.matches.map((tool) => tool.name),
        missing: result.missing,
        deferredTools: candidates.length,
        enabledDeferredTools: runtime.enabledDeferredToolNames.size
      });

      return textResult(renderSearchResult(result, candidates.length));
    }
  };
}

function deferredCandidates(
  tools: AgentTool<any>[],
  enabledDeferredToolNames: ReadonlySet<string>
): AgentTool<any>[] {
  return tools.filter((tool) => {
    if (tool.name === "ToolSearch" || enabledDeferredToolNames.has(tool.name)) {
      return false;
    }
    return isRuntimeDeferredTool(tool.name);
  });
}

function isRuntimeDeferredTool(name: string): boolean {
  return isMcpToolName(name) || isDeferredToolName(name);
}

interface SearchResult {
  requested: string[];
  matches: AgentTool<any>[];
  missing: string[];
}

function selectExactTools(
  query: string,
  candidates: AgentTool<any>[],
  maxResults: number
): SearchResult {
  const requested = query
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const byName = new Map(candidates.map((tool) => [tool.name, tool]));
  const matches: AgentTool<any>[] = [];
  const missing: string[] = [];
  for (const name of requested.slice(0, maxResults)) {
    const tool = byName.get(name);
    if (tool) {
      matches.push(tool);
    } else {
      missing.push(name);
    }
  }
  return { requested, matches, missing };
}

function searchTools(
  query: string,
  candidates: AgentTool<any>[],
  maxResults: number
): SearchResult {
  const terms = normalizeSearchText(query).split(/\s+/).filter(Boolean);
  const scored = candidates
    .map((tool) => ({ tool, score: scoreTool(tool, terms) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name));
  return {
    requested: terms,
    matches: scored.slice(0, maxResults).map((item) => item.tool),
    missing: scored.length === 0 ? [query] : []
  };
}

function scoreTool(tool: AgentTool<any>, terms: string[]): number {
  if (terms.length === 0) {
    return 0;
  }
  const metadata = toolMetadata(tool.name);
  const haystack = normalizeSearchText(
    [tool.name, tool.label, tool.description, metadata.searchHint, metadata.category].join(" ")
  );
  let score = 0;
  for (const term of terms) {
    if (tool.name.toLowerCase() === term) {
      score += 8;
    } else if (tool.name.toLowerCase().includes(term)) {
      score += 5;
    } else if (haystack.includes(term)) {
      score += 2;
    }
  }
  if (isMcpToolName(tool.name)) {
    score += 1;
  }
  return score;
}

function normalizeSearchText(text: string): string {
  return text.toLowerCase().replace(/[_:./-]+/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeMaxResults(value: number | undefined): number {
  if (!Number.isFinite(value ?? DEFAULT_MAX_RESULTS)) {
    return DEFAULT_MAX_RESULTS;
  }
  return Math.max(1, Math.min(MAX_RESULTS, Math.floor(value ?? DEFAULT_MAX_RESULTS)));
}

function renderNoQuery(candidates: AgentTool<any>[]): string {
  if (candidates.length === 0) {
    return "当前没有可加载的 deferred 工具；如果你期待 MCP 工具，请先确认对应 MCP server 已就绪。";
  }
  return [
    "请提供搜索关键词，或使用 select:ToolA,ToolB 精确加载工具。",
    "",
    "当前可加载的 deferred 工具示例：",
    ...candidates.slice(0, DEFAULT_MAX_RESULTS).map((tool) => renderToolLine(tool))
  ].join("\n");
}

function renderSearchResult(result: SearchResult, candidateCount: number): string {
  if (result.matches.length === 0) {
    return [
      "没有找到可加载的 deferred 工具。",
      candidateCount === 0
        ? "当前没有已就绪的 deferred/MCP 工具；如果你期待 MCP 工具，请检查 MCP server 是否已连接。"
        : "可以换一个关键词，或使用 select:ToolName 精确加载。",
      result.missing.length > 0 ? `未命中：${result.missing.join(", ")}` : ""
    ]
      .filter(Boolean)
      .join("\n");
  }
  const lines = [
    "已加载以下 deferred 工具；它们会在下一轮模型工具列表中可调用：",
    ...result.matches.map((tool) => renderToolLine(tool))
  ];
  if (result.missing.length > 0) {
    lines.push("", `未命中：${result.missing.join(", ")}`);
  }
  return lines.join("\n");
}

function renderToolLine(tool: AgentTool<any>): string {
  const metadata = toolMetadata(tool.name);
  const label = tool.label ? `（${tool.label}）` : "";
  return `- ${tool.name}${label}: ${metadata.searchHint}`;
}
