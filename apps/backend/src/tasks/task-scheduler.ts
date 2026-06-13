import type {
  AppEvent,
  ScheduledTask,
  ScheduledTaskEvent,
  ScheduledTaskStatus,
  ScheduledTaskTrigger
} from "@chengxiaobang/shared";
import type { AgentRunner } from "../agent/agent-runner";
import type { EventHub } from "../events/event-hub";
import type { StateStore } from "../repository/state-store";
import { computeNextRunAt } from "./schedule";

/** 单次执行的整体上限：headless run 卡死（网络挂起等）时强制中止，释放任务。 */
const DEFAULT_RUN_TIMEOUT_MS = 30 * 60_000;
const DEFAULT_TICK_INTERVAL_MS = 60_000;
const STOP_WAIT_TIMEOUT_MS = 5_000;

/**
 * 定时任务调度器：轮询 scheduled_tasks，到期任务在其绑定会话中追加一次
 * headless run（复用 FeishuService 的消费模式）。
 *
 * 语义约定：
 * - at-most-once：执行前先以 now 为基推进 nextRunAt 并落盘，宕机/重启多个
 *   周期只补跑一次（启动后的首个 tick 即补跑）。
 * - tick 内串行执行（睡眠唤醒后多任务同时到期时不并发打模型/竞写 sql.js）。
 * - 绑定会话正有 run 在跑时跳过且不推进 nextRunAt，下个 tick 重试。
 */
export class TaskScheduler {
  private timer?: ReturnType<typeof setInterval>;
  private ticking = false;
  private stopping = false;
  private readonly busyTaskIds = new Set<string>();
  private readonly inflightRunIds = new Set<string>();
  private readonly activeExecutions = new Set<Promise<void>>();
  private readonly store: StateStore;
  private readonly runner: AgentRunner;
  private readonly intervalMs: number;
  private readonly runTimeoutMs: number;
  private readonly now: () => Date;
  private readonly eventHub?: EventHub<AppEvent>;

  constructor(options: {
    store: StateStore;
    runner: AgentRunner;
    eventHub?: EventHub<AppEvent>;
    intervalMs?: number;
    runTimeoutMs?: number;
    /** 测试缝：注入当前时间。 */
    now?: () => Date;
  }) {
    this.store = options.store;
    this.runner = options.runner;
    this.intervalMs = options.intervalMs ?? DEFAULT_TICK_INTERVAL_MS;
    this.runTimeoutMs = options.runTimeoutMs ?? DEFAULT_RUN_TIMEOUT_MS;
    this.now = options.now ?? (() => new Date());
    this.eventHub = options.eventHub;
  }

  start(): void {
    this.stopping = false;
    console.info(`[task-scheduler] 启动，轮询间隔 ${this.intervalMs}ms`);
    // 立即 tick：重启期间错过的任务在这里补跑一次。
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    // 在飞行的调度 run 必须中止，否则会在 store 关闭后继续写入。
    for (const runId of this.inflightRunIds) {
      console.warn(`[task-scheduler] 关停：中止在飞行的调度 run runId=${runId}`);
      this.runner.abort(runId);
    }
    const active = [...this.activeExecutions];
    if (active.length > 0) {
      console.info(`[task-scheduler] 等待在飞行任务收尾 count=${active.length}`);
      const settled = await Promise.race([
        Promise.allSettled(active).then(() => true),
        sleep(STOP_WAIT_TIMEOUT_MS).then(() => false)
      ]);
      if (!settled) {
        console.warn(
          `[task-scheduler] 等待任务收尾超时 timeoutMs=${STOP_WAIT_TIMEOUT_MS} remaining=${this.activeExecutions.size}`
        );
      }
    }
    console.info("[task-scheduler] 已停止");
  }

  async tick(): Promise<void> {
    if (this.ticking || this.stopping) {
      return;
    }
    this.ticking = true;
    try {
      const now = this.now();
      const tasks = await this.store.listScheduledTasks();
      const due = tasks.filter(
        (task) => task.enabled && task.nextRunAt && new Date(task.nextRunAt) <= now
      );
      for (const task of due) {
        if (this.stopping) {
          break;
        }
        await this.runExecution(task, "schedule");
      }
    } catch (error) {
      console.error("[task-scheduler] tick 失败:", error);
    } finally {
      this.ticking = false;
    }
  }

  /** 手动触发（「立即运行」按钮），跳过到期检查。 */
  async runNow(taskId: string): Promise<void> {
    if (this.stopping) {
      throw new Error("定时任务调度器正在停止");
    }
    const task = await this.store.getScheduledTask(taskId);
    if (!task) {
      throw new Error("定时任务不存在");
    }
    await this.runExecution(task, "manual");
  }

