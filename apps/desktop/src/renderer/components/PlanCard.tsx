/**
 * PlanCard 计划卡（视觉 UI-SPEC §7.1；数据语义 ARCH-SPEC §2.5）。
 *
 * 纯 props 驱动，不 import store。父层（ChatView/WP-E）负责从
 * `derivePlanState(toolCalls)` + pendingTool/activeRunId 推导出 status：
 * - draft     —— propose_plan pending_approval 且属于活跃 run：步骤可编辑，可确认/否决；
 * - awaiting  —— propose_plan pending_approval 但 run 已结束（ARCH 残留 pending 规则）：
 *                不可交互终态卡，提示「计划未确认（运行已结束）」；
 * - executing —— 锚点已确认（PlanState.confirmed）且未完结；
 * - completed —— PlanState.finished；
 * - rejected  —— 锚点被否决。
 *
 * 步骤状态沿用 shared 的 PlanStep（pending/in_progress/completed/skipped）。
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { PlanStep } from "@chengxiaobang/shared";
import { StampBadge, type StampTone } from "@/components/StampBadge";
import { cn } from "@/lib/utils";

export type PlanCardStatus = "draft" | "awaiting" | "executing" | "completed" | "rejected";

export interface PlanCardProps {
  title: string;
  steps: PlanStep[];
  status: PlanCardStatus;
  /** 当前步墨点是否持有活动权（UI-SPEC §2.3 同屏唯一）；默认 false → 静态 60%。 */
  inkOwner?: boolean;
  onConfirm(): void;
  onReject(): void;
  /** 仅 draft 态会被调用（UI-SPEC §7.1）：编辑标题 / 删步 / 加步后的完整步骤数组。 */
  onUpdateSteps(steps: PlanStep[]): void;
}

const STAMP_TONES: Record<PlanCardStatus, StampTone> = {
  draft: "ink",
  awaiting: "ochre",
  executing: "indigo",
  completed: "moss",
  rejected: "faint"
};

/** leader 引线（§7.1 修正实现）：自绘等距圆点，非 Retina 不糊。 */
const LEADER_STYLE: React.CSSProperties = {
  flex: "1 1 12px",
  height: 2,
  margin: "0 8px",
  position: "relative",
  top: "0.18em",
  backgroundImage: "repeating-linear-gradient(to right, var(--line) 0 2px, transparent 2px 7px)",
  backgroundPosition: "left bottom",
  backgroundSize: "100% 2px",
  backgroundRepeat: "no-repeat"
};

/** ✓ 落笔（240ms 画出）与状态字淡入（160ms）。基态即终态，reduced-motion 下不丢勾。 */
const PLAN_KEYFRAMES = `
@keyframes plan-check-draw { from { stroke-dashoffset: 14; } }
@keyframes plan-status-in { from { opacity: 0; } }
`;

/** 最小不冲突的 s{n} 步骤 id（draft 加步用）。 */
function nextStepId(steps: PlanStep[]): string {
  const ids = new Set(steps.map((s) => s.id));
  let n = steps.length + 1;
  while (ids.has(`s${n}`)) n += 1;
  return `s${n}`;
}

