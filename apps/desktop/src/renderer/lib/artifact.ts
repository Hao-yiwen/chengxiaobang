import type { ToolCall } from "@chengxiaobang/shared";
import {
  basenameOf,
  isArtifactPreviewKind,
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

export interface ArtifactDeclaration extends Artifact {
  declarationStart: number;
  declarationEnd: number;
  groupStart: number;
  groupEnd: number;
}

export interface ArtifactDeclarationGroup {
  start: number;
  end: number;
  artifacts: Artifact[];
}

interface Range {
  start: number;
  end: number;
}

export interface ArtifactSourceMessage {
  id?: string;
  role: string;
  content?: string;
  createdAt?: string;
}

export interface CollectedArtifact extends Artifact {
  messageId?: string;
  toolCallId?: string;
  declaredAt?: string;
}

export type ArtifactDeclarationDiagnostic =
  | { type: "missing_path"; tag: string }
  | { type: "invalid_path"; path: string }
  | { type: "duplicate_path"; path: string };

export interface ParsedArtifactDeclarations {
  cleanMarkdown: string;
  artifacts: Artifact[];
  artifactDeclarations: ArtifactDeclaration[];
  declarationGroups: ArtifactDeclarationGroup[];
  diagnostics: ArtifactDeclarationDiagnostic[];
}

export interface CollectedArtifactDeclarations {
  artifacts: CollectedArtifact[];
  diagnostics: ArtifactDeclarationDiagnostic[];
}

export interface ArtifactCollectionLogContext {
  messageCount?: number;
  toolCallCount?: number;
  hasDeclarationMarkup?: boolean;
}

export type ArtifactSourceToolCall = Pick<
  ToolCall,
  "id" | "name" | "args" | "status" | "createdAt" | "updatedAt"
>;

const ARTIFACT_BLOCK_PATTERN = /<artifacts\b[^>]*>[\s\S]*?<\/artifacts>/giu;
const ARTIFACT_TAG_PATTERN = /<artifact\b[^>]*\/>/giu;
const ARTIFACT_DECLARATION_PATTERN =
  /<artifacts\b[^>]*>[\s\S]*?<\/artifacts>|<artifact\b[^>]*\/>/giu;

/** 面向产物协议的文件类型推导别名，实际预览类型仍由文件预览模块决定。 */
export function artifactKind(path: string): ArtifactKind {
  return previewKindForPath(path);
}

export function artifactFromPath(path: string): Artifact {
  return { path, name: basenameOf(path), kind: artifactKind(path) };
}

function artifactFromPathWithKind(path: string, kind: ArtifactKind): Artifact {
  return { path, name: basenameOf(path), kind };
}

function artifactFromDeclaredPath(path: string): Artifact | undefined {
  const kind = artifactKind(path);
  return isArtifactPreviewKind(kind) ? artifactFromPathWithKind(path, kind) : undefined;
}

export function parseArtifactDeclarations(markdown: string): ParsedArtifactDeclarations {
  const sourceMarkdown = stripTrailingPartialArtifactDeclaration(markdown);
  const artifacts: Artifact[] = [];
  const artifactDeclarations: ArtifactDeclaration[] = [];
  const declarationGroups: ArtifactDeclarationGroup[] = [];
  const diagnostics: ArtifactDeclarationDiagnostic[] = [];
  const removedRanges: Range[] = [];
  const blockRanges: Range[] = [];
  const seen = new Set<string>();

  const acceptTag = (tag: string): Artifact | undefined => {
    const path = pathAttribute(tag);
    if (path === undefined) {
      diagnostics.push({ type: "missing_path", tag });
      return undefined;
    }
    const normalized = normalizeArtifactPath(path);
    if (!normalized) {
      diagnostics.push({ type: "invalid_path", path });
      return undefined;
    }
    const artifact = artifactFromDeclaredPath(normalized);
    if (!artifact) {
      diagnostics.push({ type: "invalid_path", path: normalized });
      return undefined;
    }
    if (seen.has(normalized)) {
      diagnostics.push({ type: "duplicate_path", path: normalized });
      return undefined;
    }
    seen.add(normalized);
    artifacts.push(artifact);
    return artifact;
  };

  for (const blockMatch of sourceMarkdown.matchAll(ARTIFACT_BLOCK_PATTERN)) {
    if (blockMatch.index === undefined) {
      continue;
    }
    const block = blockMatch[0];
    const start = blockMatch.index;
    const end = start + block.length;
    blockRanges.push({ start, end });
    if (isIgnoredArtifactContext(sourceMarkdown, start)) {
      continue;
    }
    const groupArtifacts: Artifact[] = [];
    for (const tagMatch of block.matchAll(ARTIFACT_TAG_PATTERN)) {
      if (tagMatch.index === undefined) {
        continue;
      }
      const tag = tagMatch[0];
      const artifact = acceptTag(tag);
      if (!artifact) {
        continue;
      }
      const declarationStart = start + tagMatch.index;
      groupArtifacts.push(artifact);
      artifactDeclarations.push({
        ...artifact,
        declarationStart,
        declarationEnd: declarationStart + tag.length,
        groupStart: start,
        groupEnd: end
      });
    }
    if (groupArtifacts.length > 0) {
      declarationGroups.push({ start, end, artifacts: groupArtifacts });
      removedRanges.push({ start, end });
    }
  }

  for (const tagMatch of sourceMarkdown.matchAll(ARTIFACT_TAG_PATTERN)) {
    if (tagMatch.index === undefined) {
      continue;
    }
    const tag = tagMatch[0];
    const start = tagMatch.index;
    const end = start + tag.length;
    if (isIgnoredArtifactContext(sourceMarkdown, start) || isInsideRanges(start, blockRanges)) {
      continue;
    }
    const artifact = acceptTag(tag);
    if (!artifact) {
      continue;
    }
    artifactDeclarations.push({
      ...artifact,
      declarationStart: start,
      declarationEnd: end,
      groupStart: start,
      groupEnd: end
    });
    declarationGroups.push({ start, end, artifacts: [artifact] });
    removedRanges.push({ start, end });
  }

  return {
    cleanMarkdown: removeArtifactRanges(sourceMarkdown, removedRanges),
    artifacts,
    artifactDeclarations,
    declarationGroups,
    diagnostics
  };
}

export function cleanMarkdownForVerifiedArtifacts(
  markdown: string,
  parsed: ParsedArtifactDeclarations,
  verifiedArtifacts: Artifact[]
): string {
  const sourceMarkdown = stripTrailingPartialArtifactDeclaration(markdown);
  const verifiedPaths = new Set(verifiedArtifacts.map((artifact) => artifact.path));
  const verifiedRanges = parsed.declarationGroups
    .filter((group) => group.artifacts.every((artifact) => verifiedPaths.has(artifact.path)))
    .map(({ start, end }) => ({ start, end }));
  return removeArtifactRanges(sourceMarkdown, verifiedRanges);
}

export function collectArtifactsFromAssistantMessages(
  messages: ArtifactSourceMessage[]
): CollectedArtifactDeclarations {
  return collectArtifactsFromSession(messages);
}

export function collectArtifactsFromSession(
  messages: ArtifactSourceMessage[],
  toolCalls: ArtifactSourceToolCall[] = []
): CollectedArtifactDeclarations {
  const diagnostics: ArtifactDeclarationDiagnostic[] = [];
  const declared = collectDeclaredArtifacts(messages, diagnostics);
  const fallback = collectToolCallArtifacts(toolCalls, diagnostics);
  const seen = new Set<string>();
  const artifacts: CollectedArtifact[] = [];

  // 最终 XML 声明始终优先；工具历史只补足旧会话或未声明的可预览产物。
  for (const artifact of [...newestFirst(declared), ...newestFirst(fallback)]) {
    if (seen.has(artifact.path)) {
      diagnostics.push({ type: "duplicate_path", path: artifact.path });
      continue;
    }
    seen.add(artifact.path);
    artifacts.push(artifact);
  }

  return { artifacts, diagnostics };
}

export function hasArtifactDeclarationMarkup(messages: ArtifactSourceMessage[]): boolean {
  return messages.some(
    (message) =>
      message.role === "assistant" &&
      Boolean(message.content && hasParseableArtifactDeclaration(message.content))
  );
}

export function logArtifactDeclarationResult(
  source: string,
  parsed: ParsedArtifactDeclarations
): void {
  if (parsed.artifacts.length > 0) {
    console.info("[artifact] 已解析最终产物声明", artifactLogPayload({
      source,
      artifactCount: parsed.artifacts.length,
      paths: parsed.artifacts.map((artifact) => artifact.path)
    }));
  }
  for (const diagnostic of parsed.diagnostics) {
    console.warn("[artifact] 已忽略无效最终产物声明", artifactLogPayload({
      source,
      ...diagnostic
    }));
  }
}

export function logArtifactCollectionResult(
  source: string,
  collection: CollectedArtifactDeclarations,
  context: ArtifactCollectionLogContext = {}
): void {
  if (collection.artifacts.length > 0) {
    console.info("[artifact] 已汇总当前会话产物", artifactLogPayload({
      source,
      messageCount: context.messageCount,
      toolCallCount: context.toolCallCount,
      artifactCount: collection.artifacts.length,
      paths: collection.artifacts.map((artifact) => artifact.path)
    }));
  } else if (context.hasDeclarationMarkup) {
    console.warn("[artifact] 检测到最终产物声明但外侧面板没有可展示产物", artifactLogPayload({
      source,
      messageCount: context.messageCount,
      toolCallCount: context.toolCallCount,
      artifactCount: 0,
      diagnosticCount: collection.diagnostics.length
    }));
  }
  for (const diagnostic of collection.diagnostics) {
    console.warn("[artifact] 汇总当前会话产物时已忽略无效产物来源", artifactLogPayload({
      source,
      messageCount: context.messageCount,
      toolCallCount: context.toolCallCount,
      ...diagnostic
    }));
  }
}

function artifactLogPayload(payload: Record<string, unknown>): string {
  return JSON.stringify(payload);
}

function collectDeclaredArtifacts(
  messages: ArtifactSourceMessage[],
  diagnostics: ArtifactDeclarationDiagnostic[]
): CollectedArtifact[] {
  const declared: CollectedArtifact[] = [];
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
  return declared;
}

function collectToolCallArtifacts(
  toolCalls: ArtifactSourceToolCall[],
  diagnostics: ArtifactDeclarationDiagnostic[]
): CollectedArtifact[] {
  const artifacts: CollectedArtifact[] = [];
  for (const toolCall of toolCalls) {
    if (toolCall.status !== "completed") {
      continue;
    }
    const path =
      typeof toolCall.args.file_path === "string" ? toolCall.args.file_path : undefined;
    if (!path) {
      continue;
    }
    const normalized = normalizeArtifactPath(path);
    if (!normalized) {
      // 工具历史只是产物兜底；绝对路径常见于普通文件工具，静默跳过即可，
      // 避免渲染层在每次重算浮层时刷出大量无行动价值的诊断日志。
      continue;
    }
    const kind = toolArtifactKind(toolCall.name, normalized);
    if (!kind) {
      continue;
    }
    artifacts.push({
      ...artifactFromPathWithKind(normalized, kind),
      toolCallId: toolCall.id,
      declaredAt: toolCall.updatedAt || toolCall.createdAt
    });
  }
  return artifacts;
}

function toolArtifactKind(toolName: string, path: string): ArtifactKind | undefined {
  if (toolName !== "Write") {
    return undefined;
  }
  const kind = artifactKind(path);
  return isArtifactPreviewKind(kind) ? kind : undefined;
}

function newestFirst<T extends { declaredAt?: string }>(items: T[]): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const byDate = (right.item.declaredAt ?? "").localeCompare(left.item.declaredAt ?? "");
      return byDate || right.index - left.index;
    })
    .map(({ item }) => item);
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
    normalized === "..." ||
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
  if (blockStart > blockEnd && !isIgnoredArtifactContext(markdown, blockStart)) {
    return markdown.slice(0, blockStart);
  }

  const singleStart = markdown.lastIndexOf("<artifact");
  const singleEnd = markdown.lastIndexOf("/>");
  if (singleStart > singleEnd && !isIgnoredArtifactContext(markdown, singleStart)) {
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

function removeArtifactRanges(markdown: string, ranges: Range[]): string {
  if (ranges.length === 0) {
    return tidyMarkdownAfterArtifactRemoval(markdown);
  }
  const ordered = [...ranges].sort((left, right) => right.start - left.start);
  let cleanMarkdown = markdown;
  for (const range of ordered) {
    cleanMarkdown = `${cleanMarkdown.slice(0, range.start)}${cleanMarkdown.slice(range.end)}`;
  }
  return tidyMarkdownAfterArtifactRemoval(cleanMarkdown);
}

function isInsideRanges(offset: number, ranges: Range[]): boolean {
  return ranges.some((range) => offset >= range.start && offset < range.end);
}

function isInsideFence(markdown: string, offset: number): boolean {
  const before = markdown.slice(0, offset);
  const fences = before.match(/^```/gmu);
  return Boolean(fences && fences.length % 2 === 1);
}

function hasParseableArtifactDeclaration(markdown: string): boolean {
  for (const match of stripTrailingPartialArtifactDeclaration(markdown).matchAll(
    ARTIFACT_DECLARATION_PATTERN
  )) {
    if (match.index !== undefined && !isIgnoredArtifactContext(markdown, match.index)) {
      return true;
    }
  }
  return false;
}

function isIgnoredArtifactContext(markdown: string, offset: number): boolean {
  return isInsideFence(markdown, offset) || isInsideInlineCode(markdown, offset);
}

function isInsideInlineCode(markdown: string, offset: number): boolean {
  const lineStart = markdown.lastIndexOf("\n", offset - 1) + 1;
  const before = markdown.slice(lineStart, offset);
  let tickCount = 0;
  for (let index = 0; index < before.length; index += 1) {
    if (before[index] === "`" && before[index - 1] !== "\\") {
      tickCount += 1;
    }
  }
  return tickCount % 2 === 1;
}
