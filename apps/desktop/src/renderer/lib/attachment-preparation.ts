import {
  createId,
  resolveModelInputModalities,
  type MessageAttachment,
  type ModelInputModality,
  type ProviderConfig,
  type RunImageAttachment
} from "@chengxiaobang/shared";
import {
  TEXT_PREVIEW_MAX_BYTES,
  isOfficePreviewKind,
  isTextualPreviewKind,
  previewKindForPath,
  type PreviewKind
} from "../../common/file-preview";

const DOCUMENT_TEXT_MAX_CHARS = 120_000;
const SPREADSHEET_MAX_ROWS_PER_SHEET = 200;
const SPREADSHEET_MAX_SHEETS = 8;
const PRESENTATION_MAX_SLIDES = 80;

export interface AttachmentDescriptor {
  path: string;
  name: string;
  size: number;
  kind?: PreviewKind;
  text?: string;
}

export interface PreparedAttachmentContext {
  textContext: string;
  nativeAttachments: RunImageAttachment[];
  warnings: string[];
  inputModalities: ModelInputModality[];
  supportsImage: boolean;
}

export interface PrepareAttachmentsOptions {
  attachments: AttachmentDescriptor[];
  provider: ProviderConfig;
  model?: string;
  bridge?: Window["chengxiaobang"];
  formatTextBlock?: (attachment: AttachmentDescriptor, text: string) => string;
}

export async function prepareAttachmentsForRun(
  options: PrepareAttachmentsOptions
): Promise<PreparedAttachmentContext> {
  const effectiveModel = options.model ?? options.provider.model;
  const inputModalities = resolveModelInputModalities(options.provider.kind, effectiveModel);
  const supportsImage = inputModalities.includes("image");
  const bridge = options.bridge;
  const textBlocks: string[] = [];
  const nativeAttachments: RunImageAttachment[] = [];
  const warnings: string[] = [];

  console.info("[attachment-prep] 开始准备附件", {
    providerId: options.provider.id,
    providerKind: options.provider.kind,
    model: effectiveModel,
    inputModalities,
    attachmentCount: options.attachments.length
  });

  for (const attachment of options.attachments) {
    const kind = attachment.kind ?? previewKindForPath(attachment.path);
    try {
      if (isTextualPreviewKind(kind)) {
        console.info("[attachment-prep] 文本附件读取", { path: attachment.path, kind });
        const text = await readTextAttachment(attachment, bridge);
        addTextBlock(textBlocks, options, attachment, text);
        continue;
      }

      if (isOfficePreviewKind(kind)) {
        console.info("[attachment-prep] 文档附件抽文本", { path: attachment.path, kind });
        const text = await readOfficeAttachmentText(attachment, kind, bridge);
        addTextBlock(textBlocks, options, attachment, text);
        continue;
      }

      if (kind === "image" || kind === "pdf") {
        if (supportsImage) {
          console.info("[attachment-prep] 附件按原生图片直传", {
            path: attachment.path,
            kind,
            model: effectiveModel
          });
          nativeAttachments.push(...(await prepareNativeImageAttachments(attachment, bridge)));
        } else {
          console.info("[attachment-prep] 附件按 OCR 文本化", {
            path: attachment.path,
            kind,
            model: effectiveModel
          });
          const result = await recognizeAttachmentText(attachment, bridge);
          addTextBlock(textBlocks, options, attachment, result.text);
          warnings.push(...result.warnings);
        }
        continue;
      }

      warnings.push(`跳过 ${attachment.name}：当前暂不支持把 ${kind} 文件作为上下文`);
      console.warn("[attachment-prep] 跳过不支持的附件", { path: attachment.path, kind });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`跳过 ${attachment.name}：${message}`);
      console.warn("[attachment-prep] 附件准备失败", {
        path: attachment.path,
        kind,
        error: message
      });
    }
  }

  console.info("[attachment-prep] 附件准备完成", {
    textBlocks: textBlocks.length,
    nativeAttachmentCount: nativeAttachments.length,
    warningCount: warnings.length
  });

  return {
    textContext: textBlocks.length > 0 ? textBlocks.join("\n") + "\n" : "",
    nativeAttachments,
    warnings,
    inputModalities,
    supportsImage
  };
}

export async function saveDisplayAttachmentSnapshots(
  attachments: AttachmentDescriptor[],
  bridge?: Window["chengxiaobang"]
): Promise<MessageAttachment[]> {
  if (attachments.length === 0) {
    return [];
  }
  console.info("[attachment-prep] 开始保存可见附件快照", {
    attachmentCount: attachments.length,
    totalBytes: attachments.reduce((total, attachment) => total + attachment.size, 0)
  });
  const result = await bridge?.saveAttachmentSnapshots?.(
    attachments.map((attachment) => attachment.path)
  );
  if (!result?.ok) {
    const error = result?.error ?? "附件快照保存服务不可用";
    console.warn("[attachment-prep] 可见附件快照保存失败", {
      attachmentCount: attachments.length,
      error
    });
    throw new Error(error);
  }
  console.info("[attachment-prep] 可见附件快照保存完成", {
    attachmentCount: result.attachments.length,
    totalBytes: result.totalBytes,
    elapsedMs: result.elapsedMs
  });
  return result.attachments;
}

