import {
  CaretDownIcon as ChevronDown,
  CircleNotchIcon as Loader2,
  FileTextIcon as FileText
} from "@phosphor-icons/react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ToolCall } from "@chengxiaobang/shared";
import { DiffView } from "@/components/DiffView";
import { artifactKind } from "@/lib/artifact";
import {
  buildToolCallDiff,
  formatDurationMs,
  shortenPath,
  toolCallDurationMs
} from "@/lib/tool-call";
import { toolIcon, toolLineLabel } from "@/lib/tool-display";
import { cn } from "@/lib/utils";

/** 可在右侧预览面板打开 path 参数的文件类工具。 */
const FILE_PREVIEW_TOOLS = new Set<ToolCall["name"]>(["read_file", "write_file", "edit_file"]);

export interface ToolCallLineProps {
  toolCall: ToolCall;
  onOpenFile?: (path: string, kind: ReturnType<typeof artifactKind>) => void;
}

/**
 * One borderless tool line, styled like the reasoning panel header: tool icon
 * in the chevron slot + a muted description that brightens on hover. Expands
 * on click to the raw result or, for edit/write, a diff. Used both inside
 * ToolCallGroup and as a standalone timeline row.
 */
export function ToolCallLine({ toolCall, onOpenFile }: ToolCallLineProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const ToolIcon = toolIcon(toolCall.name);
  const label = toolLineLabel(toolCall);
  const isRunning = toolCall.status === "running" || toolCall.status === "pending_approval";
  const isError = toolCall.status === "failed" || toolCall.status === "rejected";
  const filePath =
    onOpenFile && FILE_PREVIEW_TOOLS.has(toolCall.name) && typeof toolCall.args.path === "string"
      ? toolCall.args.path
      : undefined;
  const durationMs = toolCallDurationMs(toolCall);
  const diff = toolCall.status === "completed" ? buildToolCallDiff(toolCall) : undefined;
  const expandable = Boolean(toolCall.result || diff);

  return (
    <div className="max-w-full">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => expandable && setOpen((value) => !value)}
          className={cn(
            "flex min-w-0 items-center gap-1.5 py-0.5 text-left text-caption text-muted-foreground",
            expandable && "transition-colors hover:text-foreground"
          )}
        >
          {isRunning ? (
            <Loader2 className="size-3.5 flex-none animate-spin" />
          ) : (
            <ToolIcon className="size-3.5 flex-none" />
          )}
          <span className="min-w-0 truncate">{t(label.key, label.params)}</span>
          {toolCall.status === "pending_approval" ? (
            <span className="flex-none text-micro text-muted-slate">
              {t("chat.toolStatus.pendingApproval")}
            </span>
          ) : null}
          {isError ? (
            <span className="flex-none text-micro text-destructive">
              {t(toolCall.status === "failed" ? "chat.toolStatus.failed" : "chat.toolStatus.rejected")}
            </span>
          ) : null}
          {durationMs !== undefined ? (
            <span className="flex-none font-mono text-micro text-muted-slate/70">
              {formatDurationMs(durationMs)}
            </span>
          ) : null}
          {expandable ? (
            <ChevronDown
              className={cn(
                "size-3.5 flex-none transition-transform duration-200",
                !open && "-rotate-90"
              )}
            />
          ) : null}
        </button>
        {filePath ? (
          <button
            type="button"
            title={t("chat.previewFile")}
            onClick={() => onOpenFile?.(filePath, artifactKind(filePath))}
            className="flex max-w-[220px] flex-none items-center gap-1 font-mono text-micro text-muted-foreground transition-colors hover:text-link hover:underline"
          >
            <FileText className="size-3 flex-none" />
            <span className="truncate">{shortenPath(filePath)}</span>
          </button>
        ) : null}
      </div>
      {open && diff ? (
        <div className="mt-1 overflow-hidden rounded-sm border">
          <DiffView lines={diff} />
        </div>
      ) : open && toolCall.result ? (
        <pre className="mt-1 max-h-[220px] overflow-auto whitespace-pre-wrap break-words rounded-sm bg-muted/50 px-3 py-2 font-mono text-micro leading-relaxed text-muted-foreground">
          {toolCall.result}
        </pre>
      ) : null}
    </div>
  );
}