export function PlanCard({
  title,
  steps,
  status,
  inkOwner = false,
  onConfirm,
  onReject,
  onUpdateSteps
}: PlanCardProps) {
  const { t } = useTranslation();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const editable = status === "draft";
  const stampLabel: Record<PlanCardStatus, string> = {
    draft: t("plan.statusDraft"),
    awaiting: t("plan.statusAwaiting"),
    executing: t("plan.statusExecuting"),
    completed: t("plan.statusCompleted"),
    rejected: t("plan.statusRejected")
  };

  const done = steps.filter((s) => s.status === "completed" || s.status === "skipped").length;
  const remaining = steps.length - done;
  let progress = `${done} / ${steps.length}`;
  if (status === "executing" && remaining > 0) {
    progress += ` · ${t("plan.remaining", { n: remaining })}`;
  }

  function commitTitle(stepId: string, raw: string): void {
    setEditingId(null);
    const next = raw.trim();
    const prev = steps.find((s) => s.id === stepId);
    if (!prev || !next || next === prev.title) return;
    console.info(`[plan-card] 编辑步骤标题 stepId=${stepId} title=${next}`);
    onUpdateSteps(steps.map((s) => (s.id === stepId ? { ...s, title: next } : s)));
  }

  function deleteStep(stepId: string): void {
    console.info(`[plan-card] 删除步骤 stepId=${stepId}（剩 ${steps.length - 1} 步）`);
    onUpdateSteps(steps.filter((s) => s.id !== stepId));
  }

  function commitNewStep(raw: string): void {
    setAdding(false);
    const next = raw.trim();
    if (!next) return;
    const id = nextStepId(steps);
    console.info(`[plan-card] 添加步骤 stepId=${id} title=${next}`);
    onUpdateSteps([...steps, { id, title: next, status: "pending" }]);
  }

  return (
    <section
      data-status={status}
      aria-label={`${t("plan.heading")}：${title}`}
      className="animate-msg-in rounded-lg border border-line border-l-[3px] border-l-indigo bg-card px-5 py-4"
    >
      <style>{PLAN_KEYFRAMES}</style>
      <header className="flex items-center justify-between">
        <span className="font-serif text-[16px] tracking-[0.3em] text-foreground">
          {t("plan.heading")}
        </span>
        <StampBadge
          text={stampLabel[status]}
          fullLabel={stampLabel[status]}
          tone={STAMP_TONES[status]}
        />
      </header>
      <h3 className="mt-0.5 font-serif text-[18px] font-semibold leading-[27px] text-foreground">
        {title}
      </h3>
      <hr className="my-2.5 border-line" />
      <ol>
        {steps.map((step, index) =>
          editingId === step.id && editable ? (
            <li key={step.id} className="flex h-8 items-center" data-step-id={step.id}>
              <StepNumber index={index} className="text-ink-3" />
              <input
                autoFocus
                defaultValue={step.title}
                aria-label={t("plan.editStep")}
                className="min-w-0 flex-1 border-b border-line-strong bg-transparent text-[13.5px] text-foreground outline-none"
                onBlur={(e) => commitTitle(step.id, e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitTitle(step.id, e.currentTarget.value);
                  if (e.key === "Escape") setEditingId(null);
                }}
              />
            </li>
          ) : (
            <StepRow
              key={step.id}
              step={step}
              index={index}
              inkOwner={inkOwner}
              editable={editable}
              onEdit={() => setEditingId(step.id)}
              onDelete={() => deleteStep(step.id)}
            />
          )
        )}
        {adding && editable ? (
          <li className="flex h-8 items-center">
            <StepNumber index={steps.length} className="text-ink-4" />
            <input
              autoFocus
              defaultValue=""
              aria-label={t("plan.addStep")}
              placeholder={t("plan.newStepPlaceholder")}
              className="min-w-0 flex-1 border-b border-line-strong bg-transparent text-[13.5px] text-foreground outline-none"
              onBlur={(e) => commitNewStep(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitNewStep(e.currentTarget.value);
                if (e.key === "Escape") setAdding(false);
              }}
            />
          </li>
        ) : null}
      </ol>
      {editable && !adding ? (
        <button
          type="button"
          className="mt-1 text-[12.5px] text-ink-3 transition-colors hover:text-foreground"
          onClick={() => setAdding(true)}
        >
          ＋ {t("plan.addStep")}
        </button>
      ) : null}
      <hr className="my-2.5 border-line" />
      <footer className="flex min-h-7 items-center justify-between gap-3">
        <span className="tnum text-[12px] text-ink-3">{progress}</span>
        {status === "draft" ? (
          <span className="flex items-center gap-2">
            <button
              type="button"
              className="rounded-md border border-line bg-transparent px-3 py-[5px] text-[13px] text-secondary-foreground transition-colors hover:border-line-strong hover:bg-muted"
              onClick={() => {
                console.info(`[plan-card] 否决计划 title=${title}`);
                onReject();
              }}
            >
              {t("plan.rejectPlan")}
            </button>
            <button
              type="button"
              className="rounded-md border border-line bg-transparent px-3 py-[5px] text-[13px] text-secondary-foreground transition-colors hover:border-line-strong hover:bg-muted"
              onClick={() => {
                console.debug(`[plan-card] 进入修改 title=${title}`);
                setEditingId(steps[0]?.id ?? null);
              }}
            >
              {t("plan.modify")}
            </button>
            <button
              type="button"
              className="rounded-md bg-primary px-3 py-[5px] text-[13px] text-primary-foreground transition-[filter,transform] hover:brightness-105 active:scale-[0.97]"
              onClick={() => {
                console.info(`[plan-card] 确认执行 title=${title} steps=${steps.length}`);
                onConfirm();
              }}
            >
              {t("plan.confirm")}
            </button>
          </span>
        ) : null}
        {status === "awaiting" ? (
          <span className="text-[12px] text-ink-3">{t("plan.staleAwaiting")}</span>
        ) : null}
      </footer>
    </section>
  );
}

