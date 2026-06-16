import type { ToolCall } from "@chengxiaobang/shared";
import { createTextDiffSource, type TextDiffSource } from "./diff";

/** 已完成工具调用的执行耗时；基于 startedAt，避免把审批等待时间算进去。 */
export function toolCallDurationMs(toolCall: ToolCall): number | undefined {
  if (!toolCall.startedAt) {
    return undefined;
  }
  if (toolCall.status !== "completed" && toolCall.status !== "failed") {
    return undefined;
  }
  const ms = Date.parse(toolCall.updatedAt) - Date.parse(toolCall.startedAt);
  return Number.isFinite(ms) ? Math.max(0, ms) : undefined;
}

/** 320ms / 1.2s / 2m 5s. */
export function formatDurationMs(ms: number): string {
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  if (ms < 60_000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

/** 取最后几个路径片段用于紧凑展示，例如 "…/src/index.ts"。 */
export function shortenPath(path: string, segments = 2): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  if (parts.length <= segments) {
    return path;
  }
  return `…/${parts.slice(-segments).join("/")}`;
}

/** 文件写入类工具的文本 diff 源，直接由工具参数推导。 */
export function buildToolCallDiff(toolCall: ToolCall): TextDiffSource | undefined {
  if (toolCall.name === "Edit") {
    const { old_string, new_string } = toolCall.args;
    if (typeof old_string === "string" && typeof new_string === "string") {
      return createTextDiffSource({
        fileName: toolCallFileName(toolCall, "edit"),
        oldText: old_string,
        newText: new_string,
        cacheKey: `${toolCall.id}:${toolCall.updatedAt}:edit`
      });
    }
    return undefined;
  }
  if (toolCall.name === "Write" && typeof toolCall.args.content === "string") {
    return createTextDiffSource({
      fileName: toolCallFileName(toolCall, "write"),
      oldText: "",
      newText: toolCall.args.content,
      cacheKey: `${toolCall.id}:${toolCall.updatedAt}:write`
    });
  }
  return undefined;
}

function toolCallFileName(toolCall: ToolCall, fallback: string): string {
  const filePath = toolCall.args.file_path;
  return typeof filePath === "string" && filePath.trim().length > 0 ? filePath : fallback;
}
