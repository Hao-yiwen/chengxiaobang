import {
  ChevronIcon,
  RefreshIcon
} from "@/assets/file-type-icons";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ToolCall } from "@chengxiaobang/shared";
import { CodeBlockPanel } from "@/components/CodeBlockPanel";
import { DiffView } from "@/components/DiffView";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { basenameOf } from "../../common/file-preview";
import { artifactKind, type ArtifactKind } from "@/lib/artifact";
import { iconForPath } from "@/lib/file-icon";
import {
  buildToolCallDiff,
  formatDurationMs,
  toolCallDurationMs
} from "@/lib/tool-call";
import {
  shouldHideRunningToolArgs,
  toolIcon,
  toolLineLabel,
  toolLineRunningLabel
} from "@/lib/tool-display";
import { cn } from "@/lib/utils";

type FilePreviewToolName = "Read" | "Write" | "Edit";
type FileActionLabelKey =
  | "chat.toolFileAction.Read"
  | "chat.toolFileAction.Write"
  | "chat.toolFileAction.Edit"
  | "chat.toolFileAction.ReadRunning"
  | "chat.toolFileAction.WriteRunning"
  | "chat.toolFileAction.EditRunning";

/** 可在右侧预览面板打开 path 参数的文件类工具。 */
const FILE_PREVIEW_TOOLS = new Set<string>(["Read", "Write", "Edit"]);

export interface ToolCallLineProps {
  toolCall: ToolCall;
  onOpenFile?: (path: string, kind: ArtifactKind) => void;
}

/**
 * 无边框工具行：图标占据折叠箭头槽位，摘要文本保持轻量。
 * 点击后展开工具详情；命令类工具会同时展示完整命令与执行产物。
 */
export function ToolCallLine({ toolCall, onOpenFile }: ToolCallLineProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const ToolIcon = toolIcon(toolCall.name);
  const isRunning =
    toolCall.status === "running" ||
    toolCall.status === "pending_approval" ||
    toolCall.status === "pending_smart_approval";
  const label = isRunning ? toolLineRunningLabel(toolCall) : toolLineLabel(toolCall);
  const hideRunningArgs = shouldHideRunningToolArgs(toolCall);
  const isError = toolCall.status === "failed" || toolCall.status === "rejected";
  const filePreviewToolName = fileToolName(toolCall.name);
  const filePath = previewFilePathForToolCall(toolCall, hideRunningArgs);
  const labelText = filePath && filePreviewToolName
    ? t(fileActionLabelKey(filePreviewToolName, isRunning))
    : t(label.key, label.params);
  const durationMs = toolCallDurationMs(toolCall);
  const diff = toolCall.status === "completed" ? buildToolCallDiff(toolCall) : undefined;
  const command = hideRunningArgs ? undefined : shellCommandDetail(toolCall);
  const result = typeof toolCall.result === "string" && toolCall.result.length > 0
    ? toolCall.result
    : undefined;
  const expandable = Boolean(command || result || diff);
  return (
    <div className="max-w-full">
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-expanded={expandable ? open : undefined}
          onClick={() => {
            if (!expandable) {
              return;
            }
            const nextOpen = !open;
            console.debug("[ToolCallLine] 切换工具详情", {
              toolCallId: toolCall.id,
              name: toolCall.name,
              open: nextOpen,
              hasCommand: Boolean(command),
              hasResult: Boolean(result),
              hasDiff: Boolean(diff)
            });
            setOpen(nextOpen);
          }}
          className={cn(
            "flex min-w-0 items-center gap-1.5 py-0.5 text-left text-caption text-muted-foreground",
            expandable && "transition-colors hover:text-foreground"
          )}
        >
          {isRunning ? (
            <RefreshIcon className="size-3.5 flex-none animate-spin" />
          ) : (
            <ToolIcon className="size-3.5 flex-none" />
          )}
          <span className="min-w-0 truncate">{labelText}</span>
          {toolCall.status === "pending_approval" ? (
            <span className="flex-none text-micro text-muted-slate">
              {t("chat.toolStatus.pendingApproval")}
            </span>
          ) : null}
          {toolCall.status === "pending_smart_approval" ? (
            <span className="flex-none text-micro text-muted-slate">
              {t("chat.toolStatus.pendingSmartApproval")}
            </span>
          ) : null}
          {isError ? (
            <span className="flex-none text-micro text-muted-slate">
              {t(toolCall.status === "failed" ? "chat.toolStatus.failed" : "chat.toolStatus.rejected")}
            </span>
          ) : null}
          {durationMs !== undefined ? (
            <span className="flex-none font-mono text-micro text-muted-slate/70">
              {formatDurationMs(durationMs)}
            </span>
          ) : null}
          {expandable ? (
            <ChevronIcon
              className={cn(
                "size-3.5 flex-none transition-transform duration-200",
                !open && "-rotate-90"
              )}
            />
          ) : null}
        </button>
        {filePath && onOpenFile ? <ToolFileButton path={filePath} onOpenFile={onOpenFile} /> : null}
      </div>
      {open && command ? (
        <div className="mt-1 space-y-2">
          <ToolDetailBlock label={t("chat.toolDetail.command")} content={command} />
          {result ? (
            <ToolDetailBlock
              label={t("chat.toolDetail.result")}
              content={result}
            />
          ) : null}
        </div>
      ) : open && diff ? (
        <div className="mt-1 overflow-hidden rounded-sm border">
          {diff.kind === "text" ? <DiffView source={diff} /> : <DiffView blocks={diff.blocks} />}
        </div>
      ) : open && result ? (
        <pre className="mt-1 max-h-[220px] overflow-auto whitespace-pre-wrap break-words rounded-sm bg-muted/50 px-3 py-2 font-mono text-micro leading-relaxed text-muted-foreground">
          {result}
        </pre>
      ) : null}
    </div>
  );
}

