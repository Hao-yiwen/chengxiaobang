import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  AfterToolCallContext,
  AfterToolCallResult,
  AgentToolResult
} from "@earendil-works/pi-agent-core";

import { getLogger } from "../logging/logger";

const log = getLogger({ module: "agent/tool-result-spill" });

export const TOOL_RESULT_SPILL_DIR = ".chengxiaobang/tool-results";
const MAX_INLINE_TOOL_RESULT_CHARS = 24 * 1024;
const TOOL_RESULT_PREVIEW_CHARS = 4 * 1024;

interface ToolResultSpillContext {
  workspacePath: string;
  runId: string;
  toolCallId: string;
  toolName: string;
  isError: boolean;
}

/** 在工具结果进入模型上下文前做保护：超长文本落盘，只回传路径和固定预览。 */
export async function protectToolResultForContext(
  context: AfterToolCallContext,
  options: { workspacePath: string; runId: string }
): Promise<AfterToolCallResult | undefined> {
  const protectedResult = await protectAgentToolResult(context.result, {
    workspacePath: options.workspacePath,
    runId: options.runId,
    toolCallId: context.toolCall.id,
    toolName: context.toolCall.name,
    isError: context.isError
  });
  return protectedResult.spilled ? { content: protectedResult.result.content } : undefined;
}

export async function protectAgentToolResult<TDetails>(
  result: AgentToolResult<TDetails>,
  context: ToolResultSpillContext
): Promise<{ result: AgentToolResult<TDetails>; spilled: boolean; filePath?: string }> {
  const text = collectText(result.content);
  if (text.length <= MAX_INLINE_TOOL_RESULT_CHARS) {
    return { result, spilled: false };
  }
  let spill: { summary: string; filePath?: string };
  try {
    spill = await spillToolResultText(text, context);
  } catch (error) {
    log.error("[tool-result-spill] 工具结果过长但写入文件失败，已仅返回短预览", {
      runId: context.runId,
      toolCallId: context.toolCallId,
      toolName: context.toolName,
      chars: text.length,
      error: error instanceof Error ? error.message : String(error)
    });
    spill = { summary: buildFallbackSummary(text, context) };
  }
  return {
    result: {
      ...result,
      content: [{ type: "text", text: spill.summary }]
    },
    spilled: true,
    ...(spill.filePath ? { filePath: spill.filePath } : {})
  };
}

async function spillToolResultText(
  text: string,
  context: ToolResultSpillContext
): Promise<{ summary: string; filePath: string }> {
  const relativePath = join(
    TOOL_RESULT_SPILL_DIR,
    sanitizePathPart(context.runId),
    `${sanitizePathPart(context.toolCallId)}-${sanitizePathPart(context.toolName)}.txt`
  );
  const filePath = join(context.workspacePath, relativePath);
  await mkdir(join(context.workspacePath, TOOL_RESULT_SPILL_DIR, sanitizePathPart(context.runId)), {
    recursive: true
  });
  await writeFile(filePath, text, "utf8");
  log.warn("[tool-result-spill] 工具结果过长，已写入工作区文件", {
    runId: context.runId,
    toolCallId: context.toolCallId,
    toolName: context.toolName,
    chars: text.length,
    filePath
  });
  return { summary: buildSummary(text, relativePath, context), filePath };
}

function collectText(content: AgentToolResult<unknown>["content"]): string {
  return content
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

function buildSummary(text: string, relativePath: string, context: ToolResultSpillContext): string {
  const head = text.slice(0, TOOL_RESULT_PREVIEW_CHARS);
  const tail = text.slice(-TOOL_RESULT_PREVIEW_CHARS);
  return [
    `工具 ${context.toolName} 的${context.isError ? "错误" : "结果"}过长，已写入文件，未直接放入上下文。`,
    `完整结果路径：${relativePath}`,
    `完整结果字符数：${text.length}`,
    "",
    "你可以按需分段查看：",
    `- 读取开头：调用 Read，参数为 {"file_path":"${relativePath}","offset":1,"limit":120}`,
    `- 读取指定区间：调用 Read，参数为 {"file_path":"${relativePath}","offset":121,"limit":120}，并按需要调整 offset`,
    `- 搜索关键词：调用 Grep，参数为 {"path":"${TOOL_RESULT_SPILL_DIR}","pattern":"关键词"}`,
    "",
    "结果开头预览：",
    head,
    "",
    "结果末尾预览：",
    tail
  ].join("\n");
}

function buildFallbackSummary(text: string, context: ToolResultSpillContext): string {
  return [
    `工具 ${context.toolName} 的${context.isError ? "错误" : "结果"}过长，且写入结果文件失败。`,
    `完整结果字符数：${text.length}`,
    "为了保护模型上下文，这里只保留固定大小的开头和末尾预览。",
    "",
    "结果开头预览：",
    text.slice(0, TOOL_RESULT_PREVIEW_CHARS),
    "",
    "结果末尾预览：",
    text.slice(-TOOL_RESULT_PREVIEW_CHARS)
  ].join("\n");
}

function sanitizePathPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "unknown";
}
