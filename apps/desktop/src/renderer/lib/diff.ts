import { parsePatchFiles, type FileContents, type FileDiffMetadata } from "@pierre/diffs";

export type DiffViewHeight = "inline" | "fill";

export interface TextDiffSource {
  kind: "text";
  fileName: string;
  oldText: string;
  newText: string;
  cacheKey: string;
}

export interface ParsedPatchDiffBlock {
  kind: "file";
  id: string;
  fileDiff: FileDiffMetadata;
}

export interface RawPatchDiffBlock {
  kind: "raw";
  id: string;
  raw: string;
  error: string;
}

export type PatchDiffBlock = ParsedPatchDiffBlock | RawPatchDiffBlock;

export function createTextDiffSource({
  fileName,
  oldText,
  newText,
  cacheKey
}: {
  fileName: string;
  oldText: string;
  newText: string;
  cacheKey: string;
}): TextDiffSource {
  return {
    kind: "text",
    fileName: normalizeDiffFileName(fileName),
    oldText,
    newText,
    cacheKey
  };
}

export function textDiffFiles(source: TextDiffSource): {
  oldFile: FileContents;
  newFile: FileContents;
} {
  return {
    oldFile: {
      name: source.fileName,
      contents: source.oldText,
      cacheKey: `${source.cacheKey}:old`
    },
    newFile: {
      name: source.fileName,
      contents: source.newText,
      cacheKey: `${source.cacheKey}:new`
    }
  };
}

/** 将后端返回的 unified patch 解析成 pierre 可渲染的单文件块；异常时保留原文兜底。 */
export function parseGitPatchDiff({
  patch,
  path,
  cacheKeyPrefix
}: {
  patch: string;
  path: string;
  cacheKeyPrefix: string;
}): PatchDiffBlock[] {
  if (patch.trim().length === 0) {
    return [];
  }
  const normalizedPatch = patch.endsWith("\n") ? patch : `${patch}\n`;
  try {
    const parsed = parsePatchFiles(normalizedPatch, cacheKeyPrefix, true);
    const blocks = parsed.flatMap((parsedPatch, patchIndex) =>
      parsedPatch.files.map((fileDiff, fileIndex) => ({
        kind: "file" as const,
        id: `${cacheKeyPrefix}:${patchIndex}:${fileIndex}`,
        fileDiff
      }))
    );
    if (blocks.length > 0) {
      return blocks;
    }
    return [{
      kind: "raw",
      id: `${cacheKeyPrefix}:raw`,
      raw: normalizedPatch,
      error: `没有解析到 ${path} 的文件 diff`
    }];
  } catch (error) {
    return [{
      kind: "raw",
      id: `${cacheKeyPrefix}:raw`,
      raw: normalizedPatch,
      error: error instanceof Error ? error.message : String(error)
    }];
  }
}

function normalizeDiffFileName(fileName: string): string {
  const trimmed = fileName.trim();
  return trimmed.length > 0 ? trimmed : "untitled";
}