  private async runExecution(task: ScheduledTask, trigger: ScheduledTaskTrigger): Promise<void> {
    const execution = this.execute(task, trigger);
    this.activeExecutions.add(execution);
    try {
      await execution;
    } finally {
      this.activeExecutions.delete(execution);
    }
  }

  private async execute(task: ScheduledTask, trigger: ScheduledTaskTrigger): Promise<void> {
    if (this.busyTaskIds.has(task.id)) {
      console.warn(`[task-scheduler] 跳过：任务执行中 taskId=${task.id}`);
      return;
    }
    if (this.runner.activeSessionIds.has(task.sessionId)) {
      // 不推进 nextRunAt：下个 tick 仍视为到期并重试。
      console.warn(
        `[task-scheduler] 跳过：会话有正在进行的 run taskId=${task.id} sessionId=${task.sessionId}`
      );
      return;
    }
    this.busyTaskIds.add(task.id);
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    let runId: string | undefined;
    try {
      const now = this.now();
      // 先推进并落盘（sqlite store 每写必 flush），保证 at-most-once。
      await this.store.updateScheduledTask(task.id, {
        nextRunAt: computeNextRunAt(task.cron, now),
        lastRunAt: now.toISOString()
      });
      console.info(
        `[task-scheduler] 开始执行 taskId=${task.id} name=${task.name} sessionId=${task.sessionId} fullAccess=${task.fullAccess}`
      );
      this.publishTaskEvent({
        type: "scheduled_task_started",
        taskId: task.id,
        sessionId: task.sessionId,
        name: task.name,
        trigger,
        occurredAt: now.toISOString()
      });
      let status: ScheduledTaskStatus = "completed";
      let errorText: string | undefined;
      try {
        const session = await this.store.getSession(task.sessionId);
        if (!session) {
          throw new Error("会话不存在");
        }
        const stream = this.runner.stream(
          {
            sessionId: task.sessionId,
            prompt: task.prompt,
            // 沿用会话自己的 provider，避免 run 级 fallback 换模型执行。
            ...(session.providerId ? { providerId: session.providerId } : {}),
            accessMode: task.fullAccess ? "full_access" : "approval",
            planMode: false
          },
          { headless: true }
        );
        for await (const event of stream) {
          if (event.type === "run_started") {
            runId = event.runId;
            this.inflightRunIds.add(event.runId);
            watchdog = setTimeout(() => {
              console.error(
                `[task-scheduler] 执行超时（${this.runTimeoutMs}ms），强制中止 taskId=${task.id} runId=${event.runId}`
              );
              this.runner.abort(event.runId);
            }, this.runTimeoutMs);
          } else if (
            event.type === "tool_call" &&
            (event.toolCall.status === "pending_approval" ||
              event.toolCall.status === "pending_smart_approval")
          ) {
            // 无人值守：任何等待确认的工具一律拒绝（只读语义；fullAccess 下
            // 正常不会出现 pending，这里是防挂死兜底）。
            console.info(
              `[task-scheduler] 自动拒绝待审批工具 taskId=${task.id} tool=${event.toolCall.name}`
            );
            this.runner.approvals.decide(event.toolCall.id, { approved: false });
          } else if (event.type === "run_end") {
            if (event.status === "failed") {
              status = "failed";
              errorText = event.error ?? "未知错误";
            } else if (event.status === "aborted") {
              status = "aborted";
            }
          }
        }
      } catch (error) {
        // stream() 在 run_started 之前就可能抛错（如无可用模型）。
        status = "failed";
        errorText = error instanceof Error ? error.message : String(error);
      }
      await this.store.updateScheduledTask(task.id, {
        lastStatus: status,
        lastError: errorText ?? null
      });
      this.publishTaskEvent({
        type: "scheduled_task_finished",
        taskId: task.id,
        sessionId: task.sessionId,
        name: task.name,
        trigger,
        status,
        ...(runId ? { runId } : {}),
        ...(errorText ? { error: errorText } : {}),
        occurredAt: this.now().toISOString()
      });
      console.info(
        `[task-scheduler] 执行结束 taskId=${task.id} status=${status}` +
          (errorText ? ` error=${errorText}` : "")
      );
    } finally {
      if (watchdog) {
        clearTimeout(watchdog);
      }
      if (runId) {
        this.inflightRunIds.delete(runId);
      }
      this.busyTaskIds.delete(task.id);
    }
  }

  private publishTaskEvent(event: ScheduledTaskEvent): void {
    if (!this.eventHub) {
      return;
    }
    console.info("[task-scheduler] 发布定时任务事件", {
      type: event.type,
      taskId: event.taskId,
      sessionId: event.sessionId
    });
    this.eventHub.publish(event);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
