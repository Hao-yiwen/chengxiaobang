import type { ApprovalDecision } from "@chengxiaobang/shared";

/**
 * 泛化后的审批队列：决议从 boolean 升级为带 payload 的 ApprovalDecision
 * （计划调整意见和 AskUserQuestion 都携带 answer）。abort 与早到决议
 * （decide 先于 wait 到达）语义与旧实现一致。
 */
export class ApprovalQueue {
  private readonly pending = new Map<string, (decision: ApprovalDecision) => void>();
  private readonly earlyDecisions = new Map<string, ApprovalDecision>();

  wait(toolCallId: string, signal: AbortSignal): Promise<ApprovalDecision> {
    if (this.earlyDecisions.has(toolCallId)) {
      const decision = this.earlyDecisions.get(toolCallId) ?? { approved: false };
      this.earlyDecisions.delete(toolCallId);
      console.log(
        `[approval-queue] 早到决议命中 toolCallId=${toolCallId} approved=${decision.approved}`
      );
      return Promise.resolve(decision);
    }
    // 信号可能在 pending 事件发出之后、wait 注册之前就被中止（abort 竞态）：
    // 已中止的信号不会再触发 abort 事件，必须前置检查，否则 wait 永久挂起。
    if (signal.aborted) {
      console.log(`[approval-queue] 信号已中止，直接拒绝 toolCallId=${toolCallId}`);
      return Promise.resolve({ approved: false });
    }
    return new Promise((resolve) => {
      const onAbort = (): void => {
        this.pending.delete(toolCallId);
        console.log(`[approval-queue] 等待被中止 toolCallId=${toolCallId}`);
        resolve({ approved: false });
      };
      signal.addEventListener("abort", onAbort, { once: true });
      this.pending.set(toolCallId, (decision) => {
        signal.removeEventListener("abort", onAbort);
        resolve(decision);
      });
    });
  }

  decide(toolCallId: string, decision: ApprovalDecision): boolean {
    console.log(
      `[approval-queue] 收到决议 toolCallId=${toolCallId} approved=${decision.approved}` +
        `${decision.answer ? " 含answer" : ""}${decision.editedSteps ? ` 含legacyEditedSteps(${decision.editedSteps.length})` : ""}`
    );
    const resolve = this.pending.get(toolCallId);
    if (!resolve) {
      this.earlyDecisions.set(toolCallId, decision);
      return true;
    }
    this.pending.delete(toolCallId);
    resolve(decision);
    return true;
  }
}

/** 按工具名裁决 payload 有效性，杜绝误发/恶意 payload 静默通过。 */
export function normalizeDecision(name: string, decision: ApprovalDecision): ApprovalDecision {
  if (name === "AskUserQuestion") {
    if (decision.approvalScope) {
      console.warn(`[approval-queue] AskUserQuestion 决议携带 approvalScope，已忽略`);
    }
    if (decision.approved && !decision.answer) {
      console.warn(`[approval-queue] AskUserQuestion 决议缺少 answer，按拒绝处理`);
      return { approved: false };
    }
    return { approved: decision.approved, answer: decision.answer };
  }
  if (name === "ExitPlanMode") {
    if (decision.approvalScope) {
      console.warn(`[approval-queue] ExitPlanMode 决议携带 approvalScope，已忽略`);
    }
    // editedSteps 只为旧客户端保留；新版计划调整通过 answer 反馈给模型。
    return {
      approved: decision.approved,
      answer: decision.answer,
      editedSteps: decision.editedSteps
    };
  }
  if (decision.answer || decision.editedSteps) {
    console.warn(`[approval-queue] 工具 ${name} 的决议携带无关 payload，已忽略`);
  }
  return {
    approved: decision.approved,
    ...(decision.approvalScope ? { approvalScope: decision.approvalScope } : {})
  };
}
