import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nowIso, type AppEvent, type ProviderConfig } from "@chengxiaobang/shared";
import { AgentRunner } from "../src/agent/agent-runner";
import type { EventHub } from "../src/events/event-hub";
import { SqliteStateStore } from "../src/repository/sqlite-state-store";
import { MemorySecretStore } from "../src/secrets/secret-store";
import { TaskScheduler } from "../src/tasks/task-scheduler";
import { scriptedStreamFn, type ScriptedTurn } from "./helpers/scripted-stream";

const PAST = "2020-01-01T00:00:00.000Z";

describe("TaskScheduler", () => {
  let dir: string;
  let store: SqliteStateStore;
  let secrets: MemorySecretStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "cxb-sched-"));
    store = new SqliteStateStore(join(dir, "state.sqlite"));
    await store.initialize();
    secrets = new MemorySecretStore();
  });

  afterEach(async () => {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  });

  function schedulerWith(
    turns: ScriptedTurn[],
    options: { events?: AppEvent[]; now?: Date } = {}
  ): { scheduler: TaskScheduler; runner: AgentRunner } {
    const runner = new AgentRunner(store, secrets, {
      streamFn: scriptedStreamFn(turns).streamFn,
      sessionWorkspacePath: (sessionId) => join(dir, "sessions", sessionId)
    });
    const eventHub = options.events
      ? ({ publish: (event: AppEvent) => options.events?.push(event) } as unknown as EventHub<AppEvent>)
      : undefined;
    return {
      scheduler: new TaskScheduler({
        store,
        runner,
        eventHub,
        ...(options.now ? { now: () => options.now! } : {})
      }),
      runner
    };
  }

  async function seedSessionAndTask(options: { fullAccess?: boolean; enabled?: boolean } = {}) {
    const session = await store.createSession({
      projectId: null,
      title: "日报会话",
      accessMode: "approval"
    });
    const task = await store.createScheduledTask({
      sessionId: session.id,
      name: "AI 日报",
      prompt: "生成今天的 AI 日报",
      kind: "recurring",
      cron: "*/5 * * * *",
      fullAccess: options.fullAccess ?? false,
      nextRunAt: PAST
    });
    if (options.enabled === false) {
      await store.updateScheduledTask(task.id, { enabled: false });
    }
    return { session, task };
  }

  it("executes a due task in its origin session and advances nextRunAt from now", async () => {
    await seedProvider(store, secrets);
    const { session, task } = await seedSessionAndTask();
    const { scheduler } = schedulerWith([{ text: "今日 AI 要点……" }]);

    const before = Date.now();
    await scheduler.tick();

    const messages = await store.listMessages(session.id);
    expect(messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(messages[0].content).toBe("生成今天的 AI 日报");
    expect(messages[1].content).toBe("今日 AI 要点……");

    const updated = await store.getScheduledTask(task.id);
    expect(updated?.lastStatus).toBe("completed");
    expect(updated?.lastError).toBeUndefined();
    // 补跑语义：nextRunAt 以 now 为基推进到未来，而不是按旧值连环追赶。
    expect(Date.parse(updated!.nextRunAt!)).toBeGreaterThan(before);
    expect(Date.parse(updated!.lastRunAt!)).toBeGreaterThanOrEqual(before);
  });

  it("expires one-time tasks after the first scheduled execution", async () => {
    await seedProvider(store, secrets);
    const session = await store.createSession({
      projectId: null,
      title: "提醒会话",
      accessMode: "approval"
    });
    const task = await store.createScheduledTask({
      sessionId: session.id,
      name: "睡觉提醒",
      prompt: "提醒我睡觉",
      kind: "once",
      runAt: PAST,
      fullAccess: false,
      nextRunAt: PAST
    });
    const { scheduler } = schedulerWith([{ text: "该睡觉了" }]);

    await scheduler.tick();

    const messages = await store.listMessages(session.id);
    expect(messages.map((message) => message.content)).toEqual(["提醒我睡觉", "该睡觉了"]);
    const updated = await store.getScheduledTask(task.id);
    expect(updated).toMatchObject({
      kind: "once",
      enabled: false,
      lastStatus: "completed"
    });
    expect(updated?.nextRunAt).toBeUndefined();
    expect(updated?.runAt).toBe(PAST);
  });

  it("publishes start and finish events for scheduled executions", async () => {
    await seedProvider(store, secrets);
    const { session, task } = await seedSessionAndTask();
    const events: AppEvent[] = [];
    const now = new Date("2026-06-13T01:00:00.000Z");
    const { scheduler } = schedulerWith([{ text: "今日 AI 要点……" }], { events, now });

    await scheduler.tick();

    expect(events).toEqual([
      {
        type: "scheduled_task_started",
        taskId: task.id,
        sessionId: session.id,
        name: "AI 日报",
        trigger: "schedule",
        occurredAt: now.toISOString()
      },
      expect.objectContaining({
        type: "scheduled_task_finished",
        taskId: task.id,
        sessionId: session.id,
        name: "AI 日报",
        trigger: "schedule",
        status: "completed",
        occurredAt: now.toISOString()
      })
    ]);
    expect(events[1]).toHaveProperty("runId");
  });

  it("records a failure when the run cannot start (no provider configured)", async () => {
    const { task } = await seedSessionAndTask();
    const { scheduler } = schedulerWith([]);

    await scheduler.tick();

    const updated = await store.getScheduledTask(task.id);
    expect(updated?.lastStatus).toBe("failed");
    expect(updated?.lastError).toContain("模型");
    // 失败也已推进 nextRunAt，不会在每个 tick 重复打失败的任务。
    expect(Date.parse(updated!.nextRunAt!)).toBeGreaterThan(Date.now() - 1000);
  });

  it("records one-time task failures without scheduling another run", async () => {
    const session = await store.createSession({
      projectId: null,
      title: "失败提醒",
      accessMode: "approval"
    });
    const task = await store.createScheduledTask({
      sessionId: session.id,
      name: "失败一次",
      prompt: "执行一次",
      kind: "once",
      runAt: PAST,
      fullAccess: false,
      nextRunAt: PAST
    });
    const { scheduler } = schedulerWith([]);

    await scheduler.tick();

    const updated = await store.getScheduledTask(task.id);
    expect(updated?.lastStatus).toBe("failed");
    expect(updated?.lastError).toContain("模型");
    expect(updated?.enabled).toBe(false);
    expect(updated?.nextRunAt).toBeUndefined();
  });

  it("publishes manual run failures with the task error", async () => {
    const { task } = await seedSessionAndTask();
    const events: AppEvent[] = [];
    const { scheduler } = schedulerWith([], {
      events,
      now: new Date("2026-06-13T02:00:00.000Z")
    });

    await scheduler.runNow(task.id);

    expect(events[0]).toMatchObject({
      type: "scheduled_task_started",
      taskId: task.id,
      trigger: "manual"
    });
    expect(events[1]).toMatchObject({
      type: "scheduled_task_finished",
      taskId: task.id,
      trigger: "manual",
      status: "failed"
    });
    expect(events[1]).toHaveProperty("error");
  });

  it("auto-denies mutating tools for read-only tasks and the run still completes", async () => {
    await seedProvider(store, secrets);
    const { session, task } = await seedSessionAndTask({ fullAccess: false });
    const { scheduler } = schedulerWith([
      {
        toolCalls: [
          { id: "tc1", name: "write_file", arguments: { path: "a.txt", content: "x" } }
        ]
      },
      { text: "好的，已跳过写文件。" }
    ]);

    await scheduler.tick();

    const updated = await store.getScheduledTask(task.id);
    expect(updated?.lastStatus).toBe("completed");
    const toolCalls = await store.listToolCallsForSession(session.id);
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]).toMatchObject({ name: "write_file", status: "rejected" });
  });

  it("does not touch the origin session's settings (headless run)", async () => {
    await seedProvider(store, secrets);
    const { session, task } = await seedSessionAndTask({ fullAccess: true });
    const { scheduler } = schedulerWith([{ text: "完成" }]);

    await scheduler.runNow(task.id);

    const after = await store.getSession(session.id);
    // fullAccess 任务以 full_access 执行，但不得把原会话翻成 full_access。
    expect(after?.accessMode).toBe("approval");
    expect(after?.providerId).toBeUndefined();
  });

  it("skips tasks that are disabled or not due yet", async () => {
    await seedProvider(store, secrets);
    const { session: disabledSession } = await seedSessionAndTask({ enabled: false });
    const futureSession = await store.createSession({
      projectId: null,
      title: "未来",
      accessMode: "approval"
    });
    await store.createScheduledTask({
      sessionId: futureSession.id,
      name: "未来任务",
      prompt: "稍后再说",
      kind: "recurring",
      cron: "0 9 * * *",
      fullAccess: false,
      nextRunAt: "2999-01-01T00:00:00.000Z"
    });
    const { scheduler } = schedulerWith([{ text: "不应被消费" }]);

    await scheduler.tick();

    expect(await store.listMessages(disabledSession.id)).toHaveLength(0);
    expect(await store.listMessages(futureSession.id)).toHaveLength(0);
  });

  it("skips (without advancing nextRunAt) while the session has an active run", async () => {
    await seedProvider(store, secrets);
    const { session, task } = await seedSessionAndTask();
    const { scheduler, runner } = schedulerWith([{ text: "不应被消费" }]);

    runner.activeSessionIds.add(session.id);
    await scheduler.tick();
    runner.activeSessionIds.delete(session.id);

    expect(await store.listMessages(session.id)).toHaveLength(0);
    const updated = await store.getScheduledTask(task.id);
    // 未推进：下个 tick 仍到期重试。
    expect(updated?.nextRunAt).toBe(PAST);
    expect(updated?.lastRunAt).toBeUndefined();
  });

  it("guards against concurrent executions of the same task", async () => {
    await seedProvider(store, secrets);
    const { session, task } = await seedSessionAndTask();
    const { scheduler } = schedulerWith([{ text: "只执行一次" }, { text: "不应被消费" }]);

    await Promise.all([scheduler.runNow(task.id), scheduler.runNow(task.id)]);

    // busy 防重入：只有一次执行落库（user + assistant 各一条）。
    expect(await store.listMessages(session.id)).toHaveLength(2);
  });

  it("waits for in-flight scheduled runs to settle during stop", async () => {
    const { task } = await seedSessionAndTask();
    let releaseRun!: () => void;
    let markStarted!: () => void;
    const runStarted = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const releasePromise = new Promise<void>((resolve) => {
      releaseRun = resolve;
    });
    const runner = {
      activeSessionIds: new Set<string>(),
      approvals: { decide: vi.fn() },
      abort: vi.fn(() => releaseRun()),
      stream: async function* () {
        yield { type: "run_started", runId: "run_stop", sessionId: task.sessionId } as const;
        markStarted();
        await releasePromise;
        yield { type: "run_end", runId: "run_stop", status: "aborted" } as const;
      }
    } as unknown as AgentRunner;
    const scheduler = new TaskScheduler({ store, runner });

    const running = scheduler.runNow(task.id);
    await runStarted;
    await scheduler.stop();
    await running;

    expect(runner.abort).toHaveBeenCalledWith("run_stop");
    const updated = await store.getScheduledTask(task.id);
    expect(updated?.lastStatus).toBe("aborted");
  });

  it("runNow throws for unknown tasks", async () => {
    const { scheduler } = schedulerWith([]);
    await expect(scheduler.runNow("task_missing")).rejects.toThrow("定时任务不存在");
  });
});

async function seedProvider(
  store: SqliteStateStore,
  secrets: MemorySecretStore
): Promise<void> {
  const apiKeyRef = await secrets.setSecret("deepseek", "test-key");
  const timestamp = nowIso();
  const provider: ProviderConfig = {
    id: "deepseek",
    kind: "deepseek",
    name: "DeepSeek",
    baseURL: "https://api.deepseek.com",
    model: "deepseek-v4-flash",
    apiKeyRef,
    createdAt: timestamp,
    updatedAt: timestamp
  };
  await store.upsertProvider(provider);
}
