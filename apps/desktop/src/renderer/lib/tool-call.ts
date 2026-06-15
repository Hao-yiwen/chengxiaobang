import type { ToolCall } from "@chengxiaobang/shared";
import { diffLines, type DiffLine } from "./diff";

/**
 * Execution duration of a finished tool call. Based on startedAt (set when
 * execution actually begins) so approval wait is excluded; undefined for
 * unfinished calls and for rows persisted before startedAt existed.
 */
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

/** Last `segments` path segments for compact display ("…/src/index.ts"). */
export function shortenPath(path: string, segments = 2): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  if (parts.length <= segments) {
    return path;
  }
  return `…/${parts.slice(-segments).join("/")}`;
}

/**
 * Diff presentation for file-mutating tools, derived purely from their args
 * (Edit carries old_string/new_string; Write content counts as all-added).
 */
export function buildToolCallDiff(toolCall: ToolCall): DiffLine[] | undefined {
  if (toolCall.name === "Edit") {
    const { old_string, new_string } = toolCall.args;
    if (typeof old_string === "string" && typeof new_string === "string") {
      return diffLines(old_string, new_string);
    }
    return undefined;
  }
  if (toolCall.name === "Write" && typeof toolCall.args.content === "string") {
    return diffLines("", toolCall.args.content);
  }
  return undefined;
}
