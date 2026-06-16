import {
  CaretDownIcon as ChevronDown,
  CircleNotchIcon as Loader2
} from "@phosphor-icons/react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ToolCall } from "@chengxiaobang/shared";
import { ToolCallLine } from "@/components/ToolCallLine";
import type { ArtifactKind } from "@/lib/artifact";
import { categoryIcon, toolCategory, toolGroupSummary, toolLineLabel } from "@/lib/tool-display";
import { cn } from "@/lib/utils";

interface ToolCallGroupProps {
  /** 连续可分组的普通工具调用，长度 ≥ 2（由 groupTimelineItems 保证）。 */
  toolCalls: ToolCall[];
  onOpenFile?: (path: string, kind: ArtifactKind) => void;
}

/**
 * 连续普通工具调用折成一行摘要，视觉与思考面板头部保持一致：弱化文字、无卡片边框、
 * 与正文左对齐。运行中显示 spinner 和当前工具描述；失败只显示中性计数，不自动展开。
 */
export function ToolCallGroup({ toolCalls, onOpenFile }: ToolCallGroupProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const active = toolCalls.find(
    (toolCall) =>
      toolCall.status === "running" ||
      toolCall.status === "pending_approval" ||
      toolCall.status === "pending_smart_approval"
  );
  const failedCount = toolCalls.filter(
    (toolCall) => toolCall.status === "failed" || toolCall.status === "rejected"
  ).length;
  const summary = toolGroupSummary(toolCalls)
    .map((part) => t(`chat.toolGroup.${part.category}`, { count: part.count }))
    .join(" · ");
  const HeadIcon = categoryIcon(toolCategory(toolCalls[0].name));
  const activeLabel = active ? toolLineLabel(active) : undefined;

  return (
    <div className="mb-4 max-w-full self-stretch">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex max-w-full items-center gap-1.5 text-caption font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        {active ? (
          <Loader2 className="size-3.5 flex-none animate-spin" />
        ) : (
          <HeadIcon className="size-3.5 flex-none" />
        )}
        <span className="min-w-0 truncate">
          {summary}
          {activeLabel ? ` · ${t(activeLabel.key, activeLabel.params)}` : ""}
        </span>
        {failedCount > 0 ? (
          <span className="flex-none font-mono text-micro text-muted-slate">
            {t("chat.toolGroup.failed", { count: failedCount })}
          </span>
        ) : null}
        <ChevronDown
          className={cn(
            "size-3.5 flex-none transition-transform duration-200",
            !open && "-rotate-90"
          )}
        />
      </button>
      {open ? (
        <div className="ml-1.5 mt-1.5 space-y-0.5 border-l border-hairline pl-3">
          {toolCalls.map((toolCall) => (
            <ToolCallLine key={toolCall.id} toolCall={toolCall} onOpenFile={onOpenFile} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
