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

  it("schedule_create binds the task to the current session and previews next runs", async () => {
    const result = await tool("schedule_create").execute("tc1", {
      name: "AI 日报",
      cron: "0 9 * * *",
      prompt: "生成 AI 日报"
    });
    const text = result.content[0].type === "text" ? result.content[0].text : "";
    expect(text).toContain("已创建定时任务");
    expect(text).toContain("接下来的触发时间");

    const tasks = await store.listScheduledTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      sessionId: session.id,
      cron: "0 9 * * *",
      fullAccess: false,
      enabled: true
    });
    expect(tasks[0].nextRunAt).toBeDefined();
  });

  it("schedule_create rejects invalid cron with a friendly error", async () => {
    await expect(
      tool("schedule_create").execute("tc1", {
        name: "坏任务",
        cron: "0 0 9 * * *",
        prompt: "x"
      })
    ).rejects.toThrow("5 个字段");
    expect(await store.listScheduledTasks()).toHaveLength(0);
  });

  it("schedule_create is refused in Feishu-bound sessions", async () => {
    await expect(
      tool("schedule_create", "oc_chat_1").execute("tc1", {
        name: "任务",
        cron: "0 9 * * *",
        prompt: "x"
      })
    ).rejects.toThrow("飞书会话暂不支持定时任务");
  });

  it("schedule_list and schedule_cancel round-trip", async () => {
    const empty = await tool("schedule_list").execute("tc0", {});
    expect(empty.content[0]).toMatchObject({ text: "当前没有定时任务。" });

    await tool("schedule_create").execute("tc1", {
      name: "巡检",
      cron: "*/10 * * * *",
      prompt: "检查",
      full_access: true
    });
    const listed = await tool("schedule_list").execute("tc2", {});
    const text = listed.content[0].type === "text" ? listed.content[0].text : "";
    expect(text).toContain("巡检");
    expect(text).toContain("*/10 * * * *");
    expect(text).toContain("本会话");

    const taskId = (await store.listScheduledTasks())[0].id;
    await tool("schedule_cancel").execute("tc3", { id: taskId });
    expect(await store.listScheduledTasks()).toHaveLength(0);

    await expect(tool("schedule_cancel").execute("tc4", { id: taskId })).rejects.toThrow(
      "定时任务不存在"
    );
  });
});
