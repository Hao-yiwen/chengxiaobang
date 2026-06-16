import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import initSqlJs from "sql.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  nowIso,
  resolveProviderModelMaxToolIterations,
  type ProviderConfig,
  type ToolCall
} from "@chengxiaobang/shared";
import { resolveSqlWasmPath } from "../src/repository/sqlite-runtime";
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

  it("persists concurrent writes through the serialized flush queue", async () => {
    const dbPath = join(dir, "state.sqlite");
    const first = new SqliteStateStore(dbPath);
    await first.initialize();
    const session = await first.createSession({
      projectId: null,
      title: "并发写入",
      accessMode: "approval"
    });

    await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        first.addMessage({
          sessionId: session.id,
          role: "user",
          content: `message-${index}`
        })
      )
    );
    await first.close();

    const second = new SqliteStateStore(dbPath);
    await second.initialize();
    const messages = await second.listMessages(session.id);
    expect(messages.map((message) => message.content).sort()).toEqual(
      Array.from({ length: 20 }, (_, index) => `message-${index}`).sort()
    );
    await second.close();
  });

  it("deletes a project together with its sessions and history", async () => {
    const store = new SqliteStateStore(join(dir, "state.sqlite"));
    await store.initialize();
    const project = await store.createProject({ name: "demo", path: join(dir, "p") });
    const session = await store.createSession({
      projectId: project.id,
      title: "会话",
      accessMode: "approval"
    });
    await store.addMessage({ sessionId: session.id, role: "user", content: "hi" });

    expect(await store.deleteProject(project.id)).toBe(true);
    expect(await store.getProject(project.id)).toBeUndefined();
    expect(await store.getSession(session.id)).toBeUndefined();
    expect(await store.deleteProject(project.id)).toBe(false);
    await store.close();
  });

  it("置顶/取消置顶不触碰 updated_at 且跨重启持久化", async () => {
    const dbPath = join(dir, "state.sqlite");
    const first = new SqliteStateStore(dbPath);
    await first.initialize();
    const project = await first.createProject({ name: "demo", path: join(dir, "p") });
    const session = await first.createSession({
      projectId: project.id,
      title: "置顶会话",
      accessMode: "approval"
    });

    const pinnedSession = await first.setSessionPinned(session.id, true);
    expect(pinnedSession.pinnedAt).toEqual(expect.any(String));
    // 置顶不 bump updated_at，否则会把会话顶到普通列表最前。
    expect(pinnedSession.updatedAt).toBe(session.updatedAt);
    const pinnedProject = await first.setProjectPinned(project.id, true);
    expect(pinnedProject.pinnedAt).toEqual(expect.any(String));
    expect(pinnedProject.updatedAt).toBe(project.updatedAt);
    await first.close();

    // 重开覆盖 ensureColumn 迁移与行映射。
    const second = new SqliteStateStore(dbPath);
    await second.initialize();
    expect((await second.listSessions(project.id))[0]?.pinnedAt).toBe(pinnedSession.pinnedAt);
    expect((await second.listProjects())[0]?.pinnedAt).toBe(pinnedProject.pinnedAt);

    // 防回归：updateSession 不得清掉置顶状态。
    const renamed = await second.updateSession(session.id, { title: "改名" });
    expect(renamed.pinnedAt).toBe(pinnedSession.pinnedAt);

    expect((await second.setSessionPinned(session.id, false)).pinnedAt).toBeUndefined();
    expect((await second.setProjectPinned(project.id, false)).pinnedAt).toBeUndefined();
    await second.close();
  });

  it("searches sessions by title and user or assistant content only", async () => {
    const store = new SqliteStateStore(join(dir, "state.sqlite"));
    await store.initialize();
    const titleSession = await store.createSession({
      projectId: null,
      title: "火星计划讨论",
      accessMode: "approval"
    });
    await store.addMessage({
      sessionId: titleSession.id,
      role: "assistant",
      content: "正文也提到火星计划时仍应按标题命中返回"
    });
    await tick();
    const userSession = await store.createSession({
      projectId: null,
      title: "用户正文会话",
      accessMode: "approval"
    });
    const userMessage = await store.addMessage({
      sessionId: userSession.id,
      role: "user",
      content: "请帮我整理火星计划的阶段目标。"
    });
    await tick();
    const assistantSession = await store.createSession({
      projectId: null,
      title: "助手正文会话",
      accessMode: "approval"
    });
    const assistantMessage = await store.addMessage({
      sessionId: assistantSession.id,
      role: "assistant",
      content: "火星计划需要先拆成任务清单。"
    });
    await tick();
    const toolSession = await store.createSession({
      projectId: null,
      title: "工具结果会话",
      accessMode: "approval"
    });
    await store.addMessage({
      sessionId: toolSession.id,
      role: "tool",
      content: "工具输出里的火星计划不应该被搜索到。"
    });
    await tick();
    const systemSession = await store.createSession({
      projectId: null,
      title: "系统消息会话",
      accessMode: "approval"
    });
    await store.addMessage({
      sessionId: systemSession.id,
      role: "system",
      content: "系统消息里的火星计划不应该被搜索到。"
    });

    const results = await store.searchSessions("火星计划");
    expect(results[0]).toMatchObject({
      session: { id: titleSession.id },
      matchType: "title"
    });
    expect(results.map((result) => result.session.id)).toEqual([
      titleSession.id,
      assistantSession.id,
      userSession.id
    ]);
    expect(results.filter((result) => result.session.id === titleSession.id)).toHaveLength(1);
    const userHit = results.find((result) => result.session.id === userSession.id);
    expect(userHit).toMatchObject({
      matchType: "content",
      messageId: userMessage.id,
      role: "user"
    });
    expect(userHit?.matchType === "content" ? userHit.snippet : "").toContain("火星计划");
    expect(results.find((result) => result.session.id === assistantSession.id)).toMatchObject({
      matchType: "content",
      messageId: assistantMessage.id,
      role: "assistant"
    });
    expect(results.some((result) => result.session.id === toolSession.id)).toBe(false);
    expect(results.some((result) => result.session.id === systemSession.id)).toBe(false);
    await store.close();
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

  it("round-trips the pi message payload and leaves it absent when unset", async () => {
    const dbPath = join(dir, "state.sqlite");
    const first = new SqliteStateStore(dbPath);
    await first.initialize();
    const session = await first.createSession({
      projectId: null,
      title: "payload",
      accessMode: "approval"
    });
    await first.addMessage({ sessionId: session.id, role: "user", content: "你好" });
    const payload = JSON.stringify({ role: "assistant", content: [{ type: "text", text: "答" }] });
    const assistant = await first.addMessage({
      sessionId: session.id,
      role: "assistant",
      content: "答",
      payload
    });
    expect(assistant.payload).toBe(payload);
    await first.close();

    const second = new SqliteStateStore(dbPath);
    await second.initialize();
    const messages = await second.listMessages(session.id);
    await second.close();

    expect(messages[0]).not.toHaveProperty("payload");
    expect(messages[1].payload).toBe(payload);
  });

  it("round-trips visible message attachments across restarts", async () => {
    const dbPath = join(dir, "state.sqlite");
    const first = new SqliteStateStore(dbPath);
    await first.initialize();
    const session = await first.createSession({
      projectId: null,
      title: "attachments",
      accessMode: "approval"
    });
    await first.addMessage({
      sessionId: session.id,
      role: "user",
      content: "看图",
      attachments: [
        {
          id: "attachment_1",
          name: "photo.png",
          kind: "image",
          mimeType: "image/png",
          size: 100,
          path: "/tmp/cxb/photo.png"
        }
      ]
    });
    await first.close();

    const second = new SqliteStateStore(dbPath);
    await second.initialize();
    const messages = await second.listMessages(session.id);
    await second.close();

    expect(messages[0].attachments).toEqual([
      {
        id: "attachment_1",
        name: "photo.png",
        kind: "image",
        mimeType: "image/png",
        size: 100,
        path: "/tmp/cxb/photo.png"
      }
    ]);
  });

  it("clones the payload when forking a session", async () => {
    const store = new SqliteStateStore(join(dir, "state.sqlite"));
    await store.initialize();
    const source = await store.createSession({
      projectId: null,
      title: "原会话",
      accessMode: "approval"
    });
    await store.addMessage({ sessionId: source.id, role: "user", content: "一" });
    await tick();
    const payload = JSON.stringify({ role: "assistant", content: [{ type: "text", text: "二" }] });
    const assistant = await store.addMessage({
      sessionId: source.id,
      role: "assistant",
      content: "二",
      payload
    });

    const fork = await store.forkSession(source.id, assistant.id);
    const cloned = await store.listMessages(fork.id);

    expect(cloned[0]).not.toHaveProperty("payload");
    expect(cloned[1].payload).toBe(payload);
    await store.close();
  });

  it("clones visible attachments when forking a session", async () => {
    const store = new SqliteStateStore(join(dir, "state.sqlite"));
    await store.initialize();
    const source = await store.createSession({
      projectId: null,
      title: "原会话",
      accessMode: "approval"
    });
    const first = await store.addMessage({
      sessionId: source.id,
      role: "user",
      content: "看图",
      attachments: [
        {
          id: "attachment_1",
          name: "photo.png",
          kind: "image",
          mimeType: "image/png",
          size: 100,
          path: "/tmp/cxb/photo.png"
        }
      ]
    });

    const fork = await store.forkSession(source.id, first.id);
    const cloned = await store.listMessages(fork.id);

    expect(cloned[0].attachments?.[0]).toMatchObject({
      id: "attachment_1",
      name: "photo.png",
      kind: "image"
    });
    await store.close();
  });

  it("inherits model memory when forking a session", async () => {
    const store = new SqliteStateStore(join(dir, "state.sqlite"));
    await store.initialize();
    const source = await store.createSession({
      projectId: null,
      title: "原会话",
      providerId: "deepseek",
      accessMode: "approval",
      model: "deepseek-v4-pro",
      reasoningMode: "high"
    });
    const first = await store.addMessage({
      sessionId: source.id,
      role: "user",
      content: "从这里分支"
    });

    const fork = await store.forkSession(source.id, first.id);

    expect(fork).toMatchObject({
      providerId: "deepseek",
      model: "deepseek-v4-pro",
      reasoningMode: "high"
    });
    await store.close();
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
      status: "running",
      providerId: "deepseek",
      providerKind: "deepseek",
      model: "deepseek-v4-flash"
    });
    await first.createRun({
      id: "run_2",
      sessionId: session.id,
      status: "running"
    });
    const timestamp = nowIso();
    const toolCall: ToolCall = {
      id: "tool_1",
      runId: "run_1",
      name: "LS",
      args: { path: "." },
      status: "completed",
      result: "file package.json",
      createdAt: timestamp,
      updatedAt: timestamp
    };
    await first.insertToolCall(toolCall);
    await first.updateRunStatus("run_1", "completed");
    await first.updateRunStatus("run_1", "completed", {
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
      costUsd: 0.00042
    });
    await first.updateRunStatus("run_2", "failed", undefined, "模型 token 超限");
    await first.close();

    const second = new SqliteStateStore(dbPath);
    await second.initialize();

    expect(await second.listRuns(session.id)).toMatchObject([
      {
        id: "run_1",
        sessionId: session.id,
        status: "completed",
        providerId: "deepseek",
        providerKind: "deepseek",
        model: "deepseek-v4-flash",
        usage: {
          promptTokens: 10,
          completionTokens: 5,
          totalTokens: 15,
          costUsd: 0.00042
        }
      },
      {
        id: "run_2",
        sessionId: session.id,
        status: "failed",
        error: "模型 token 超限"
      }
    ]);
    expect(await second.listToolCallsForSession(session.id)).toMatchObject([
      {
        id: "tool_1",
        runId: "run_1",
        name: "LS",
        args: { path: "." },
        status: "completed",
        result: "file package.json"
      }
    ]);
    await second.close();
  });

  it("marks running runs from a previous backend process as failed on startup", async () => {
    const dbPath = join(dir, "state.sqlite");
    const first = new SqliteStateStore(dbPath);
    await first.initialize();
    const session = await first.createSession({
      projectId: null,
      title: "遗留审批",
      accessMode: "approval"
    });
    await first.createRun({
      id: "run_interrupted",
      sessionId: session.id,
      status: "running"
    });
    const timestamp = nowIso();
    await first.insertToolCall({
      id: "tool_pending",
      runId: "run_interrupted",
      name: "Write",
      args: { file_path: "a.txt", content: "ok" },
      status: "pending_approval",
      createdAt: timestamp,
      updatedAt: timestamp
    });
    await first.insertToolCall({
      id: "tool_smart_pending",
      runId: "run_interrupted",
      name: "Edit",
      args: { file_path: "a.txt", old_string: "a", new_string: "b" },
      status: "pending_smart_approval",
      createdAt: timestamp,
      updatedAt: timestamp
    });
    await first.insertToolCall({
      id: "tool_running",
      runId: "run_interrupted",
      name: "Bash",
      args: { command: "echo hi" },
      status: "running",
      startedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp
    });
    await first.insertToolCall({
      id: "tool_completed",
      runId: "run_interrupted",
      name: "Read",
      args: { file_path: "done.txt" },
      status: "completed",
      result: "done",
      createdAt: timestamp,
      updatedAt: timestamp
    });
    await first.close();

    const second = new SqliteStateStore(dbPath);
    await second.initialize();

    const [run] = await second.listRuns(session.id);
    expect(run).toMatchObject({
      id: "run_interrupted",
      status: "failed"
    });
    expect(run?.error).toContain("运行进程已重启");
    const toolCalls = await second.listToolCallsForSession(session.id);
    expect(toolCalls.find((toolCall) => toolCall.id === "tool_pending")).toMatchObject({
      status: "failed",
      result: expect.stringContaining("运行进程已重启")
    });
    expect(toolCalls.find((toolCall) => toolCall.id === "tool_smart_pending")).toMatchObject({
      status: "failed",
      result: expect.stringContaining("运行进程已重启")
    });
    expect(toolCalls.find((toolCall) => toolCall.id === "tool_running")).toMatchObject({
      status: "failed",
      result: expect.stringContaining("运行进程已重启")
    });
    expect(toolCalls.find((toolCall) => toolCall.id === "tool_completed")).toMatchObject({
      status: "completed",
      result: "done"
    });
    await second.close();
  });

  it("round-trips message kind and keeps the compaction pointer across unrelated updates", async () => {
    const dbPath = join(dir, "state.sqlite");
    const store = new SqliteStateStore(dbPath);
    await store.initialize();
    const session = await store.createSession({
      projectId: null,
      title: "压缩",
      accessMode: "approval"
    });
    const plain = await store.addMessage({ sessionId: session.id, role: "user", content: "你好" });
    await store.addMessage({
      sessionId: session.id,
      role: "assistant",
      kind: "compaction_summary",
      content: "摘要"
    });
    await store.updateSession(session.id, { compactedUpToMessageId: plain.id });

    // The run-start update (provider/accessMode only) must not clobber the pointer.
    await store.updateSession(session.id, { title: "改名", accessMode: "full_access" });
    expect((await store.getSession(session.id))?.compactedUpToMessageId).toBe(plain.id);

    // Explicit null clears it.
    await store.updateSession(session.id, { compactedUpToMessageId: null });
    expect((await store.getSession(session.id))?.compactedUpToMessageId).toBeUndefined();

    const messages = await store.listMessages(session.id);
    expect(messages[0]).not.toHaveProperty("kind");
    expect(messages[1].kind).toBe("compaction_summary");
    await store.close();
  });

  it("round-trips a tool call's startedAt and leaves it absent when unset", async () => {
    const dbPath = join(dir, "state.sqlite");
    const first = new SqliteStateStore(dbPath);
    await first.initialize();
    const session = await first.createSession({
      projectId: null,
      title: "执行计时",
      accessMode: "approval"
    });
    await first.createRun({ id: "run_1", sessionId: session.id, status: "completed" });
    const createdAt = nowIso();
    await first.insertToolCall({
      id: "tool_1",
      runId: "run_1",
      name: "Write",
      args: { file_path: "a.txt", content: "hi" },
      status: "pending_approval",
      createdAt,
      updatedAt: createdAt
    });
    // Approval granted later: the running transition stamps startedAt.
    const startedAt = nowIso();
    await first.updateToolCall({
      id: "tool_1",
      runId: "run_1",
      name: "Write",
      args: { file_path: "a.txt", content: "hi" },
      status: "completed",
      result: "已写入",
      startedAt,
      createdAt,
      updatedAt: nowIso()
    });
    await first.close();

    const second = new SqliteStateStore(dbPath);
    await second.initialize();
    const [reloaded] = await second.listToolCallsForSession(session.id);
    expect(reloaded.startedAt).toBe(startedAt);

    // A second tool call without startedAt stays without the property.
    await second.insertToolCall({
      id: "tool_2",
      runId: "run_1",
      name: "Read",
      args: { file_path: "a.txt" },
      status: "pending_approval",
      createdAt: nowIso(),
      updatedAt: nowIso()
    });
    const calls = await second.listToolCallsForSession(session.id);
    expect(calls.find((call) => call.id === "tool_2")).not.toHaveProperty("startedAt");
    await second.close();
  });

  it("round-trips smart approval mode and tool approval metadata", async () => {
    const dbPath = join(dir, "state.sqlite");
    const first = new SqliteStateStore(dbPath);
    await first.initialize();
    const session = await first.createSession({
      projectId: null,
      title: "智能审批",
      accessMode: "smart_approval"
    });
    await first.createRun({ id: "run_1", sessionId: session.id, status: "completed" });
    const timestamp = nowIso();
    await first.insertToolCall({
      id: "tool_1",
      runId: "run_1",
      name: "Write",
      args: { file_path: "smart.txt", content: "hi" },
      status: "pending_smart_approval",
      approval: {
        kind: "smart",
        source: "model",
        verdict: "allow",
        risk: "low",
        score: 0.1,
        reason: "普通文件写入",
        decidedAt: timestamp
      },
      createdAt: timestamp,
      updatedAt: timestamp
    });
    await first.close();

    const second = new SqliteStateStore(dbPath);
    await second.initialize();
    const [sessionAgain] = await second.listSessions();
    const [toolCall] = await second.listToolCallsForSession(session.id);
    expect(sessionAgain.accessMode).toBe("smart_approval");
    expect(toolCall).toMatchObject({
      status: "pending_smart_approval",
      approval: {
        verdict: "allow",
        reason: "普通文件写入"
      }
    });
    await second.close();
  });

  it("updateToolCall 持久化 legacy editedSteps 写回后的 args（跨重启可恢复）", async () => {
    const dbPath = join(dir, "state.sqlite");
    const first = new SqliteStateStore(dbPath);
    await first.initialize();
    const session = await first.createSession({
      projectId: null,
      title: "计划确认",
      accessMode: "approval"
    });
    await first.createRun({ id: "run_1", sessionId: session.id, status: "running" });
    const createdAt = nowIso();
    await first.insertToolCall({
      id: "tool_plan",
      runId: "run_1",
      name: "ExitPlanMode",
      args: { title: "计划", steps: [{ id: "s1", title: "原步骤" }] },
      status: "pending_approval",
      createdAt,
      updatedAt: createdAt
    });
    // 旧客户端确认时携带 editedSteps：args 与状态仍可在同一次 update 中写回。
    await first.updateToolCall({
      id: "tool_plan",
      runId: "run_1",
      name: "ExitPlanMode",
      args: { title: "计划", steps: [{ id: "s1", title: "编辑后的步骤", status: "pending" }] },
      status: "completed",
      result: "{}",
      createdAt,
      updatedAt: nowIso()
    });
    await first.close();

    const second = new SqliteStateStore(dbPath);
    await second.initialize();
    const [reloaded] = await second.listToolCallsForSession(session.id);
    expect(reloaded.status).toBe("completed");
    expect((reloaded.args.steps as Array<{ title: string }>)[0].title).toBe("编辑后的步骤");
    await second.close();
  });

  it("migrates sessions model fields and round-trips session model/reasoning memory（§6.2）", async () => {
    const dbPath = join(dir, "state.sqlite");
    // 旧库：先建一个不含 model 列语义的会话（列由 ensureColumn 迁移补上）。
    const first = new SqliteStateStore(dbPath);
    await first.initialize();
    await seedProviders(first);
    const legacy = await first.createSession({
      projectId: null,
      title: "旧会话",
      providerId: "deepseek",
      accessMode: "approval"
    });
    expect(legacy).not.toHaveProperty("model");
    expect(legacy).not.toHaveProperty("reasoningMode");
    await first.close();

    // 重新打开（触发迁移路径）：旧数据不丢，新会话可带 model。
    const second = new SqliteStateStore(dbPath);
    await second.initialize();
    expect(await second.getSession(legacy.id)).toMatchObject({ title: "旧会话" });
    expect(await second.getSession(legacy.id)).not.toHaveProperty("model");
    expect(await second.getSession(legacy.id)).not.toHaveProperty("reasoningMode");

    const withModel = await second.createSession({
      projectId: null,
      title: "带模型",
      providerId: "deepseek",
      accessMode: "approval",
      model: "deepseek-reasoner",
      reasoningMode: "high"
    });
    expect(withModel.model).toBe("deepseek-reasoner");
    expect(withModel.reasoningMode).toBe("high");

    // updateSession：undefined 保留、字符串覆盖、null 清空。
    const untouched = await second.updateSession(withModel.id, { accessMode: "full_access" });
    expect(untouched.model).toBe("deepseek-reasoner");
    expect(untouched.reasoningMode).toBe("high");
    const switched = await second.updateSession(withModel.id, {
      model: "deepseek-chat",
      reasoningMode: "xhigh"
    });
    expect(switched.model).toBe("deepseek-chat");
    expect(switched.reasoningMode).toBe("xhigh");
    await second.close();

    const third = new SqliteStateStore(dbPath);
    await third.initialize();
    expect((await third.getSession(withModel.id))?.model).toBe("deepseek-chat");
    expect((await third.getSession(withModel.id))?.reasoningMode).toBe("xhigh");
    const cleared = await third.updateSession(withModel.id, {
      model: null,
      reasoningMode: null
    });
    expect(cleared.model).toBeUndefined();
    expect(cleared.reasoningMode).toBeUndefined();
    expect(await third.getSession(withModel.id)).not.toHaveProperty("model");
    expect(await third.getSession(withModel.id)).not.toHaveProperty("reasoningMode");
    await third.close();
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
      name: "Bash",
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

  it("deletes a run created before the rewound user message when it was updated later", async () => {
    const store = new SqliteStateStore(join(dir, "state.sqlite"));
    await store.initialize();
    const session = await store.createSession({
      projectId: null,
      title: "重试清理",
      accessMode: "approval"
    });

    await store.createRun({ id: "run_interrupted", sessionId: session.id, status: "running" });
    await tick();
    const userMessage = await store.addMessage({
      sessionId: session.id,
      role: "user",
      content: "帮我重写页面"
    });
    await tick();
    const timestamp = nowIso();
    await store.insertToolCall({
      id: "tool_interrupted",
      runId: "run_interrupted",
      name: "Write",
      args: { file_path: "app/globals.css", content: "body {}" },
      status: "failed",
      result: "运行进程已重启，无法继续等待审批或工具结果。请重新发起本次请求。",
      createdAt: timestamp,
      updatedAt: timestamp
    });
    await store.updateRunStatus(
      "run_interrupted",
      "failed",
      undefined,
      "运行进程已重启，无法继续等待审批或工具结果。请重新发起本次请求。"
    );

    expect(await store.deleteMessagesFrom(session.id, userMessage.id)).toBe(1);
    expect(await store.listMessages(session.id)).toEqual([]);
    expect(await store.listRuns(session.id)).toEqual([]);
    expect(await store.listToolCallsForSession(session.id)).toEqual([]);

    await store.close();
  });

  it("binds sessions to feishu chats and finds them by chat id", async () => {
    const store = new SqliteStateStore(join(dir, "state.sqlite"));
    await store.initialize();
    const session = await store.createSession({
      projectId: null,
      title: "飞书 · 张三",
      accessMode: "approval",
      feishuChatId: "oc_abc123"
    });

    expect(session.feishuChatId).toBe("oc_abc123");
    await expect(store.findSessionByFeishuChatId("oc_abc123")).resolves.toMatchObject({
      id: session.id,
      title: "飞书 · 张三"
    });
    await expect(store.findSessionByFeishuChatId("oc_other")).resolves.toBeUndefined();

    // The per-run session update must not clobber the binding.
    await store.updateSession(session.id, { accessMode: "full_access" });
    await expect(store.findSessionByFeishuChatId("oc_abc123")).resolves.toMatchObject({
      id: session.id
    });

    // Plain sessions carry no binding at all.
    const plain = await store.createSession({
      projectId: null,
      title: "普通会话",
      accessMode: "approval"
    });
    expect(plain).not.toHaveProperty("feishuChatId");
    await store.close();
  });

  it("binds sessions to wechat contacts and finds them by chat id", async () => {
    const store = new SqliteStateStore(join(dir, "state.sqlite"));
    await store.initialize();
    const session = await store.createSession({
      projectId: null,
      title: "微信 · 小王",
      accessMode: "approval",
      wechatChatId: "wx_user1"
    });

    expect(session.wechatChatId).toBe("wx_user1");
    await expect(store.findSessionByWechatChatId("wx_user1")).resolves.toMatchObject({
      id: session.id,
      title: "微信 · 小王"
    });
    await expect(store.findSessionByWechatChatId("wx_other")).resolves.toBeUndefined();

    await store.updateSession(session.id, { accessMode: "full_access" });
    await expect(store.findSessionByWechatChatId("wx_user1")).resolves.toMatchObject({
      id: session.id
    });

    const plain = await store.createSession({
      projectId: null,
      title: "普通会话",
      accessMode: "approval"
    });
    expect(plain).not.toHaveProperty("wechatChatId");
    await store.close();
  });

  it("round-trips key-value settings across restarts", async () => {
    const dbPath = join(dir, "state.sqlite");
    const first = new SqliteStateStore(dbPath);
    await first.initialize();

    expect(await first.getSetting("feishu")).toBeUndefined();
    await first.setSetting("feishu", JSON.stringify({ enabled: false }));
    await first.setSetting("feishu", JSON.stringify({ enabled: true }));
    expect(await first.getSetting("feishu")).toBe(JSON.stringify({ enabled: true }));
    await first.close();

    const second = new SqliteStateStore(dbPath);
    await second.initialize();
    expect(await second.getSetting("feishu")).toBe(JSON.stringify({ enabled: true }));
    await second.close();
  });

  it("forks a session by cloning the message prefix with fresh ids", async () => {
    const store = new SqliteStateStore(join(dir, "state.sqlite"));
    await store.initialize();
    const source = await store.createSession({
      projectId: null,
      title: "原会话",
      accessMode: "full_access"
    });
    const first = await store.addMessage({ sessionId: source.id, role: "user", content: "一" });
    await tick();
    const second = await store.addMessage({
      sessionId: source.id,
      role: "assistant",
      content: "二",
      reasoning: "想了想",
      reasoningMs: 800
    });
    await tick();
    await store.addMessage({ sessionId: source.id, role: "user", content: "三" });
    await store.updateSession(source.id, { compactedUpToMessageId: first.id });

    const fork = await store.forkSession(source.id, second.id);

    expect(fork.parentSessionId).toBe(source.id);
    expect(fork.forkMessageId).toBe(second.id);
    expect(fork.title).toBe("原会话");
    expect(fork.accessMode).toBe("full_access");

    const cloned = await store.listMessages(fork.id);
    expect(cloned.map((message) => message.content)).toEqual(["一", "二"]);
    expect(fork.forkPointMessageId).toBe(cloned[1].id);
    // Fresh ids, preserved timestamps and reasoning fields.
    expect(cloned[0].id).not.toBe(first.id);
    expect(cloned[1].id).not.toBe(second.id);
    expect(cloned[0].createdAt).toBe(first.createdAt);
    expect(cloned[1]).toMatchObject({ reasoning: "想了想", reasoningMs: 800 });
    // The compaction pointer is remapped to the cloned row's id.
    expect(fork.compactedUpToMessageId).toBe(cloned[0].id);

    // Deleting the parent leaves the branch intact.
    await store.deleteSession(source.id);
    expect((await store.listMessages(fork.id)).map((m) => m.content)).toEqual(["一", "二"]);

    await expect(store.forkSession("missing", second.id)).rejects.toThrow("会话不存在");
    await expect(store.forkSession(fork.id, "msg_missing")).rejects.toThrow("消息不存在");

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

  it("round-trips provider reasoning defaults", async () => {
    const dbPath = join(dir, "state.sqlite");
    const first = new SqliteStateStore(dbPath);
    await first.initialize();
    const timestamp = nowIso();
    await first.upsertProvider({
      id: "deepseek",
      kind: "deepseek",
      name: "DeepSeek",
      baseURL: "https://api.deepseek.com",
      model: "deepseek-v4-pro",
      models: ["deepseek-v4-flash", "deepseek-v4-pro"],
      modelOverrides: {
        "deepseek-v4-flash": { maxToolIterations: 500 },
        "deepseek-v4-pro": { maxToolIterations: 900 }
      },
      reasoningMode: "xhigh",
      apiKeyRef: "memory:deepseek",
      createdAt: timestamp,
      updatedAt: timestamp
    });
    await first.close();

    const second = new SqliteStateStore(dbPath);
    await second.initialize();
    await expect(second.getProvider("deepseek")).resolves.toMatchObject({
      model: "deepseek-v4-pro",
      modelOverrides: {
        "deepseek-v4-flash": { maxToolIterations: 500 },
        "deepseek-v4-pro": { maxToolIterations: 900 }
      },
      reasoningMode: "xhigh"
    });
    await second.close();
  });

  it("migrates legacy provider rows without model overrides", async () => {
    const dbPath = join(dir, "state.sqlite");
    await writeLegacyProviderDatabase(dbPath);

    const store = new SqliteStateStore(dbPath);
    await store.initialize();
    const provider = await store.getProvider("legacy_deepseek");

    expect(provider).toMatchObject({
      id: "legacy_deepseek",
      model: "deepseek-v4-flash"
    });
    expect(provider?.modelOverrides).toBeUndefined();
    expect(provider ? resolveProviderModelMaxToolIterations(provider) : undefined).toBe(500);

    await store.close();
  });

  it("persists scheduled tasks across restarts and supports partial updates", async () => {
    const dbPath = join(dir, "state.sqlite");
    const first = new SqliteStateStore(dbPath);
    await first.initialize();
    const session = await first.createSession({
      projectId: null,
      title: "会话",
      accessMode: "approval"
    });
    const task = await first.createScheduledTask({
      sessionId: session.id,
      name: "AI 日报",
      prompt: "生成今天的 AI 日报",
      kind: "recurring",
      cron: "0 9 * * *",
      fullAccess: false,
      nextRunAt: "2026-06-13T01:00:00.000Z"
    });
    expect(task).toMatchObject({
      enabled: true,
      fullAccess: false,
      kind: "recurring",
      cron: "0 9 * * *"
    });

    const updated = await first.updateScheduledTask(task.id, {
      enabled: false,
      lastRunAt: "2026-06-13T01:00:05.000Z",
      lastStatus: "failed",
      lastError: "无可用模型"
    });
    expect(updated).toMatchObject({
      enabled: false,
      lastStatus: "failed",
      lastError: "无可用模型",
      // 未指定的字段保持原值
      name: "AI 日报",
      nextRunAt: "2026-06-13T01:00:00.000Z"
    });
    await first.close();

    const second = new SqliteStateStore(dbPath);
    await second.initialize();
    const tasks = await second.listScheduledTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ id: task.id, enabled: false, lastStatus: "failed" });
    // null 显式清空 lastError
    const cleared = await second.updateScheduledTask(task.id, {
      lastStatus: "completed",
      lastError: null,
      nextRunAt: null
    });
    expect(cleared?.lastError).toBeUndefined();
    expect(cleared?.nextRunAt).toBeUndefined();

    const onceTask = await second.createScheduledTask({
      sessionId: session.id,
      name: "睡觉提醒",
      prompt: "提醒我睡觉",
      kind: "once",
      runAt: "2026-06-14T01:00:00.000Z",
      fullAccess: false,
      nextRunAt: "2026-06-14T01:00:00.000Z"
    });
    expect(onceTask).toMatchObject({
      kind: "once",
      runAt: "2026-06-14T01:00:00.000Z",
      nextRunAt: "2026-06-14T01:00:00.000Z"
    });
    expect(onceTask.cron).toBeUndefined();
    await second.close();
  });

  it("updateScheduledTask is a no-op for missing rows and delete cascades with the session", async () => {
    const store = new SqliteStateStore(join(dir, "state.sqlite"));
    await store.initialize();
    expect(await store.updateScheduledTask("task_missing", { enabled: false })).toBeUndefined();

    const session = await store.createSession({
      projectId: null,
      title: "会话",
      accessMode: "approval"
    });
    const task = await store.createScheduledTask({
      sessionId: session.id,
      name: "巡检",
      prompt: "检查仓库状态",
      kind: "recurring",
      cron: "*/5 * * * *",
      fullAccess: true,
      nextRunAt: "2026-06-13T01:00:00.000Z"
    });
    expect(await store.deleteSession(session.id)).toBe(true);
    expect(await store.getScheduledTask(task.id)).toBeUndefined();
    expect(await store.deleteScheduledTask(task.id)).toBe(false);
    await store.close();
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

async function writeLegacyProviderDatabase(dbPath: string): Promise<void> {
  const SQL = await initSqlJs({ locateFile: () => resolveSqlWasmPath() });
  const db = new SQL.Database();
  const timestamp = nowIso();
  try {
    db.run(`
      create table providers (
        id text primary key,
        kind text not null,
        name text not null,
        base_url text not null,
        model text not null,
        models text,
        reasoning_mode text,
        api_key_ref text,
        created_at text not null,
        updated_at text not null
      );
    `);
    db.run(
      `insert into providers
       (id, kind, name, base_url, model, models, reasoning_mode, api_key_ref, created_at, updated_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        "legacy_deepseek",
        "deepseek",
        "Legacy DeepSeek",
        "https://api.deepseek.com",
        "deepseek-v4-flash",
        null,
        null,
        "memory:legacy",
        timestamp,
        timestamp
      ]
    );
    await writeFile(dbPath, Buffer.from(db.export()));
  } finally {
    db.close();
  }
}
