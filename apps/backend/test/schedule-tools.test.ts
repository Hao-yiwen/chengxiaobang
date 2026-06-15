import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Session } from "@chengxiaobang/shared";
import { SqliteStateStore } from "../src/repository/sqlite-state-store";
import { createScheduleTools } from "../src/tools/schedule-tools";

describe("schedule tools", () => {
  let dir: string;
  let store: SqliteStateStore;
  let session: Session;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "cxb-schedtools-"));
    store = new SqliteStateStore(join(dir, "state.sqlite"));
    await store.initialize();
    session = await store.createSession({
      projectId: null,
      title: "会话",
      accessMode: "approval"
    });
  });

  afterEach(async () => {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  });

  function tool(name: string, feishuChatId?: string) {
    const tools = createScheduleTools({
      store,
      sessionId: session.id,
      ...(feishuChatId ? { feishuChatId } : {})
    });
    return tools.find((candidate) => candidate.name === name)!;
  }

  it("ScheduleCreate binds the task to the current session and previews next runs", async () => {
    const result = await tool("ScheduleCreate").execute("tc1", {
      kind: "recurring",
      name: "AI 日报",
      cron: "0 9 * * *",
      prompt: "生成 AI 日报"
    });
    const text = result.content[0].type === "text" ? result.content[0].text : "";
    expect(text).toContain("已创建周期定时任务");
    expect(text).toContain("接下来的触发时间");

    const tasks = await store.listScheduledTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      sessionId: session.id,
      kind: "recurring",
      cron: "0 9 * * *",
      fullAccess: false,
      enabled: true
    });
    expect(tasks[0].nextRunAt).toBeDefined();
  });

  it("ScheduleCreate creates a one-time task with a timezone-aware run_at", async () => {
    const result = await tool("ScheduleCreate").execute("tc_once", {
      kind: "once",
      name: "睡觉提醒",
      run_at: "2999-06-13T01:53:00+08:00",
      prompt: "提醒我睡觉"
    });
    const text = result.content[0].type === "text" ? result.content[0].text : "";
    expect(text).toContain("已创建一次性任务");
    expect(text).toContain("计划执行时间");

    const tasks = await store.listScheduledTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      sessionId: session.id,
      kind: "once",
      runAt: "2999-06-12T17:53:00.000Z",
      nextRunAt: "2999-06-12T17:53:00.000Z",
      fullAccess: false,
      enabled: true
    });
    expect(tasks[0].cron).toBeUndefined();
  });

  it("ScheduleCreate rejects one-time run_at without timezone, invalid time, or past time", async () => {
    await expect(
      tool("ScheduleCreate").execute("tc_no_tz", {
        kind: "once",
        name: "无时区",
        run_at: "2999-06-13T01:53:00",
        prompt: "x"
      })
    ).rejects.toThrow("带时区");
    await expect(
      tool("ScheduleCreate").execute("tc_bad_time", {
        kind: "once",
        name: "坏时间",
        run_at: "not-a-timeZ",
        prompt: "x"
      })
    ).rejects.toThrow("时间无效");
    await expect(
      tool("ScheduleCreate").execute("tc_past", {
        kind: "once",
        name: "过去",
        run_at: "2000-01-01T00:00:00Z",
        prompt: "x"
      })
    ).rejects.toThrow("晚于当前时间");
    expect(await store.listScheduledTasks()).toHaveLength(0);
  });

  it("ScheduleCreate rejects invalid cron with a friendly error", async () => {
    await expect(
      tool("ScheduleCreate").execute("tc1", {
        kind: "recurring",
        name: "坏任务",
        cron: "0 0 9 * * *",
        prompt: "x"
      })
    ).rejects.toThrow("5 个字段");
    expect(await store.listScheduledTasks()).toHaveLength(0);
  });

  it("ScheduleCreate rejects missing or mixed schedule fields", async () => {
    await expect(
      tool("ScheduleCreate").execute("tc_missing_run_at", {
        kind: "once",
        name: "少时间",
        prompt: "x"
      })
    ).rejects.toThrow("run_at");
    await expect(
      tool("ScheduleCreate").execute("tc_once_with_cron", {
        kind: "once",
        name: "混传",
        cron: "0 9 * * *",
        run_at: "2999-06-13T01:53:00+08:00",
        prompt: "x"
      })
    ).rejects.toThrow("不要传入 cron");
    await expect(
      tool("ScheduleCreate").execute("tc_missing_cron", {
        kind: "recurring",
        name: "少 cron",
        prompt: "x"
      })
    ).rejects.toThrow("cron");
    await expect(
      tool("ScheduleCreate").execute("tc_recurring_with_run_at", {
        kind: "recurring",
        name: "混传",
        cron: "0 9 * * *",
        run_at: "2999-06-13T01:53:00+08:00",
        prompt: "x"
      })
    ).rejects.toThrow("不要传入 run_at");
    expect(await store.listScheduledTasks()).toHaveLength(0);
  });

  it("ScheduleCreate is refused in Feishu-bound sessions", async () => {
    await expect(
      tool("ScheduleCreate", "oc_chat_1").execute("tc1", {
        kind: "recurring",
        name: "任务",
        cron: "0 9 * * *",
        prompt: "x"
      })
    ).rejects.toThrow("飞书会话暂不支持定时任务");
  });

  it("ScheduleList and ScheduleCancel round-trip", async () => {
    const empty = await tool("ScheduleList").execute("tc0", {});
    expect(empty.content[0]).toMatchObject({ text: "当前没有定时任务。" });

    await tool("ScheduleCreate").execute("tc1", {
      kind: "recurring",
      name: "巡检",
      cron: "*/10 * * * *",
      prompt: "检查",
      full_access: true
    });
    const listed = await tool("ScheduleList").execute("tc2", {});
    const text = listed.content[0].type === "text" ? listed.content[0].text : "";
    expect(text).toContain("巡检");
    expect(text).toContain("*/10 * * * *");
    expect(text).toContain("本会话");

    const taskId = (await store.listScheduledTasks())[0].id;
    await tool("ScheduleCancel").execute("tc3", { id: taskId });
    expect(await store.listScheduledTasks()).toHaveLength(0);

    await expect(tool("ScheduleCancel").execute("tc4", { id: taskId })).rejects.toThrow(
      "定时任务不存在"
    );
  });
});
