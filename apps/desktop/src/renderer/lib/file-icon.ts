import {
  FileAudioIcon as FileAudio,
  FileCodeIcon as FileCode,
  FileDocIcon as FileDoc,
  FileHtmlIcon as FileHtml,
  FileImageIcon as FileImage,
  FilePdfIcon as FilePdf,
  FilePptIcon as FilePpt,
  FileTextIcon as FileText,
  FileVideoIcon as FileVideo,
  FileXlsIcon as FileSpreadsheet,
  type Icon
} from "@phosphor-icons/react";
import { previewKindForPath, type PreviewKind } from "../../common/file-preview";

// 预览类型 → phosphor 图标的统一映射：artifact 卡片与正文行内文件链接共用，避免重复定义。
const KIND_ICON: Partial<Record<PreviewKind, Icon>> = {
  code: FileCode,
  markdown: FileText,
  json: FileCode,
  html: FileHtml,
  pdf: FilePdf,
  image: FileImage,
  audio: FileAudio,
  video: FileVideo,
  spreadsheet: FileSpreadsheet,
  docx: FileDoc,
  presentation: FilePpt,
  text: FileText,
  unsupported: FileText
};

// 按预览类型取图标，未知类型回退到通用文本图标。
export function iconForKind(kind: PreviewKind): Icon {
  return KIND_ICON[kind] ?? FileText;
}

// 按文件路径取图标（可显式传入已知 kind 跳过推断）。
export function iconForPath(path: string, kind?: PreviewKind): Icon {
  return iconForKind(kind ?? previewKindForPath(path));
}
