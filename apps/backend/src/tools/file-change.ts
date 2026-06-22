import { createTwoFilesPatch } from "diff";
import type { FileChange, FileChangeOperation } from "@chengxiaobang/shared";

import { getLogger } from "../logging/logger";

const log = getLogger({ module: "tools/file-change" });

export const FILE_CHANGE_PATCH_MAX_BYTES = 512 * 1024;

export type ToolFileChangeDetails = Omit<FileChange, "operation" | "toolCallIds"> & {
  operation: Exclude<FileChangeOperation, "mixed">;
  beforeText: string;
  afterText: string;
};

export function buildToolFileChangeDetails(input: {
  path: string;
  operation: ToolFileChangeDetails["operation"];
  before: string;
  after: string;
}): ToolFileChangeDetails | undefined {
  const summary = buildFileChangeSummary(input);
  if (!summary) {
    return undefined;
  }
  return {
    ...summary,
    operation: input.operation,
    beforeText: input.before,
    afterText: input.after
  };
}

export function buildAggregatedFileChange(input: {
  path: string;
  operation: FileChangeOperation;
  before: string;
  after: string;
  toolCallIds: string[];
}): FileChange | undefined {
  const summary = buildFileChangeSummary(input);
  if (!summary) {
    return undefined;
  }
  return {
    ...summary,
    operation: input.operation,
    toolCallIds: input.toolCallIds
  };
}

function buildFileChangeSummary(input: {
  path: string;
  operation: FileChangeOperation;
  before: string;
  after: string;
}): Omit<FileChange, "toolCallIds"> | undefined {
  if (input.before === input.after) {
    log.info("[file-change] 文件内容无变化，跳过 diff", {
      path: input.path,
      operation: input.operation
    });
    return undefined;
  }
  let patch: string;
  try {
    patch = createTwoFilesPatch(
      input.path,
      input.path,
      input.before,
      input.after,
      undefined,
      undefined,
      { context: 3 }
    );
  } catch (error) {
    log.warn("[file-change] 生成文件 diff 失败", {
      path: input.path,
      operation: input.operation,
      error: error instanceof Error ? error.message : String(error)
    });
    return undefined;
  }
  const stats = changeStatsFromPatch(patch);
  const patchBytes = Buffer.byteLength(patch, "utf8");
  const truncated = patchBytes > FILE_CHANGE_PATCH_MAX_BYTES;
  const displayPatch = truncated ? truncateUtf8(patch, FILE_CHANGE_PATCH_MAX_BYTES) : patch;
  if (truncated) {
    log.warn("[file-change] 文件 diff 过大，已截断展示内容", {
      path: input.path,
      operation: input.operation,
      patchBytes,
      maxBytes: FILE_CHANGE_PATCH_MAX_BYTES,
      additions: stats.additions,
      deletions: stats.deletions
    });
  } else {
    log.info("[file-change] 已生成文件 diff", {
      path: input.path,
      operation: input.operation,
      patchBytes,
      additions: stats.additions,
      deletions: stats.deletions
    });
  }
  return {
    path: input.path,
    operation: input.operation,
    patch: displayPatch,
    additions: stats.additions,
    deletions: stats.deletions,
    ...(truncated ? { truncated } : {})
  };
}

export function mergeFileChangeOperation(
  current: FileChangeOperation | undefined,
  next: ToolFileChangeDetails["operation"]
): FileChangeOperation {
  if (!current) {
    return next;
  }
  return current === next ? current : "mixed";
}

export function changeStatsFromPatch(patch: string): { additions: number; deletions: number } {
  const stats = { additions: 0, deletions: 0 };
  for (const line of patch.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) {
      continue;
    }
    if (line.startsWith("+")) {
      stats.additions += 1;
    } else if (line.startsWith("-")) {
      stats.deletions += 1;
    }
  }
  return stats;
}

function truncateUtf8(text: string, maxBytes: number): string {
  let bytes = 0;
  let output = "";
  for (const char of text) {
    const charBytes = Buffer.byteLength(char, "utf8");
    if (bytes + charBytes > maxBytes) {
      break;
    }
    bytes += charBytes;
    output += char;
  }
  return `${output}\n\n（diff 内容过大，已截断）`;
}