function StepNumber({ index, className }: { index: number; className: string }) {
  return (
    <span className={cn("tnum w-6 shrink-0 font-serif text-[13px]", className)}>
      {String(index + 1).padStart(2, "0")}
    </span>
  );
}

function StepRow({
  step,
  index,
  inkOwner,
  editable,
  onEdit,
  onDelete
}: {
  step: PlanStep;
  index: number;
  inkOwner: boolean;
  editable: boolean;
  onEdit(): void;
  onDelete(): void;
}) {
  const { t } = useTranslation();
  const doneStep = step.status === "completed";
  const titleClass = cn(
    "min-w-0 flex-initial truncate text-left text-[13.5px]",
    doneStep || step.status === "pending"
      ? "text-ink-3"
      : step.status === "skipped"
        ? "text-ink-4"
        : "text-foreground"
  );

  return (
    <li
      className="group/step flex h-8 items-center"
      data-step-id={step.id}
      data-step-status={step.status}
      title={step.detail}
    >
      <StepNumber index={index} className={doneStep ? "text-cinnabar" : "text-ink-3"} />
      {editable ? (
        <button type="button" className={titleClass} onClick={onEdit}>
          {step.title}
        </button>
      ) : (
        <span className={titleClass}>{step.title}</span>
      )}
      <span aria-hidden style={LEADER_STYLE} />
      <span
        className="flex w-5 shrink-0 items-center justify-center"
        style={{ animation: "plan-status-in 160ms var(--ease-out)" }}
      >
        {doneStep ? (
          <svg
            viewBox="0 0 12 12"
            className="size-3 text-moss"
            role="img"
            aria-label={t("plan.stepDone")}
          >
            <path
              d="M2 6.5 L5 9.5 L10 3"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{
                strokeDasharray: 14,
                strokeDashoffset: 0,
                animation: "plan-check-draw 240ms var(--ease-out)"
              }}
            />
          </svg>
        ) : null}
        {step.status === "in_progress" ? (
          <span aria-hidden className={cn("ink-caret", !inkOwner && "ink-caret-static")} />
        ) : null}
        {step.status === "skipped" ? (
          <span aria-label={t("plan.stepSkipped")} className="text-[11px] text-ink-4">
            －
          </span>
        ) : null}
      </span>
      {editable ? (
        <button
          type="button"
          aria-label={`${t("plan.deleteStep")}：${step.title}`}
          className="ml-1 w-4 shrink-0 text-ink-4 opacity-0 transition-opacity hover:text-destructive focus:opacity-100 group-hover/step:opacity-100"
          onClick={onDelete}
        >
          ×
        </button>
      ) : null}
    </li>
  );
}
