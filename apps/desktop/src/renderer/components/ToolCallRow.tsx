import { Check, ChevronRight, FileText, Loader2, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ToolCall } from "@chengxiaobang/shared";
import { DiffView } from "@/components/DiffView";
import { buildToolCallDiff, formatDurationMs, toolCallDurationMs } from "@/lib/tool-call";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store";

const TOOL_STATUS_STYLES: Record<ToolCall["status"], string> = {
  completed: "text-foreground",
  failed: "text-destructive",
  rejected: "text-destructive",
  running: "text-muted-foreground",
  pending_approval: "text-foreground"
};

/** File tools whose `path` argument can be opened in the right-panel preview. */
const FILE_PREVIEW_TOOLS = new Set<ToolCall["name"]>(["read_file", "write_file", "edit_file"]);

/**
 * One collapsed tool invocation in the timeline: status, name, execution
 * duration, and an expandable body — a monochrome diff for file-mutating
 * tools, the raw result for everything else.
 */
export function ToolCallRow({ toolCall }: { toolCall: ToolCall }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const openFilePreview = useAppStore((state) => state.openFilePreview);
  const isRunning = toolCall.status === "running" || toolCall.status === "pending_approval";
  const isError = toolCall.status === "failed" || toolCall.status === "rejected";
  const accent = TOOL_STATUS_STYLES[toolCall.status] ?? "text-muted-foreground";
  const filePath =
    FILE_PREVIEW_TOOLS.has(toolCall.name) && typeof toolCall.args.path === "string"
      ? toolCall.args.path
      : undefined;
  const durationMs = toolCallDurationMs(toolCall);
  const diff = toolCall.status === "completed" ? buildToolCallDiff(toolCall) : undefined;
  const expandable = Boolean(toolCall.result || diff);
  return (
    <div className="mb-3 self-start overflow-hidden rounded-lg border bg-muted/40">
      <div className="flex items-center">
        <button
          type="button"
          onClick={() => expandable && setOpen((value) => !value)}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left font-mono text-xs",
            expandable && "transition-colors hover:bg-muted/70"
          )}
        >
          {isRunning ? (
            <Loader2 className={cn("size-3.5 flex-none animate-spin", accent)} />
          ) : isError ? (
            <X className={cn("size-3.5 flex-none", accent)} />
          ) : (
            <Check className={cn("size-3.5 flex-none", accent)} />
          )}
          <span className="font-semibold text-foreground">{toolCall.name}</span>
          <span className="text-muted-foreground">{toolCall.status}</span>
          {durationMs !== undefined ? (
            <span className="text-muted-foreground/70">
              {t("chat.toolDuration", { duration: formatDurationMs(durationMs) })}
            </span>
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
            className="mr-2 flex max-w-[220px] flex-none items-center gap-1 rounded-md border px-2 py-1 font-mono text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <FileText className="size-3 flex-none" />
            <span className="truncate">{filePath}</span>
          </button>
        ) : null}
      </div>
      {open && diff ? (
        <DiffView lines={diff} />
      ) : toolCall.result ? (
        open ? (
          <pre className="max-h-[180px] overflow-auto whitespace-pre-wrap break-words border-t bg-background/60 px-3 py-2 font-mono text-xs leading-relaxed text-muted-foreground">
            {toolCall.result}
          </pre>
        ) : (
          <pre className="max-h-[1.5rem] overflow-hidden whitespace-pre-wrap break-words border-t bg-background/60 px-3 py-1.5 font-mono text-xs leading-relaxed text-muted-foreground/70">
            {toolCall.result}
          </pre>
        )
      ) : null}
    </div>
  );
}
