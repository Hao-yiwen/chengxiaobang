import type { ComponentType } from "react";
import {
  AppWindowIcon,
  AudioWaveformIcon,
  CodeIcon,
  DocumentIcon,
  FileIcon,
  type FileIconSvgProps
} from "@/assets/file-type-icons";
import { previewKindForPath, type PreviewKind } from "../../common/file-preview";

type Icon = ComponentType<FileIconSvgProps>;

// 预览类型 → 内置图标的统一映射：artifact 卡片与正文行内文件链接共用，避免重复定义。
const KIND_ICON: Partial<Record<PreviewKind, Icon>> = {
  code: CodeIcon,
  markdown: CodeIcon,
  json: CodeIcon,
  html: CodeIcon,
  pdf: DocumentIcon,
  image: FileIcon,
  audio: AudioWaveformIcon,
  video: AppWindowIcon,
  spreadsheet: DocumentIcon,
  docx: DocumentIcon,
  presentation: DocumentIcon,
  text: DocumentIcon,
  unsupported: FileIcon
};

// 按预览类型取图标，未知类型回退到通用文本图标。
export function iconForKind(kind: PreviewKind): Icon {
  return KIND_ICON[kind] ?? FileIcon;
}

// 按文件路径取图标（可显式传入已知 kind 跳过推断）。
export function iconForPath(path: string, kind?: PreviewKind): Icon {
  return iconForKind(kind ?? previewKindForPath(path));
}
