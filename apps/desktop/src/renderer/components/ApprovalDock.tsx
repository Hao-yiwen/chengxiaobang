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
 * 输入框上方的待审批工具 dock：AskUserQuestion 使用选项卡片，ExitPlanMode 使用计划确认卡，
 * 其他工具使用通用审批卡。提交决议后立即隐藏，避免和时间线回执重复展示。
 */
export function ApprovalDock() {
  const pendingTool = useAppStore((state) => state.pendingTool);
  const approve = useAppStore((state) => state.approve);
  const setPlanMode = useAppStore((state) => state.setPlanMode);
  const [decidedId, setDecidedId] = useState<string>();

  if (!pendingTool || pendingTool.id === decidedId || pendingTool.status === "pending_smart_approval") {
    return null;
  }

  const decide = (decision: ApprovalDecision) => {
    console.info("[ApprovalDock] 提交审批决议", {
      toolCallId: pendingTool.id,
      name: pendingTool.name,
      approved: decision.approved
    });
    if (pendingTool.name === "ExitPlanMode" && decision.approved) {
      console.info("[ApprovalDock] 用户确认计划，退出前端计划模式", {
        toolCallId: pendingTool.id
      });
      setPlanMode(false);
    }
    setDecidedId(pendingTool.id);
    approve(pendingTool.id, decision);
  };

  if (pendingTool.name === "AskUserQuestion") {
    return (
      <div data-testid="approval-dock" className="mb-3">
        <AskUserCard toolCall={pendingTool} onDecide={decide} />
      </div>
    );
  }

  if (pendingTool.name === "ExitPlanMode") {
    return <PlanApprovalCard toolCall={pendingTool} onDecide={decide} />;
  }

  return <ApprovalCard toolCall={pendingTool} onDecide={decide} />;
}

function PlanApprovalCard({
  toolCall,
  onDecide
}: {
  toolCall: ToolCall;
  onDecide: (decision: ApprovalDecision) => void;
}) {
  const { t } = useTranslation();
  const [feedback, setFeedback] = useState("");

  const submitAdjustment = () => {
    const text = feedback.trim();
    if (!text) {
      console.warn("[ApprovalDock] 计划调整意见为空，已阻止提交", {
        toolCallId: toolCall.id
      });
      return;
    }
    console.info("[ApprovalDock] 提交计划调整意见", {
      toolCallId: toolCall.id,
      chars: text.length
    });
    onDecide({
      approved: false,
      answer: { answers: [{ id: "plan_adjustment", question: t("plan.adjustPlaceholder"), text }] }
    });
  };

  return (
    <div
      data-testid="plan-approval-dock"
      className="mb-3 animate-scale-in rounded-md border bg-card p-4 shadow-subtle"
    >
      <h3 className="mb-3 text-body-sm-strong text-foreground">{t("plan.approvalTitle")}</h3>
      <div className="overflow-hidden rounded-md bg-canvas-soft-2">
        <button
          type="button"
          className="flex min-h-12 w-full items-center gap-3 px-4 text-left text-body-sm-strong text-foreground transition-colors hover:bg-surface-hover"
          onClick={() => {
            console.info("[ApprovalDock] 用户选择实施计划", { toolCallId: toolCall.id });
            onDecide({ approved: true });
          }}
        >
          <span className="flex size-7 flex-none items-center justify-center rounded-full bg-primary text-button-md text-primary-foreground">
            1
          </span>
          <span className="min-w-0 flex-1">{t("plan.approveAction")}</span>
          <Check className="size-4 flex-none text-muted-foreground" />
        </button>
        <div className="flex min-h-12 items-center gap-3 border-t border-border bg-card px-4">
          <span className="flex size-7 flex-none items-center justify-center rounded-full border bg-card text-muted-foreground">
            <X className="size-4" />
          </span>
          <input
            value={feedback}
            onChange={(event) => setFeedback(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                submitAdjustment();
              }
            }}
            placeholder={t("plan.adjustPlaceholder")}
            aria-label={t("plan.adjustPlaceholder")}
            className="min-w-0 flex-1 bg-transparent text-body-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
          <Button size="sm" variant="outline" onClick={submitAdjustment}>
            {t("plan.submitAdjustment")}
          </Button>
        </div>
      </div>
    </div>
  );
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

/** Bash → 近黑命令块；Edit/Write → 路径 + diff；其余 → 原始 JSON 参数。 */
function ApprovalPreview({ toolCall }: { toolCall: ToolCall }) {
  if (toolCall.name === "Bash" && typeof toolCall.args.command === "string") {
    return (
      <pre className="max-h-[180px] overflow-auto whitespace-pre-wrap break-words border-t bg-primary px-4 py-3 font-mono text-xs leading-relaxed text-primary-foreground">
        {toolCall.args.command}
      </pre>
    );
  }
  const diff = buildToolCallDiff(toolCall);
  if (diff && typeof toolCall.args.file_path === "string") {
    return (
      <div className="border-t">
        <div className="border-b px-4 py-2 font-mono text-micro text-muted-foreground">
          {toolCall.args.file_path}
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
