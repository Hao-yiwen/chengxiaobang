import type { ReasoningMode, RunSteeringRequest } from "@chengxiaobang/shared";

export interface ActiveRunInfo {
  sessionId: string;
  providerId?: string;
  model?: string;
  reasoningMode?: ReasoningMode;
}

export class ActiveRunRegistry {
  private readonly activeRuns = new Map<string, ActiveRunInfo>();
  private readonly steeringQueues = new Map<string, RunSteeringRequest[]>();

  entries(sessionId?: string): Array<[string, ActiveRunInfo]> {
    return [...this.activeRuns.entries()].filter(
      ([, active]) => !sessionId || active.sessionId === sessionId
    );
  }

  register(runId: string, input: ActiveRunInfo): void {
    this.activeRuns.set(runId, input);
    console.info("[agent-runner] 登记活跃 run", {
      runId,
      sessionId: input.sessionId,
      providerId: input.providerId,
      model: input.model,
      reasoningMode: input.reasoningMode,
      activeRunCount: this.activeRuns.size
    });
  }

  forget(runId: string): void {
    const active = this.activeRuns.get(runId);
    if (!active) {
      return;
    }
    this.activeRuns.delete(runId);
    const droppedSteeringCount = this.steeringQueues.get(runId)?.length ?? 0;
    this.steeringQueues.delete(runId);
    console.info("[agent-runner] 移除活跃 run", {
      runId,
      sessionId: active.sessionId,
      droppedSteeringCount,
      activeRunCount: this.activeRuns.size
    });
  }

  enqueueSteering(runId: string, input: RunSteeringRequest): boolean {
    const active = this.activeRuns.get(runId);
    if (!active) {
      console.warn("[agent-runner] 拒绝运行中引导：run 不在当前进程活跃列表", {
        runId,
        clientRequestId: input.clientRequestId,
        promptChars: input.prompt.length
      });
      return false;
    }
    const current = this.steeringQueues.get(runId) ?? [];
    current.push(input);
    this.steeringQueues.set(runId, current);
    console.info("[agent-runner] 已加入运行中引导队列", {
      runId,
      sessionId: active.sessionId,
      providerId: active.providerId,
      model: active.model,
      reasoningMode: active.reasoningMode,
      clientRequestId: input.clientRequestId,
      promptChars: input.prompt.length,
      displayAttachmentCount: input.displayAttachments?.length ?? 0,
      nativeAttachmentCount: input.attachments?.length ?? 0,
      queueLength: current.length
    });
    return true;
  }

  drainSteering(runId: string): RunSteeringRequest[] {
    const queued = this.steeringQueues.get(runId);
    if (!queued || queued.length === 0) {
      return [];
    }
    this.steeringQueues.set(runId, []);
    return queued;
  }
}
