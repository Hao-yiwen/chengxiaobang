import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import type { PaddleOcrService as PaddleOcrServiceInstance } from "ppu-paddle-ocr";
import type { Sharp, SharpOptions } from "sharp";
import { previewKindForPath } from "../common/file-preview";
import type { TrustedIpcRegistrar } from "./trusted-ipc";

const OCR_MAX_PDF_PAGES = 10;
const OCR_IMAGE_MAX_SIDE = 1600;
const NATIVE_IMAGE_MAX_SIDE = 2048;
const NATIVE_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const OCR_MODEL_DIR_NAME = "pp-ocrv6-small";
type SharpFactory = (input?: string | Buffer, options?: SharpOptions) => Sharp;

export type OcrRecognizeResult =
  | {
      ok: true;
      path: string;
      name: string;
      text: string;
      size: number;
      pageCount: number;
      processedPages: number;
      warnings: string[];
      elapsedMs: number;
    }
  | { ok: false; path: string; name: string; error: string; size: number };

export interface NativeAttachmentImage {
  name: string;
  mimeType: string;
  dataBase64: string;
  size: number;
  pageIndex?: number;
}

export type PrepareNativeImagesResult =
  | {
      ok: true;
      path: string;
      name: string;
      size: number;
      images: NativeAttachmentImage[];
      pageCount: number;
      processedPages: number;
      warnings: string[];
      elapsedMs: number;
    }
  | { ok: false; path: string; name: string; error: string; size: number };

export interface OcrRuntimeOptions {
  appPath: string;
  resourcesPath: string;
  isPackaged: boolean;
}

let servicePromise: Promise<PaddleOcrServiceInstance> | undefined;

export function registerOcrIpc(ipcMain: TrustedIpcRegistrar, options: OcrRuntimeOptions): void {
  ipcMain.handle("ocr:recognize", (_event, target: unknown) => recognizePath(target, options));
  ipcMain.handle("attachment:prepare-native-images", (_event, target: unknown) =>
    prepareNativeImages(target, options)
  );
}

export async function recognizePath(
  target: unknown,
  options: OcrRuntimeOptions
): Promise<OcrRecognizeResult> {
  const path = typeof target === "string" ? target : "";
  const name = basename(path);
  const startedAt = Date.now();
  if (!path) {
    console.warn("[ocr] OCR 请求收到无效路径");
    return { ok: false, path, name, error: "无效路径", size: 0 };
  }

  try {
    const info = await stat(path);
    const kind = previewKindForPath(path);
    console.info("[ocr] 开始识别附件", { path, kind, size: info.size });
    const pageBuffers =
      kind === "pdf"
        ? await renderPdfPages(path, OCR_IMAGE_MAX_SIDE, OCR_MAX_PDF_PAGES)
        : kind === "image"
          ? { pageCount: 1, buffers: [await normalizeImage(path, OCR_IMAGE_MAX_SIDE)] }
          : undefined;

    if (!pageBuffers) {
      console.warn("[ocr] 不支持的 OCR 文件类型", { path, kind });
      return { ok: false, path, name, error: "当前只支持图片和 PDF OCR", size: info.size };
    }

    const service = await getOcrService(options);
    const texts: string[] = [];
    for (const [index, buffer] of pageBuffers.buffers.entries()) {
      const result = await service.recognize(bufferToArrayBuffer(buffer), {
        noCache: true,
        strategy: "per-line"
      });
      const text = result.text.trim();
      if (text) {
        texts.push(pageBuffers.pageCount > 1 ? `【第 ${index + 1} 页】\n${text}` : text);
      }
    }
    const warnings =
      pageBuffers.pageCount > pageBuffers.buffers.length
        ? [`PDF 共 ${pageBuffers.pageCount} 页，本次只处理前 ${pageBuffers.buffers.length} 页`]
        : [];
    console.info("[ocr] 附件识别完成", {
      path,
      pageCount: pageBuffers.pageCount,
      processedPages: pageBuffers.buffers.length,
      textChars: texts.join("\n\n").length,
      elapsedMs: Date.now() - startedAt
    });
    return {
      ok: true,
      path,
      name,
      text: texts.join("\n\n"),
      size: info.size,
      pageCount: pageBuffers.pageCount,
      processedPages: pageBuffers.buffers.length,
      warnings,
      elapsedMs: Date.now() - startedAt
    };
  } catch (error) {
    const message = messageFromError(error);
    console.warn("[ocr] 附件识别失败", { path, error: message });
    return { ok: false, path, name, error: message, size: 0 };
  }
}

