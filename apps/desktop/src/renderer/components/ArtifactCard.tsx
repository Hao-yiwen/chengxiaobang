import {
  ArrowUpRight,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  Globe,
  Presentation,
  type LucideIcon
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ToolCall } from "@chengxiaobang/shared";
import type { Artifact } from "@/lib/artifact";
import { useAppStore } from "@/store";

const TOOL_ICON: Partial<Record<ToolCall["name"], LucideIcon>> = {
  create_pptx: Presentation,
  create_docx: FileText,
  create_xlsx: FileSpreadsheet
};

/**
 * A generated deliverable (PPT / Word / Excel / HTML …) surfaced as a card:
 * filename + type, clickable to preview on the right (HTML renders in the
 * browser panel, office files open in the system app).
 */
export function ArtifactCard({ artifact, toolName }: { artifact: Artifact; toolName: ToolCall["name"] }) {
  const { t } = useTranslation();
  const openArtifact = useAppStore((state) => state.openArtifact);
  const Icon = TOOL_ICON[toolName] ?? (artifact.kind === "html" ? Globe : FileText);
  const opensExternally = artifact.kind === "office";
  return (
    <button
      type="button"
      onClick={() => openArtifact(artifact.path, artifact.kind)}
      className="group mb-3 flex w-full max-w-[420px] items-center gap-3 self-start rounded-lg border bg-card px-3.5 py-3 text-left transition-colors hover:border-primary/40"
    >
      <span className="flex size-9 flex-none items-center justify-center rounded-sm bg-soft-stone text-ink">
        <Icon className="size-[18px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-caption font-medium text-foreground">
          {artifact.name}
        </span>
        <span className="block text-micro text-muted-foreground">
          {opensExternally ? t("chat.artifactOpenExternal") : t("chat.artifactPreview")}
        </span>
      </span>
      {opensExternally ? (
        <ExternalLink className="size-4 flex-none text-muted-foreground transition-colors group-hover:text-action-blue" />
      ) : (
        <ArrowUpRight className="size-4 flex-none text-muted-foreground transition-colors group-hover:text-action-blue" />
      )}
    </button>
  );
}
