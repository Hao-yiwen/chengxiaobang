import {
  CheckMediumIcon,
  InfoCircleIcon,
  XMarkIcon
} from "@/assets/file-type-icons";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ApprovalDecision, ToolCall } from "@chengxiaobang/shared";
import { AskUserCard } from "@/components/AskUserCard";
import { DiffView } from "@/components/DiffView";
import { Button } from "@/components/ui/button";
import { buildToolCallDiff } from "@/lib/tool-call";
import { toolIcon, toolLineLabel } from "@/lib/tool-display";
import { cn } from "@/lib/utils";
import { selectActiveProject, useAppStore } from "@/store";

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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.repeat) {
        return;
      }
      event.preventDefault();
      console.info("[ApprovalDock] 用户按 Escape 拒绝计划", {
        toolCallId: toolCall.id
      });
      onDecide({ approved: false });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onDecide, toolCall.id]);

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
      className="mb-3 animate-scale-in rounded-lg border border-border bg-card p-3 shadow-none"
    >
      <h3 className="mb-2 text-body-sm-strong text-foreground">{t("plan.approvalTitle")}</h3>
      <div className="overflow-hidden rounded-md border border-border bg-canvas-soft-2">
        <button
          type="button"
          className="flex min-h-10 w-full items-center gap-2.5 px-3 text-left text-body-sm-strong text-foreground transition-colors hover:bg-surface-hover"
          onClick={() => {
            console.info("[ApprovalDock] 用户选择实施计划", { toolCallId: toolCall.id });
            onDecide({ approved: true });
          }}
        >
          <span className="flex size-6 flex-none items-center justify-center rounded-full bg-primary text-caption font-medium text-primary-foreground">
            1
          </span>
          <span className="min-w-0 flex-1">{t("plan.approveAction")}</span>
          <CheckMediumIcon className="size-3.5 flex-none text-muted-foreground" />
        </button>
        <div className="flex min-h-10 items-center gap-2.5 border-t border-border bg-card px-3">
          <span className="flex size-6 flex-none items-center justify-center rounded-full border border-border bg-card text-muted-foreground">
            <XMarkIcon className="size-3.5" />
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
          <button
            type="button"
            onClick={submitAdjustment}
            className="inline-flex h-7 flex-none items-center justify-center whitespace-nowrap rounded-md border border-border bg-card px-3 text-caption font-medium text-foreground transition-colors hover:bg-canvas-soft-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25"
          >
            {t("plan.submitAdjustment")}
          </button>
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
  const activeProject = useAppStore(selectActiveProject);
  const [selected, setSelected] = useState<"allow" | "project" | "reject">("allow");
  const choices: Array<{
    id: "allow" | "project" | "reject";
    label: string;
    description: string;
    decision: ApprovalDecision;
  }> = [
    {
      id: "allow",
      label: t("chat.approvalDialog.allowLabel"),
      description: t("chat.approvalDialog.allowDescription"),
      decision: { approved: true }
    },
    ...(activeProject
      ? [
          {
            id: "project" as const,
            label: t("chat.approvalDialog.projectLabel"),
            description: t("chat.approvalDialog.projectDescription"),
            decision: { approved: true, approvalScope: "project" as const }
          }
        ]
      : []),
    {
      id: "reject",
      label: t("chat.approvalDialog.rejectLabel"),
      description: t("chat.approvalDialog.rejectDescription"),
      decision: { approved: false }
    }
  ];
  const selectedIndex = Math.max(
    0,
    choices.findIndex((choice) => choice.id === selected)
  );
  const confirmChoice = (choice: (typeof choices)[number], source: "confirm_button" | "double_click" | "keyboard") => {
    console.info("[ApprovalDock] 确认权限选项", {
      toolCallId: toolCall.id,
      choiceId: choice.id,
      source
    });
    onDecide(choice.decision);
  };
  const confirm = (source: "confirm_button" | "keyboard") => {
    const choice = choices[selectedIndex] ?? choices[0]!;
    confirmChoice(choice, source);
  };
  const moveSelection = (direction: 1 | -1) => {
    const next = (selectedIndex + direction + choices.length) % choices.length;
    setSelected(choices[next]!.id);
  };

  return (
    <div
      data-testid="approval-dock"
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          moveSelection(1);
          return;
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          moveSelection(-1);
          return;
        }
        if (event.key === "Enter") {
          event.preventDefault();
          confirm("keyboard");
        }
      }}
      className="mb-3 animate-scale-in rounded-lg border border-border bg-card p-3 shadow-none"
    >
      <div className="space-y-2.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-caption font-medium text-muted-foreground">
              {t("chat.approvalDialog.title")}
            </p>
            <p className="mt-1 line-clamp-2 break-words text-body-sm-strong text-foreground">
              {t(label.key, label.params)}
            </p>
          </div>
          <div className="mt-0.5 flex flex-none items-center gap-1.5 rounded-pill border border-border bg-canvas px-2.5 py-1 text-caption font-medium text-muted-foreground">
            <ToolIcon className="size-3.5 flex-none" />
            <span>{t("chat.approvalDialog.pending")}</span>
          </div>
        </div>
        <ApprovalPreview toolCall={toolCall} />
        <div className="grid gap-1.5 pt-0.5">
          {choices.map((choice, index) => {
            const active = selected === choice.id;
            return (
              <button
                key={choice.id}
                type="button"
                onClick={() => setSelected(choice.id)}
                onDoubleClick={() => {
                  setSelected(choice.id);
                  confirmChoice(choice, "double_click");
                }}
                className={cn(
                  "flex min-h-9 w-full items-center gap-2.5 rounded-md border border-transparent px-2.5 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25",
                  active
                    ? "border-border bg-canvas-soft-2 text-foreground"
                    : "text-muted-foreground hover:bg-canvas-soft"
                )}
                aria-pressed={active}
              >
                <span className="w-5 flex-none text-caption font-medium tabular-nums text-muted-foreground">
                  {index + 1}.
                </span>
                <span className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
                  <span className="break-words text-body-sm font-medium text-foreground">
                    {choice.label}
                  </span>
                  <span className="break-words text-caption text-muted-foreground">
                    {choice.description}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        <div className="flex items-center justify-between gap-3 pt-0.5">
          <div className="flex min-w-0 items-center gap-1.5 text-caption text-muted-foreground">
            <InfoCircleIcon className="size-3.5 flex-none text-foreground" />
            <span className="min-w-0 break-words">{t("chat.approvalDialog.keyboardHint")}</span>
          </div>
          <Button
            className="h-8 flex-none rounded-md px-3.5 text-caption font-medium text-primary-foreground"
            onClick={() => confirm("confirm_button")}
          >
            {t("chat.approvalDialog.confirm")}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Bash → 近黑命令块；Edit/Write → 路径 + diff；其余 → 原始 JSON 参数。 */
function ApprovalPreview({ toolCall }: { toolCall: ToolCall }) {
  const { t } = useTranslation();
  if (toolCall.name === "Bash" && typeof toolCall.args.command === "string") {
    return (
      <div className="max-h-[128px] overflow-auto rounded-md border border-border bg-canvas px-3 py-2 [scrollbar-gutter:stable]">
        <p className="whitespace-pre-wrap break-words font-mono text-micro leading-relaxed text-foreground">
          <span className="text-muted-foreground">$ </span>
          {toolCall.args.command}
        </p>
        <p className="mt-1.5 text-caption text-muted-foreground">
          {t("chat.approvalDialog.noOutput")}
        </p>
      </div>
    );
  }
  const diff = buildToolCallDiff(toolCall);
  if (diff && typeof toolCall.args.file_path === "string") {
    return (
      <div className="overflow-hidden rounded-md border border-border bg-card">
        <div className="border-b px-3 py-1.5 font-mono text-micro text-muted-foreground">
          {toolCall.args.file_path}
        </div>
        <div className="max-h-[128px] overflow-auto">
          <DiffView source={diff} />
        </div>
      </div>
    );
  }
  return (
    <pre className="max-h-[128px] overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-card px-3 py-2 font-mono text-micro leading-relaxed text-muted-foreground [scrollbar-gutter:stable]">
      {JSON.stringify(toolCall.args, null, 2)}
    </pre>
  );
}