export async function prepareNativeImages(
  target: unknown,
  options: OcrRuntimeOptions
): Promise<PrepareNativeImagesResult> {
  const path = typeof target === "string" ? target : "";
  const name = basename(path);
  const startedAt = Date.now();
  if (!path) {
    console.warn("[attachment] 原生图片准备收到无效路径");
    return { ok: false, path, name, error: "无效路径", size: 0 };
  }

  try {
    const info = await stat(path);
    const kind = previewKindForPath(path);
    console.info("[attachment] 开始准备原生图片附件", { path, kind, size: info.size });
    const pageBuffers =
      kind === "pdf"
        ? await renderPdfPages(path, NATIVE_IMAGE_MAX_SIDE, OCR_MAX_PDF_PAGES)
        : kind === "image"
          ? { pageCount: 1, buffers: [await normalizeImage(path, NATIVE_IMAGE_MAX_SIDE)] }
          : undefined;
    if (!pageBuffers) {
      console.warn("[attachment] 不支持原生图片直传的文件类型", { path, kind });
      return { ok: false, path, name, error: "当前只支持图片和 PDF 转图片", size: info.size };
    }

    const images = pageBuffers.buffers.map((buffer, index) => ({
      name: pageBuffers.pageCount > 1 ? `${name} 第 ${index + 1} 页` : name,
      mimeType: "image/jpeg",
      dataBase64: buffer.toString("base64"),
      size: buffer.byteLength,
      ...(pageBuffers.pageCount > 1 ? { pageIndex: index } : {})
    }));
    const warnings =
      pageBuffers.pageCount > pageBuffers.buffers.length
        ? [`PDF 共 ${pageBuffers.pageCount} 页，本次只处理前 ${pageBuffers.buffers.length} 页`]
        : [];
    console.info("[attachment] 原生图片附件准备完成", {
      path,
      pageCount: pageBuffers.pageCount,
      processedPages: pageBuffers.buffers.length,
      totalBytes: images.reduce((total, image) => total + image.size, 0),
      elapsedMs: Date.now() - startedAt
    });
    return {
      ok: true,
      path,
      name,
      size: info.size,
      images,
      pageCount: pageBuffers.pageCount,
      processedPages: pageBuffers.buffers.length,
      warnings,
      elapsedMs: Date.now() - startedAt
    };
  } catch (error) {
    const message = messageFromError(error);
    console.warn("[attachment] 原生图片附件准备失败", { path, error: message });
    return { ok: false, path, name, error: message, size: 0 };
  }
}

async function getOcrService(options: OcrRuntimeOptions): Promise<PaddleOcrServiceInstance> {
  servicePromise ??= initializeOcrService(options);
  return servicePromise;
}

async function initializeOcrService(options: OcrRuntimeOptions): Promise<PaddleOcrServiceInstance> {
  const modelDir = ocrModelDir(options);
  const detection = join(modelDir, "det.onnx");
  const recognition = join(modelDir, "rec.onnx");
  const charactersDictionary = join(modelDir, "dict.txt");
  for (const file of [detection, recognition, charactersDictionary]) {
    if (!existsSync(file)) {
      console.error("[ocr] PP-OCRv6 small 模型资源缺失", { file, modelDir });
      throw new Error("PP-OCRv6 small 模型资源缺失，请先下载或重新打包 OCR 资源");
    }
  }
  const { PaddleOcrService } = await import("ppu-paddle-ocr");
  const service = new PaddleOcrService({
    model: { detection, recognition, charactersDictionary },
    processing: { engine: "opencv" },
    session: { executionProviders: ["cpu"], graphOptimizationLevel: "all" },
    debugging: { debug: false, verbose: false }
  });
  console.info("[ocr] 初始化 PP-OCRv6 small 服务", { modelDir });
  await service.initialize();
  console.info("[ocr] PP-OCRv6 small 服务初始化完成");
  return service;
}