export function previewFilePathForToolCall(
  toolCall: ToolCall,
  hideRunningArgs = shouldHideRunningToolArgs(toolCall)
): string | undefined {
  if (hideRunningArgs || !FILE_PREVIEW_TOOLS.has(toolCall.name)) {
    return undefined;
  }
  const path = toolCall.args.file_path;
  return typeof path === "string" && path.length > 0 ? path : undefined;
}

export function fileToolName(name: string): FilePreviewToolName | undefined {
  return FILE_PREVIEW_TOOLS.has(name) ? (name as FilePreviewToolName) : undefined;
}

export function fileActionLabelKey(
  name: FilePreviewToolName,
  running: boolean
): FileActionLabelKey {
  if (running) {
    switch (name) {
      case "Read":
        return "chat.toolFileAction.ReadRunning";
      case "Write":
        return "chat.toolFileAction.WriteRunning";
      case "Edit":
        return "chat.toolFileAction.EditRunning";
    }
  }
  switch (name) {
    case "Read":
      return "chat.toolFileAction.Read";
    case "Write":
      return "chat.toolFileAction.Write";
    case "Edit":
      return "chat.toolFileAction.Edit";
  }
}

export function ToolFileButton({
  path,
  onOpenFile,
  className
}: {
  path: string;
  onOpenFile: (path: string, kind: ArtifactKind) => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const Icon = iconForPath(path);
  const fileName = basenameOf(path);

  return (
    <TooltipProvider delayDuration={900} skipDelayDuration={0}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={`${t("chat.previewFile")} ${fileName}`}
            onClick={() => onOpenFile(path, artifactKind(path))}
            className={cn(
              "flex max-w-[220px] flex-none items-center gap-1 text-caption text-muted-foreground transition-colors hover:text-link hover:underline",
              className
            )}
          >
            <Icon className="size-3.5 flex-none text-muted-foreground" aria-hidden />
            <span className="truncate">{fileName}</span>
          </button>
        </TooltipTrigger>
        <TooltipContent className="pointer-events-none max-w-[360px] break-all font-mono text-micro">
          {path}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function shellCommandDetail(toolCall: ToolCall): string | undefined {
  if (toolCall.name !== "Bash") {
    return undefined;
  }
  const command = toolCall.args.command;
  return typeof command === "string" && command.trim().length > 0 ? command : undefined;
}

function ToolDetailBlock({
  label,
  content
}: {
  label: string;
  content: string;
}) {
  return (
    <section className="min-w-0 space-y-1">
      <div className="text-micro font-medium text-muted-slate">{label}</div>
      <CodeBlockPanel
        ariaLabel={label}
        className="tool-call-code-block"
        code={content}
        language="bash"
      />
    </section>
  );
}
