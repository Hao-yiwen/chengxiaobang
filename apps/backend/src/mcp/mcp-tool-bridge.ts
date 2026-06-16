import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import { toToolParameters } from "./json-schema-to-typebox";
import type { McpToolHandle } from "./types";

/** MCP callTool 的最小结果形状（与 SDK CallToolResult 对齐，仅取我们用到的字段）。 */
export interface McpCallResult {
  content?: Array<{
    type: string;
    text?: string;
    data?: string;
    mimeType?: string;
    [key: string]: unknown;
  }>;
  isError?: boolean;
  structuredContent?: unknown;
}

/** 由连接层提供：用 MCP 工具原名 + 参数发起一次 callTool。 */
export type McpCallTool = (
  toolName: string,
  args: Record<string, unknown>,
  signal?: AbortSignal
) => Promise<McpCallResult>;

/** 桥接工具名：mcp__<serverKey-slug>__<toolName>，双下划线分隔，避免与内置单段工具名冲突。 */
export function mcpToolName(serverKey: string, toolName: string): string {
  return `mcp__${slug(serverKey)}__${toolName}`;
}

/** 是否为 MCP 桥接工具名（审批/裁剪据此识别）。 */
export function isMcpToolName(name: string): boolean {
  return name.startsWith("mcp__");
}

/** 把一个 MCP 工具描述包装成 pi AgentTool。 */
export function bridgeMcpTool(options: {
  serverKey: string;
  serverName: string;
  handle: McpToolHandle;
  callTool: McpCallTool;
}): AgentTool {
  const { serverKey, serverName, handle, callTool } = options;
  return {
    name: mcpToolName(serverKey, handle.name),
    label: `${serverName} · ${handle.name}`,
    description: handle.description ?? `MCP 工具 ${handle.name}`,
    parameters: toToolParameters(handle.inputSchema),
    executionMode: "sequential",
    execute: async (_toolCallId, params, signal) => {
      const args =
        params && typeof params === "object" ? (params as Record<string, unknown>) : {};
      const result = await callTool(handle.name, args, signal);
      return mapCallToolResult(result, handle.name);
    }
  };
}

/**
 * CallToolResult content blocks → pi AgentToolResult。
 * text/image 直传；其它（audio/resource）本期转文本摘要不塞二进制；
 * isError 时抛错（pi 约定 execute 失败应 throw 而非编码进 content）；structuredContent 进 details。
 */
export function mapCallToolResult(
  result: McpCallResult,
  toolName: string
): { content: (TextContent | ImageContent)[]; details: unknown } {
  const blocks = Array.isArray(result.content) ? result.content : [];
  const content: (TextContent | ImageContent)[] = [];
  for (const block of blocks) {
    if (block.type === "text" && typeof block.text === "string") {
      content.push({ type: "text", text: block.text });
    } else if (block.type === "image" && typeof block.data === "string") {
      content.push({
        type: "image",
        data: block.data,
        mimeType: typeof block.mimeType === "string" ? block.mimeType : "image/png"
      });
    } else {
      content.push({ type: "text", text: `[MCP ${block.type} 资源]` });
    }
  }
  if (result.isError) {
    const text = content
      .filter((entry): entry is TextContent => entry.type === "text")
      .map((entry) => entry.text)
      .join("\n")
      .trim();
    throw new Error(text || `MCP 工具 ${toolName} 执行失败`);
  }
  if (content.length === 0) {
    content.push({ type: "text", text: "（MCP 工具无文本输出）" });
  }
  return { content, details: result.structuredContent };
}

function slug(value: string): string {
  return value.replace(/[^a-zA-Z0-9_]/g, "_");
}
