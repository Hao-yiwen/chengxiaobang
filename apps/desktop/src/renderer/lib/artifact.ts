import type { ToolCall } from "@chengxiaobang/shared";

/** How a generated artifact opens in the right panel. */
export type ArtifactKind = "html" | "text" | "office";

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

const OFFICE_EXTENSIONS = new Set(["pptx", "ppt", "docx", "doc", "xlsx", "xls", "pdf"]);
const HTML_EXTENSIONS = new Set(["html", "htm", "svg"]);
// write_file is only treated as an artifact for these "deliverable" types —
// editing code (.ts/.py/…) stays a plain tool row, not a preview card.
const WRITE_FILE_ARTIFACT_EXTENSIONS = new Set([
  ...OFFICE_EXTENSIONS,
  ...HTML_EXTENSIONS,
  "md",
  "markdown",
  "csv"
]);

function extensionOf(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

/** Right-panel target for a file extension. */
export function artifactKind(path: string): ArtifactKind {
  const ext = extensionOf(path);
  if (HTML_EXTENSIONS.has(ext)) {
    return "html";
  }
  if (OFFICE_EXTENSIONS.has(ext)) {
    return "office";
  }
  return "text";
}

/**
 * The artifact a completed tool call produced, if it's one worth surfacing as
 * a preview card. create_* always count; write_file only for deliverable
 * file types (so ordinary code edits stay plain rows).
 */
export function artifactFromToolCall(toolCall: ToolCall): Artifact | undefined {
  if (toolCall.status !== "completed" || !ARTIFACT_TOOLS.has(toolCall.name)) {
    return undefined;
  }
  const path = typeof toolCall.args.path === "string" ? toolCall.args.path : undefined;
  if (!path) {
    return undefined;
  }
  if (toolCall.name === "write_file" && !WRITE_FILE_ARTIFACT_EXTENSIONS.has(extensionOf(path))) {
    return undefined;
  }
  return { path, name: path.split(/[\\/]/).pop() ?? path, kind: artifactKind(path) };
}