function ocrModelDir(options: OcrRuntimeOptions): string {
  return options.isPackaged
    ? join(options.resourcesPath, "ocr", OCR_MODEL_DIR_NAME)
    : join(options.appPath, "assets", "ocr", OCR_MODEL_DIR_NAME);
}

async function renderPdfPages(
  path: string,
  maxSide: number,
  maxPages: number
): Promise<{ pageCount: number; buffers: Buffer[] }> {
  const canvasModule = await import("@napi-rs/canvas");
  ensurePdfCanvasGlobals(canvasModule);
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(await readFile(path));
  const pdf = await getDocument({
    data,
    useSystemFonts: true
  }).promise;
  const pageCount = Math.max(1, pdf.numPages);
  const processedPages = Math.min(pageCount, maxPages);
  const buffers: Buffer[] = [];
  for (let pageIndex = 0; pageIndex < processedPages; pageIndex += 1) {
    const page = await pdf.getPage(pageIndex + 1);
    const baseViewport = page.getViewport({ scale: 1 });
    const scale = Math.max(
      0.1,
      Math.min(2, maxSide / Math.max(baseViewport.width, baseViewport.height))
    );
    const viewport = page.getViewport({ scale });
    const canvas = canvasModule.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const canvasContext = canvas.getContext("2d");
    await page.render({ canvas: canvas as never, canvasContext: canvasContext as never, viewport }).promise;
    buffers.push(await normalizeImage(await canvas.encode("png"), maxSide));
  }
  await pdf.destroy();
  return { pageCount, buffers };
}

async function normalizeImage(
  input: string | Buffer,
  maxSide: number,
  inputOptions: SharpOptions = {}
): Promise<Buffer> {
  const sharp = await loadSharp();
  let quality = 88;
  let width = maxSide;
  let buffer = await sharp(input, inputOptions)
    .rotate()
    .resize({ width, height: width, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality, mozjpeg: true })
    .toBuffer();
  while (buffer.byteLength > NATIVE_IMAGE_MAX_BYTES && quality > 48) {
    quality -= 10;
    buffer = await sharp(input, inputOptions)
      .rotate()
      .resize({ width, height: width, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();
  }
  while (buffer.byteLength > NATIVE_IMAGE_MAX_BYTES && width > 1024) {
    width = Math.floor(width * 0.8);
    buffer = await sharp(input, inputOptions)
      .rotate()
      .resize({ width, height: width, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();
  }
  if (buffer.byteLength > NATIVE_IMAGE_MAX_BYTES) {
    throw new Error(`图片压缩后仍超过 ${Math.round(NATIVE_IMAGE_MAX_BYTES / 1024 / 1024)}MB`);
  }
  return buffer;
}

async function loadSharp(): Promise<SharpFactory> {
  const mod = await import("sharp");
  return ((mod as unknown as { default?: SharpFactory }).default ?? mod) as SharpFactory;
}

function ensurePdfCanvasGlobals(canvasModule: typeof import("@napi-rs/canvas")): void {
  const target = globalThis as Record<string, unknown>;
  target.DOMMatrix ??= canvasModule.DOMMatrix;
  target.ImageData ??= canvasModule.ImageData;
  target.Path2D ??= canvasModule.Path2D;
}

function bufferToArrayBuffer(buffer: Buffer): ArrayBuffer {
  const arrayBuffer = new ArrayBuffer(buffer.byteLength);
  new Uint8Array(arrayBuffer).set(buffer);
  return arrayBuffer;
}

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
