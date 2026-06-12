import { CheckIcon as Check, XIcon as X } from "@phosphor-icons/react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ApprovalDecision, ToolCall } from "@chengxiaobang/shared";
import { AskUserCard } from "@/components/AskUserCard";
import { DiffView } from "@/components/DiffView";
import { Button } from "@/components/ui/button";
import { buildToolCallDiff } from "@/lib/tool-call";
import { toolIcon, toolLineLabel } from "@/lib/tool-display";
import { useAppStore } from "@/store";

/**
 * Bottom dock above the composer for the run's pending tool: ask_user gets
 * the option card, every other tool an approval card (description + preview
 * + 拒绝/允许). Hides itself the instant a decision is submitted so the
 * timeline receipt never double-renders next to a lingering card.
 */
export function ApprovalDock() {
  const pendingTool = useAppStore((state) => state.pendingTool);
  const approve = useAppStore((state) => state.approve);
  const [decidedId, setDecidedId] = useState<string>();

  if (!pendingTool || pendingTool.id === decidedId) {
    return null;
  }

  const decide = (decision: ApprovalDecision) => {
    console.info("[ApprovalDock] 提交审批决议", {
      toolCallId: pendingTool.id,
      name: pendingTool.name,
      approved: decision.approved
    });
    setDecidedId(pendingTool.id);
    approve(pendingTool.id, decision);
  };

  if (pendingTool.name === "ask_user") {
    return (
      <div data-testid="approval-dock" className="mb-3">
        <AskUserCard toolCall={pendingTool} onDecide={decide} />
      </div>
    );
  }

  return <ApprovalCard toolCall={pendingTool} onDecide={decide} />;
}

function ApprovalCard({
  toolCall,
  onDecide
}: {
  toolCall: ToolCall;
  onDecide: (decision: ApprovalDecision) => void;
}) {
  const { t } = useTranslation();
  const ToolIcon = toolIcon(toolCall.name);
  const label = toolLineLabel(toolCall);

  return (
    <div
      data-testid="approval-dock"
      className="mb-3 animate-scale-in overflow-hidden rounded-md border bg-card shadow-subtle"
    >
      <div className="flex items-center gap-2 px-4 py-2.5">
        <ToolIcon className="size-4 flex-none text-muted-foreground" />
        <span className="flex-none text-caption font-medium text-foreground">
          {t("chat.approvalTitle")}
        </span>
        <span className="min-w-0 truncate text-caption text-muted-foreground">
          {t(label.key, label.params)}
        </span>
        <div className="ml-auto flex flex-none items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => onDecide({ approved: false })}>
            <X className="size-4" />
            {t("chat.reject")}
          </Button>
          <Button size="sm" onClick={() => onDecide({ approved: true })}>
            <Check className="size-4" />
            {t("chat.toolAllow")}
          </Button>
        </div>
      </div>
      <ApprovalPreview toolCall={toolCall} />
    </div>
  );
}

/** shell → 近黑命令块；edit/write → 路径 + diff；其余 → 原始 JSON 参数。 */
function ApprovalPreview({ toolCall }: { toolCall: ToolCall }) {
  if (toolCall.name === "shell" && typeof toolCall.args.command === "string") {
    return (
      <pre className="max-h-[180px] overflow-auto whitespace-pre-wrap break-words border-t bg-primary px-4 py-3 font-mono text-xs leading-relaxed text-primary-foreground">
        {toolCall.args.command}
      </pre>
    );
  }
  const diff = buildToolCallDiff(toolCall);
  if (diff && typeof toolCall.args.path === "string") {
    return (
      <div className="border-t">
        <div className="border-b px-4 py-2 font-mono text-micro text-muted-foreground">
          {toolCall.args.path}
        </div>
        <div className="max-h-[220px] overflow-auto">
          <DiffView lines={diff} />
        </div>
      </div>
    );
  }
  return (
    <pre className="max-h-[180px] overflow-auto whitespace-pre-wrap break-words border-t bg-muted px-4 py-3 font-mono text-xs leading-relaxed text-muted-foreground">
      {JSON.stringify(toolCall.args, null, 2)}
    </pre>
  );
}
