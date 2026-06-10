import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { nowIso, type ProviderConfig, type ToolCall } from "@chengxiaobang/shared";
import { SqliteStateStore } from "../src/repository/sqlite-state-store";

describe("SqliteStateStore", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "cxb-store-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("persists projects, sessions, messages, and session settings", async () => {
    const dbPath = join(dir, "state.sqlite");
    const first = new SqliteStateStore(dbPath);
    await first.initialize();
    await seedProviders(first);
    const project = await first.createProject({ name: "demo", path: join(dir, "project") });
    const session = await first.createSession({
      projectId: project.id,
      title: "持久会话",
      providerId: "deepseek",
      accessMode: "approval"
    });
    await first.addMessage({ sessionId: session.id, role: "user", content: "你好" });
    await first.updateSession(session.id, {
      providerId: "kimi",
      accessMode: "full_access"
    });
    await first.close();

    const second = new SqliteStateStore(dbPath);
    await second.initialize();
    const sessions = await second.listSessions(project.id);
    const messages = await second.listMessages(session.id);

    expect(await second.getProjectByPath(join(dir, "project"))).toMatchObject({
      id: project.id,
      name: "demo"
    });
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      id: session.id,
      providerId: "kimi",
      accessMode: "full_access"
    });
    expect(messages).toMatchObject([{ role: "user", content: "你好" }]);
    await second.close();
  });

  it("persists assistant reasoning and its duration across restarts", async () => {
    const dbPath = join(dir, "state.sqlite");
    const first = new SqliteStateStore(dbPath);
    await first.initialize();
    const session = await first.createSession({
      projectId: null,
      title: "带思考",
      accessMode: "approval"
    });
    await first.addMessage({ sessionId: session.id, role: "user", content: "你好" });
    const assistant = await first.addMessage({
      sessionId: session.id,
      role: "assistant",
      content: "答案",
      reasoning: "先想一想",
      reasoningMs: 2500,
      durationMs: 4200
    });
    expect(assistant).toMatchObject({ reasoning: "先想一想", reasoningMs: 2500, durationMs: 4200 });
    await first.close();

    const second = new SqliteStateStore(dbPath);
    await second.initialize();
    const messages = await second.listMessages(session.id);
    await second.close();

    expect(messages).toMatchObject([
      { role: "user", content: "你好" },
      {
        role: "assistant",
        content: "答案",
        reasoning: "先想一想",
        reasoningMs: 2500,
        durationMs: 4200
      }
    ]);
    // A plain message carries no reasoning/duration fields (not even null-ish ones).
    expect(messages[0]).not.toHaveProperty("reasoning");
    expect(messages[0]).not.toHaveProperty("reasoningMs");
    expect(messages[0]).not.toHaveProperty("durationMs");
  });

  it("persists runs and tool calls across store restarts", async () => {
    const dbPath = join(dir, "state.sqlite");
    const first = new SqliteStateStore(dbPath);
    await first.initialize();
    const session = await first.createSession({
      projectId: null,
      title: "工具历史",
      accessMode: "approval"
    });
    await first.createRun({
      id: "run_1",
      sessionId: session.id,
      status: "running"
    });
    const timestamp = nowIso();
    const toolCall: ToolCall = {
      id: "tool_1",
      runId: "run_1",
      name: "list_directory",
      args: { path: "." },
      status: "completed",
      result: "file package.json",
      createdAt: timestamp,
      updatedAt: timestamp
    };
    await first.insertToolCall(toolCall);
    await first.updateRunStatus("run_1", "completed");
    await first.close();

    const second = new SqliteStateStore(dbPath);
    await second.initialize();

    expect(await second.listRuns(session.id)).toMatchObject([
      { id: "run_1", sessionId: session.id, status: "completed" }
    ]);
    expect(await second.listToolCallsForSession(session.id)).toMatchObject([
      {
        id: "tool_1",
        runId: "run_1",
        name: "list_directory",
        args: { path: "." },
        status: "completed",
        result: "file package.json"
      }
    ]);
    await second.close();
  });

  it("deletes a message and everything after it on rewind", async () => {
    const store = new SqliteStateStore(join(dir, "state.sqlite"));
    await store.initialize();
    const session = await store.createSession({
      projectId: null,
      title: "回退",
      accessMode: "approval"
    });
    const first = await store.addMessage({ sessionId: session.id, role: "user", content: "一" });
    await tick();
    const second = await store.addMessage({
      sessionId: session.id,
      role: "assistant",
      content: "二"
    });
    await tick();
    // Runs (and their tool calls) created at/after the rewind point are removed too.
    await store.createRun({ id: "run_late", sessionId: session.id, status: "completed" });
    const timestamp = nowIso();
    await store.insertToolCall({
      id: "tool_late",
      runId: "run_late",
      name: "shell",
      args: { command: "pwd" },
      status: "completed",
      result: "/tmp",
      createdAt: timestamp,
      updatedAt: timestamp
    });
    await store.addMessage({ sessionId: session.id, role: "user", content: "三" });
    await store.addMessage({ sessionId: session.id, role: "assistant", content: "四" });

    expect(await store.deleteMessagesFrom(session.id, second.id)).toBe(3);
    expect(await store.listMessages(session.id)).toMatchObject([
      { id: first.id, content: "一" }
    ]);
    expect(await store.listRuns(session.id)).toEqual([]);
    expect(await store.listToolCallsForSession(session.id)).toEqual([]);

    expect(await store.deleteMessagesFrom(session.id, "msg_missing")).toBe(0);
    expect(await store.listMessages(session.id)).toHaveLength(1);

    await store.close();
  });

  it("rejects messages for missing sessions", async () => {
    const store = new SqliteStateStore(join(dir, "state.sqlite"));
    await store.initialize();

    await expect(
      store.addMessage({ sessionId: "missing", role: "user", content: "hi" })
    ).rejects.toThrow("会话不存在");

    await store.close();
  });

  it("deletes sessions with their persisted history", async () => {
    const store = new SqliteStateStore(join(dir, "state.sqlite"));
    await store.initialize();
    const session = await store.createSession({
      projectId: null,
      title: "待删除",
      accessMode: "approval"
    });
    await store.addMessage({ sessionId: session.id, role: "user", content: "hi" });

    expect(await store.deleteSession(session.id)).toBe(true);
    expect(await store.getSession(session.id)).toBeUndefined();
    await expect(store.listMessages(session.id)).rejects.toThrow("会话不存在");
    expect(await store.deleteSession(session.id)).toBe(false);

    await store.close();
  });

  it("deletes a provider and nulls references from sessions", async () => {
    const store = new SqliteStateStore(join(dir, "state.sqlite"));
    await store.initialize();
    await seedProviders(store);
    const session = await store.createSession({
      projectId: null,
      title: "用 deepseek",
      providerId: "deepseek",
      accessMode: "approval"
    });

    expect(await store.deleteProvider("deepseek")).toBe(true);
    expect(await store.getProvider("deepseek")).toBeUndefined();
    expect(await store.deleteProvider("deepseek")).toBe(false);
    const reloaded = await store.getSession(session.id);
    expect(reloaded?.providerId).toBeUndefined();

    await store.close();
  });

  it("starts without implicit providers", async () => {
    const store = new SqliteStateStore(join(dir, "state.sqlite"));
    await store.initialize();

    expect(await store.listProviders()).toEqual([]);

    await store.close();
  });

  it("migrates legacy built-in provider presets to current official models", async () => {
    const dbPath = join(dir, "state.sqlite");
    const first = new SqliteStateStore(dbPath);
    await first.initialize();
    const timestamp = nowIso();
    await first.upsertProvider({
      id: "deepseek",
      kind: "deepseek",
      name: "DeepSeek",
      baseURL: "https://api.deepseek.com",
      model: "deepseek-chat",
      apiKeyRef: "memory:deepseek",
      createdAt: timestamp,
      updatedAt: timestamp
    });
    await first.upsertProvider({
      id: "kimi",
      kind: "kimi",
      name: "Kimi",
      baseURL: "https://api.moonshot.cn/v1",
      model: "moonshot-v1-8k",
      apiKeyRef: "memory:kimi",
      createdAt: timestamp,
      updatedAt: timestamp
    });
    await first.close();

    const second = new SqliteStateStore(dbPath);
    await second.initialize();

    await expect(second.getProvider("deepseek")).resolves.toMatchObject({
      model: "deepseek-v4-flash",
      apiKeyRef: "memory:deepseek"
    });
    await expect(second.getProvider("kimi")).resolves.toMatchObject({
      baseURL: "https://api.moonshot.ai/v1",
      model: "kimi-k2.6",
      apiKeyRef: "memory:kimi"
    });

    await second.close();
  });
});

/** Waits past the millisecond so ISO created_at timestamps are strictly ordered. */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 2));
}

async function seedProviders(store: SqliteStateStore): Promise<void> {
  const timestamp = nowIso();
  const providers: ProviderConfig[] = [
    {
      id: "deepseek",
      kind: "deepseek",
      name: "DeepSeek",
      baseURL: "https://api.deepseek.com",
      model: "deepseek-v4-flash",
      apiKeyRef: "memory:deepseek",
      createdAt: timestamp,
      updatedAt: timestamp
    },
    {
      id: "kimi",
      kind: "kimi",
      name: "Kimi",
      baseURL: "https://api.moonshot.ai/v1",
      model: "kimi-k2.6",
      apiKeyRef: "memory:kimi",
      createdAt: timestamp,
      updatedAt: timestamp
    }
  ];
  for (const provider of providers) {
    await store.upsertProvider(provider);
  }
}
