import type { ApprovalDecision } from "@chengxiaobang/shared";

/**
 * 泛化后的审批队列：决议从 boolean 升级为带 payload 的 ApprovalDecision
 * （计划调整意见和 AskUserQuestion 都携带 answer）。abort 与早到决议
 * （decide 先于 wait 到达）语义与旧实现一致。
 */
export class ApprovalQueue {
  // 早到决议(decide 先于 wait 到达)的存活时间与上限:对“永不到来的 wait”
  //(误发、重复点击、或属于已结束 run 的 toolCallId)做兜底回收,防止无界增长。
  private static readonly EARLY_DECISION_TTL_MS = 60_000;
  private static readonly EARLY_DECISION_MAX = 256;
  private readonly pending = new Map<string, (decision: ApprovalDecision) => void>();
  private readonly earlyDecisions = new Map<string, { decision: ApprovalDecision; at: number }>();

  wait(toolCallId: string, signal: AbortSignal): Promise<ApprovalDecision> {
    this.pruneEarlyDecisions();
    const early = this.earlyDecisions.get(toolCallId);
    if (early) {
      this.earlyDecisions.delete(toolCallId);
      console.log(
        `[approval-queue] 早到决议命中 toolCallId=${toolCallId} approved=${early.decision.approved}`
      );
      return Promise.resolve(early.decision);
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
      // decide 可能先于 wait 注册到达(beforeToolCall 发出 pending 事件后、注册 wait 之前),
      // 暂存为早到决议由后续 wait 命中。这里做 TTL + 上限清理,避免“永不到来的 wait”
      // 把决议无界堆积成内存泄漏。注:队列无法区分合法的早到与彻底无效的 toolCallId
      //(那需要跨 run 的有效 id 注册表),故仍返回 true;遗留项会被 TTL 回收。
      this.pruneEarlyDecisions();
      if (this.earlyDecisions.size >= ApprovalQueue.EARLY_DECISION_MAX) {
        const oldest = this.earlyDecisions.keys().next().value;
        if (oldest !== undefined) {
          this.earlyDecisions.delete(oldest);
          console.warn(`[approval-queue] 早到决议超过上限，丢弃最旧项 toolCallId=${oldest}`);
        }
      }
      this.earlyDecisions.set(toolCallId, { decision, at: Date.now() });
      return true;
    }
    this.pending.delete(toolCallId);
    resolve(decision);
    return true;
  }

  /** 回收超过 TTL 的早到决议,防止误发/重复决议无界堆积。 */
  private pruneEarlyDecisions(): void {
    const now = Date.now();
    for (const [id, entry] of this.earlyDecisions) {
      if (now - entry.at > ApprovalQueue.EARLY_DECISION_TTL_MS) {
        this.earlyDecisions.delete(id);
        console.warn(`[approval-queue] 清理过期早到决议 toolCallId=${id}`);
      }
    }
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
