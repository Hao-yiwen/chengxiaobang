import { Check, ChevronRight, FileText, Loader2, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ToolCall } from "@chengxiaobang/shared";
import { DiffView } from "@/components/DiffView";
import {
  buildToolCallDiff,
  formatDurationMs,
  shortenPath,
  toolCallDurationMs
} from "@/lib/tool-call";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store";

const TOOL_STATUS_KEYS = {
  completed: "chat.toolStatus.completed",
  failed: "chat.toolStatus.failed",
  rejected: "chat.toolStatus.rejected",
  running: "chat.toolStatus.running",
  pending_approval: "chat.toolStatus.pendingApproval"
} as const satisfies Record<ToolCall["status"], string>;

/** File tools whose `path` argument can be opened in the right-panel preview. */
const FILE_PREVIEW_TOOLS = new Set<ToolCall["name"]>(["read_file", "write_file", "edit_file"]);

/**
 * One tool invocation in the timeline, in main's original card style:
 * status icon + name + localized status, a one-line result preview when
 * collapsed, the full result (or a diff for file-mutating tools) on click.
 */
export function ToolCallRow({ toolCall }: { toolCall: ToolCall }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const openFilePreview = useAppStore((state) => state.openFilePreview);
  const isRunning = toolCall.status === "running" || toolCall.status === "pending_approval";
  const isError = toolCall.status === "failed" || toolCall.status === "rejected";
  const filePath =
    FILE_PREVIEW_TOOLS.has(toolCall.name) && typeof toolCall.args.path === "string"
      ? toolCall.args.path
      : undefined;
  const durationMs = toolCallDurationMs(toolCall);
  const diff = toolCall.status === "completed" ? buildToolCallDiff(toolCall) : undefined;
  const expandable = Boolean(toolCall.result || diff);
  return (
    <div className="mb-3 max-w-full self-start overflow-hidden rounded-xl border bg-surface/60">
      <div className="flex items-center">
        <button
          type="button"
          onClick={() => expandable && setOpen((value) => !value)}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left font-mono text-xs",
            expandable && "transition-colors hover:bg-accent/60"
          )}
        >
          {isRunning ? (
            <Loader2 className="size-3.5 flex-none animate-spin text-muted-foreground" />
          ) : isError ? (
            <X className="size-3.5 flex-none text-destructive" />
          ) : (
            <Check className="size-3.5 flex-none text-muted-foreground" />
          )}
          <span className="font-semibold text-foreground">{toolCall.name}</span>
          <span className="text-muted-foreground">{t(TOOL_STATUS_KEYS[toolCall.status])}</span>
          {durationMs !== undefined ? (
            <span className="text-muted-foreground/60">{formatDurationMs(durationMs)}</span>
          ) : null}
          {expandable ? (
            <ChevronRight
              className={cn(
                "ml-auto size-3.5 flex-none text-muted-foreground transition-transform",
                open && "rotate-90"
              )}
            />
          ) : null}
        </button>
        {filePath ? (
          <button
            type="button"
            title={t("chat.previewFile")}
            onClick={() => openFilePreview(filePath)}
            className="mr-2.5 flex max-w-[220px] flex-none items-center gap-1 font-mono text-[11px] text-muted-foreground transition-colors hover:text-foreground hover:underline"
          >
            <FileText className="size-3 flex-none" />
            <span className="truncate">{shortenPath(filePath)}</span>
          </button>
        ) : null}
      </div>
      {open && diff ? (
        <DiffView lines={diff} />
      ) : toolCall.result ? (
        open ? (
          <pre className="max-h-[220px] overflow-auto whitespace-pre-wrap break-words border-t bg-background px-3 py-2 font-mono text-xs leading-relaxed text-muted-foreground">
            {toolCall.result}
          </pre>
        ) : (
          <pre className="max-h-[1.6rem] overflow-hidden whitespace-pre-wrap break-words border-t bg-background px-3 py-1.5 font-mono text-xs leading-relaxed text-muted-foreground/60">
            {toolCall.result}
          </pre>
        )
      ) : null}
    </div>
  );
}
