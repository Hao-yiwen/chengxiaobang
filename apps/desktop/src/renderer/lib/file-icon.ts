import type { ComponentType } from "react";
import {
  AppWindowIcon,
  AudioWaveformIcon,
  DefaultIcon,
  ExcelDocumentIcon,
  FileIcon,
  ImageFileColorIcon,
  PdfIcon,
  PowerpointFileRedIcon,
  WordDocumentFileIcon,
  type FileIconSvgProps
} from "@/assets/file-type-icons";
import { previewKindForPath, type PreviewKind } from "../../common/file-preview";
import { resolveFileTypeIcon } from "./code-language-icons";

type Icon = ComponentType<FileIconSvgProps>;

// 预览类型 → 新文件图标映射：浮层产物与正文行内文件链接共用，避免回到旧的灰色文档图标。
const KIND_ICON: Record<PreviewKind, Icon> = {
  code: DefaultIcon,
  markdown: DefaultIcon,
  json: DefaultIcon,
  html: DefaultIcon,
  pdf: PdfIcon,
  image: ImageFileColorIcon,
  audio: AudioWaveformIcon,
  video: AppWindowIcon,
  spreadsheet: ExcelDocumentIcon,
  docx: WordDocumentFileIcon,
  presentation: PowerpointFileRedIcon,
  text: FileIcon,
  unsupported: FileIcon
};

// 按预览类型取图标，未知类型回退到通用文本图标。
export function iconForKind(kind: PreviewKind, path?: string): Icon {
  if (kind === "code" || kind === "markdown" || kind === "json" || kind === "html") {
    return resolveFileTypeIcon(path);
  }
  return KIND_ICON[kind];
}

// 按文件路径取图标（可显式传入已知 kind 跳过推断）。
export function iconForPath(path: string, kind?: PreviewKind): Icon {
  return iconForKind(kind ?? previewKindForPath(path), path);
}
