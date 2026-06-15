import {
  ArrowUpRightIcon as ArrowUpRight,
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
import { useTranslation } from "react-i18next";
import type { Artifact } from "@/lib/artifact";
import { useAppStore } from "@/store";

const KIND_ICON: Partial<Record<Artifact["kind"], Icon>> = {
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

/**
 * 生成物卡片：无论是 HTML、PDF、Office 还是媒体，都统一进入右侧文件预览工作台。
 */
export function ArtifactCard({ artifact }: { artifact: Artifact }) {
  const { t } = useTranslation();
  const openArtifact = useAppStore((state) => state.openArtifact);
  const Icon = KIND_ICON[artifact.kind] ?? FileText;
  return (
    <button
      type="button"
      onClick={() => openArtifact(artifact.path, artifact.kind)}
      className="group mb-3 flex w-full max-w-[420px] items-center gap-3 self-start rounded-lg border bg-card px-3.5 py-3 text-left transition-colors hover:border-primary/40"
    >
      <span className="flex size-9 flex-none items-center justify-center rounded-sm bg-canvas-soft-2 text-ink">
        <Icon className="size-[18px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-caption font-medium text-foreground">
          {artifact.name}
        </span>
        <span className="block text-micro text-muted-foreground">
          {t("chat.artifactPreview")}
        </span>
      </span>
      <ArrowUpRight className="size-4 flex-none text-muted-foreground transition-colors group-hover:text-link" />
    </button>
  );
}