function addTextBlock(
  textBlocks: string[],
  options: PrepareAttachmentsOptions,
  attachment: AttachmentDescriptor,
  text: string
): void {
  const normalized = trimDocumentText(text);
  if (!normalized) {
    throw new Error("没有读取到可用文本");
  }
  textBlocks.push(
    options.formatTextBlock?.(attachment, normalized) ?? defaultAttachmentBlock(attachment, normalized)
  );
}

function defaultAttachmentBlock(attachment: AttachmentDescriptor, text: string): string {
  return `以下是文件 ${attachment.name} 的内容：\n\`\`\`\n${text}\n\`\`\`\n`;
}

async function readTextAttachment(
  attachment: AttachmentDescriptor,
  bridge?: Window["chengxiaobang"]
): Promise<string> {
  if (attachment.text !== undefined) {
    return attachment.text;
  }
  const previewResult = await bridge?.readFilePreviewText?.(attachment.path, {
    maxBytes: TEXT_PREVIEW_MAX_BYTES
  });
  if (previewResult?.ok) {
    return previewResult.text;
  }
  const legacyResult = await bridge?.readFileText?.(attachment.path);
  if (legacyResult?.ok) {
    return legacyResult.text;
  }
  throw new Error(previewResult?.error ?? legacyResult?.error ?? "缺少文本读取能力");
}

async function readOfficeAttachmentText(
  attachment: AttachmentDescriptor,
  kind: PreviewKind,
  bridge?: Window["chengxiaobang"]
): Promise<string> {
  const buffer = await readAttachmentBuffer(attachment, bridge);
  if (kind === "docx") {
    return extractDocxText(buffer);
  }
  if (kind === "spreadsheet") {
    return extractSpreadsheetText(buffer);
  }
  if (kind === "presentation") {
    return extractPptxText(buffer);
  }
  throw new Error(`当前不支持解析 ${kind} 文档`);
}

async function readAttachmentBuffer(
  attachment: AttachmentDescriptor,
  bridge?: Window["chengxiaobang"]
): Promise<ArrayBuffer> {
  const result = await bridge?.readFilePreviewBuffer?.(attachment.path);
  if (!result?.ok) {
    throw new Error(result?.error ?? "缺少文档读取能力");
  }
  return result.data;
}

async function extractDocxText(data: ArrayBuffer): Promise<string> {
  const mammoth = (await import("mammoth")).default;
  const result = await mammoth.extractRawText({ arrayBuffer: data });
  return result.value;
}

async function extractSpreadsheetText(data: ArrayBuffer): Promise<string> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(data, { type: "array", cellDates: true });
  const chunks: string[] = [];
  for (const sheetName of workbook.SheetNames.slice(0, SPREADSHEET_MAX_SHEETS)) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) {
      continue;
    }
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      blankrows: false,
      defval: ""
    });
    const csv = rows
      .slice(0, SPREADSHEET_MAX_ROWS_PER_SHEET)
      .map((row) => row.map((cell) => String(cell)).join(", "))
      .join("\n");
    if (csv.trim()) {
      chunks.push(`【工作表 ${sheetName}】\n${csv}`);
    }
  }
  return chunks.join("\n\n");
}

async function extractPptxText(data: ArrayBuffer): Promise<string> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(data);
  const slideFiles = Object.values(zip.files)
    .filter((file) => /^ppt\/slides\/slide\d+\.xml$/u.test(file.name))
    .sort((left, right) => slideIndex(left.name) - slideIndex(right.name))
    .slice(0, PRESENTATION_MAX_SLIDES);
  const chunks: string[] = [];
  for (const file of slideFiles) {
    const xml = await file.async("text");
    const text = extractDrawingText(xml);
    if (text.trim()) {
      chunks.push(`【幻灯片 ${slideIndex(file.name)}】\n${text}`);
    }
  }
  return chunks.join("\n\n");
}

async function recognizeAttachmentText(
  attachment: AttachmentDescriptor,
  bridge?: Window["chengxiaobang"]
): Promise<{ text: string; warnings: string[] }> {
  const result = await bridge?.ocrRecognize?.(attachment.path);
  if (!result?.ok) {
    throw new Error(result?.error ?? "OCR 服务不可用");
  }
  return { text: result.text, warnings: result.warnings };
}

async function prepareNativeImageAttachments(
  attachment: AttachmentDescriptor,
  bridge?: Window["chengxiaobang"]
): Promise<RunImageAttachment[]> {
  const result = await bridge?.prepareNativeImages?.(attachment.path);
  if (!result?.ok) {
    throw new Error(result?.error ?? "原生图片准备服务不可用");
  }
  return result.images.map((image) => ({
    id: createId("attachment"),
    name: image.name,
    mimeType: image.mimeType,
    dataBase64: image.dataBase64,
    size: image.size
  }));
}

function trimDocumentText(text: string): string {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  return normalized.length > DOCUMENT_TEXT_MAX_CHARS
    ? `${normalized.slice(0, DOCUMENT_TEXT_MAX_CHARS)}\n\n（内容过长，已截断）`
    : normalized;
}

function extractDrawingText(xml: string): string {
  return [...xml.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/gu)]
    .map((match) => decodeXmlText(match[1]))
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeXmlText(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function slideIndex(name: string): number {
  const match = name.match(/slide(\d+)\.xml$/u);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}
