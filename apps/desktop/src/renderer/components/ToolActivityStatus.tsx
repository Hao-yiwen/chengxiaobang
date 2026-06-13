import { CircleNotchIcon as Loader2 } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import type { ToolActivity, ToolCall } from "@chengxiaobang/shared";
import { toolLineLabel, type ToolLineLabel } from "@/lib/tool-display";
import { cn } from "@/lib/utils";

interface ToolActivityStatusProps {
  toolActivity?: ToolActivity;
  runningTool?: ToolCall;
  className?: string;
}

type ActivityStatus =
  | { stage: "preparing"; label?: ToolLineLabel }
  | { stage: "running"; label: ToolLineLabel };

export function ToolActivityStatus({
  toolActivity,
  runningTool,
  className
}: ToolActivityStatusProps) {
  const { t } = useTranslation();
  const status = deriveActivityStatus(toolActivity, runningTool);
  if (!status) {
    return null;
  }
  const detail = status.label ? t(status.label.key, status.label.params) : undefined;
  const text = detail
    ? t(
        status.stage === "running"
          ? "chat.toolActivity.runningWithTool"
          : "chat.toolActivity.preparingWithTool",
        { tool: detail }
      )
    : t("chat.toolActivity.preparing");

  return (
    <div
      data-testid="tool-activity-status"
      aria-live="polite"
      className={cn(
        "flex min-w-0 items-center gap-2 rounded-sm border border-border bg-muted/35 px-2.5 py-1.5 text-caption text-muted-foreground",
        className
      )}
    >
      <Loader2 className="size-3.5 flex-none animate-spin" />
      <span className="min-w-0 truncate">{text}</span>
    </div>
  );
}

function deriveActivityStatus(
  toolActivity?: ToolActivity,
  runningTool?: ToolCall
): ActivityStatus | undefined {
  if (runningTool) {
    return { stage: "running", label: toolLineLabel(runningTool) };
  }
  if (!toolActivity) {
    return undefined;
  }
  const previewTool = toolActivityToToolCall(toolActivity);
  return {
    stage: "preparing",
    ...(previewTool ? { label: toolLineLabel(previewTool) } : {})
  };
}

function toolActivityToToolCall(activity: ToolActivity): ToolCall | undefined {
  if (!activity.name) {
    return undefined;
  }
  return {
    id: activity.toolCallId ?? `tool_activity_${activity.contentIndex}`,
    runId: "tool_activity",
    name: activity.name,
    args: activity.argsPreview,
    status: "running",
    createdAt: activity.updatedAt,
    updatedAt: activity.updatedAt
  };
}
