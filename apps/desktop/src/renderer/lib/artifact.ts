import {
  basenameOf,
  isAbsolutePathLike,
  previewKindForPath,
  type PreviewKind
} from "../../common/file-preview";

/** 生成物在右侧文件预览工作台里的分类。 */
export type ArtifactKind = PreviewKind;

export interface Artifact {
  /** 模型声明中的项目相对路径。 */
  path: string;
  /** 用于界面展示的文件名。 */
  name: string;
  kind: ArtifactKind;
}

export interface ArtifactSourceMessage {
  id?: string;
  role: string;
  content?: string;
  createdAt?: string;
}

export interface CollectedArtifact extends Artifact {
  messageId?: string;
  declaredAt?: string;
}

export type ArtifactDeclarationDiagnostic =
  | { type: "missing_path"; tag: string }
  | { type: "invalid_path"; path: string }
  | { type: "duplicate_path"; path: string };

export interface ParsedArtifactDeclarations {
  cleanMarkdown: string;
  artifacts: Artifact[];
  diagnostics: ArtifactDeclarationDiagnostic[];
}

export interface CollectedArtifactDeclarations {
  artifacts: CollectedArtifact[];
  diagnostics: ArtifactDeclarationDiagnostic[];
}

/** 面向产物协议的文件类型推导别名，实际预览类型仍由文件预览模块决定。 */
export function artifactKind(path: string): ArtifactKind {
  return previewKindForPath(path);
}

export function artifactFromPath(path: string): Artifact {
  return { path, name: basenameOf(path), kind: artifactKind(path) };
}

export function parseArtifactDeclarations(markdown: string): ParsedArtifactDeclarations {
  const artifacts: Artifact[] = [];
  const diagnostics: ArtifactDeclarationDiagnostic[] = [];
  const seen = new Set<string>();

  const acceptTag = (tag: string) => {
    const path = pathAttribute(tag);
    if (path === undefined) {
      diagnostics.push({ type: "missing_path", tag });
      return;
    }
    const normalized = normalizeArtifactPath(path);
    if (!normalized) {
      diagnostics.push({ type: "invalid_path", path });
      return;
    }
    if (seen.has(normalized)) {
      diagnostics.push({ type: "duplicate_path", path: normalized });
      return;
    }
    seen.add(normalized);
    artifacts.push(artifactFromPath(normalized));
  };

  const blockPattern = /<artifacts\b[^>]*>[\s\S]*?<\/artifacts>/giu;
  let cleanMarkdown = stripTrailingPartialArtifactDeclaration(markdown).replace(
    blockPattern,
    (block, offset: number) => {
      if (isInsideFence(markdown, offset)) {
        return block;
      }
      for (const tag of block.matchAll(/<artifact\b[^>]*\/>/giu)) {
        acceptTag(tag[0]);
      }
      return "";
    }
  );

  cleanMarkdown = cleanMarkdown.replace(/<artifact\b[^>]*\/>/giu, (tag, offset: number) => {
    if (isInsideFence(cleanMarkdown, offset)) {
      return tag;
    }
    acceptTag(tag);
    return "";
  });

  return {
    cleanMarkdown: tidyMarkdownAfterArtifactRemoval(cleanMarkdown),
    artifacts,
    diagnostics
  };
}

export function collectArtifactsFromAssistantMessages(
  messages: ArtifactSourceMessage[]
): CollectedArtifactDeclarations {
  const declared: CollectedArtifact[] = [];
  const diagnostics: ArtifactDeclarationDiagnostic[] = [];

  for (const message of messages) {
    if (message.role !== "assistant" || !message.content) {
      continue;
    }
    const parsed = parseArtifactDeclarations(message.content);
    diagnostics.push(...parsed.diagnostics);
    for (const artifact of parsed.artifacts) {
      declared.push({
        ...artifact,
        ...(message.id ? { messageId: message.id } : {}),
        ...(message.createdAt ? { declaredAt: message.createdAt } : {})
      });
    }
  }

  const seen = new Set<string>();
  const artifacts: CollectedArtifact[] = [];
  // 会话面板展示“最新声明优先”，同一路径只保留最后一次最终声明。
  for (let index = declared.length - 1; index >= 0; index -= 1) {
    const artifact = declared[index];
    if (seen.has(artifact.path)) {
      diagnostics.push({ type: "duplicate_path", path: artifact.path });
      continue;
    }
    seen.add(artifact.path);
    artifacts.push(artifact);
  }

  return { artifacts, diagnostics };
}

export function logArtifactDeclarationResult(
  source: string,
  parsed: ParsedArtifactDeclarations
): void {
  if (parsed.artifacts.length > 0) {
    console.info("[artifact] 已解析最终产物声明", {
      source,
      count: parsed.artifacts.length,
      paths: parsed.artifacts.map((artifact) => artifact.path)
    });
  }
  for (const diagnostic of parsed.diagnostics) {
    console.warn("[artifact] 已忽略无效最终产物声明", {
      source,
      ...diagnostic
    });
  }
}

export function logArtifactCollectionResult(
  source: string,
  collection: CollectedArtifactDeclarations
): void {
  if (collection.artifacts.length > 0) {
    console.info("[artifact] 已汇总当前会话产物", {
      source,
      count: collection.artifacts.length,
      paths: collection.artifacts.map((artifact) => artifact.path)
    });
  }
  for (const diagnostic of collection.diagnostics) {
    console.warn("[artifact] 汇总当前会话产物时已忽略声明", {
      source,
      ...diagnostic
    });
  }
}

function pathAttribute(tag: string): string | undefined {
  const match = tag.match(/\bpath\s*=\s*(?:"([^"]*)"|'([^']*)')/iu);
  const value = match?.[1] ?? match?.[2];
  return value === undefined ? undefined : decodeXmlAttribute(value);
}

function normalizeArtifactPath(path: string): string | undefined {
  const trimmed = path.trim();
  if (!trimmed || /[\u0000\r\n<>]/u.test(trimmed)) {
    return undefined;
  }
  const normalized = trimmed.replace(/\\/gu, "/").replace(/\/+/gu, "/");
  if (
    isAbsolutePathLike(normalized) ||
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("/../") ||
    normalized.endsWith("/..")
  ) {
    return undefined;
  }
  return normalized.replace(/^\.\//u, "");
}

function decodeXmlAttribute(value: string): string {
  return value
    .replace(/&quot;/giu, "\"")
    .replace(/&apos;/giu, "'")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&amp;/giu, "&");
}

function stripTrailingPartialArtifactDeclaration(markdown: string): string {
  const blockStart = markdown.lastIndexOf("<artifacts");
  const blockEnd = markdown.lastIndexOf("</artifacts>");
  if (blockStart > blockEnd && !isInsideFence(markdown, blockStart)) {
    return markdown.slice(0, blockStart);
  }

  const singleStart = markdown.lastIndexOf("<artifact");
  const singleEnd = markdown.lastIndexOf("/>");
  if (singleStart > singleEnd && !isInsideFence(markdown, singleStart)) {
    return markdown.slice(0, singleStart);
  }
  return markdown;
}

function tidyMarkdownAfterArtifactRemoval(markdown: string): string {
  return markdown
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trimEnd();
}

function isInsideFence(markdown: string, offset: number): boolean {
  const before = markdown.slice(0, offset);
  const fences = before.match(/^```/gmu);
  return Boolean(fences && fences.length % 2 === 1);
}
