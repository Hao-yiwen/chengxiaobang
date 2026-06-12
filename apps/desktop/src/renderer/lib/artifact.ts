import type { ToolCall } from "@chengxiaobang/shared";
import {
  basenameOf,
  extensionOf,
  previewKindForPath,
  type PreviewKind
} from "../../common/file-preview";

/** 生成物在右侧文件预览工作台里的分类。 */
export type ArtifactKind = PreviewKind;

export interface Artifact {
  /** Path as the tool received it (relative to the project, or absolute). */
  path: string;
  /** Basename for display. */
  name: string;
  kind: ArtifactKind;
}

/** Tools whose successful result is a file the user will want to open. */
const ARTIFACT_TOOLS = new Set<ToolCall["name"]>([
  "create_pptx",
  "create_docx",
  "create_xlsx",
  "write_file"
]);

// write_file is only treated as an artifact for these "deliverable" types —
// editing code (.ts/.py/…) stays a plain tool row, not a preview card.
const WRITE_FILE_ARTIFACT_EXTENSIONS = new Set([
  "pptx",
  "ppt",
  "docx",
  "doc",
  "xlsx",
  "xls",
  "xlsm",
  "pdf",
  "html",
  "htm",
  "svg",
  "md",
  "markdown",
  "csv",
  "tsv",
  "json",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "mp3",
  "wav",
  "mp4",
  "webm",
  "mov"
]);

/** Right-panel target for a file extension. Kept as the artifact-facing alias. */
export function artifactKind(path: string): ArtifactKind {
  return previewKindForPath(path);
}

/**
 * Whether this call targets a deliverable file, regardless of status.
 * Grouping uses this so a running create_* or write_file stays out of tool
 * groups instead of splitting one when it completes into an ArtifactCard.
 */
export function isDeliverableToolCall(toolCall: ToolCall): boolean {
  if (!ARTIFACT_TOOLS.has(toolCall.name)) {
    return false;
  }
  const path = typeof toolCall.args.path === "string" ? toolCall.args.path : undefined;
  if (!path) {
    return false;
  }
  return toolCall.name !== "write_file" || WRITE_FILE_ARTIFACT_EXTENSIONS.has(extensionOf(path));
}

/**
 * The artifact a completed tool call produced, if it's one worth surfacing as
 * a preview card. create_* always count; write_file only for deliverable
 * file types (so ordinary code edits stay plain rows).
 */
export function artifactFromToolCall(toolCall: ToolCall): Artifact | undefined {
  if (toolCall.status !== "completed" || !isDeliverableToolCall(toolCall)) {
    return undefined;
  }
  const path = toolCall.args.path as string;
  return { path, name: basenameOf(path), kind: artifactKind(path) };
}
