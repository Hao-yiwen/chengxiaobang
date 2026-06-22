import type { ReasoningMode, RunSteeringRequest } from "@chengxiaobang/shared";
import { getLogger } from "../logging/logger";

const log = getLogger({ module: "active-runs" });

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
    log.info("登记活跃 run", {
      action: "active_run.register",
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
    log.info("移除活跃 run", {
      action: "active_run.forget",
      runId,
      sessionId: active.sessionId,
      droppedSteeringCount,
      activeRunCount: this.activeRuns.size
    });
  }

  enqueueSteering(runId: string, input: RunSteeringRequest): boolean {
    const active = this.activeRuns.get(runId);
    if (!active) {
      log.warn("拒绝运行中引导：run 不在当前进程活跃列表", {
        action: "active_run.steering_reject",
        runId,
        clientRequestId: input.clientRequestId,
        promptChars: input.prompt.length
      });
      return false;
    }
    const current = this.steeringQueues.get(runId) ?? [];
    current.push(input);
    this.steeringQueues.set(runId, current);
    log.info("已加入运行中引导队列", {
      action: "active_run.steering_enqueue",
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
