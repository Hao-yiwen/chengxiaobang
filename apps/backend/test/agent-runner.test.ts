import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { nowIso, type ProviderConfig, type StreamEvent } from "@chengxiaobang/shared";
import { AgentRunner, type AgentRunnerOptions } from "../src/agent/agent-runner";
import { SqliteStateStore } from "../src/repository/sqlite-state-store";
import { MemorySecretStore } from "../src/secrets/secret-store";
import { SlashCommandService } from "../src/tools/slash-command-service";
import { scriptedStreamFn, type ScriptedTurn } from "./helpers/scripted-stream";

function runnerWith(
  store: SqliteStateStore,
  secrets: MemorySecretStore,
  turns: ScriptedTurn[],
  options: Omit<AgentRunnerOptions, "streamFn"> = {}
) {
  const scripted = scriptedStreamFn(turns);
  const runner = new AgentRunner(store, secrets, { ...options, streamFn: scripted.streamFn });
  return { runner, calls: scripted.calls };
}

describe("AgentRunner", () => {
  let dir: string;
  let store: SqliteStateStore;
  let secrets: MemorySecretStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "cxb-agent-"));
    store = new SqliteStateStore(join(dir, "state.sqlite"));
    await store.initialize();
    secrets = new MemorySecretStore();
    await seedProvider(store, secrets);
  });

  afterEach(async () => {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("waits for approval before mutating tools", async () => {
    const { runner } = runnerWith(store, secrets, [{ text: "完成" }]);
    const events: StreamEvent[] = [];
    const stream = runner.stream({
      prompt: "/shell pwd",
      projectId: null,
      accessMode: "approval"
    });

    const first = await stream.next();
    expect(first.value?.type).toBe("run_started");
    const userMessage = await stream.next();
    expect(userMessage.value?.type).toBe("message");
    const preparing = await stream.next();
    expect(preparing.value?.type).toBe("delta");
    const approval = await stream.next();
    expect(approval.value?.type).toBe("tool_call");
    if (approval.value?.type === "tool_call") {
      expect(approval.value.toolCall.status).toBe("pending_approval");
      // Execution hasn't begun while awaiting approval, so no startedAt yet.
      expect(approval.value.toolCall.startedAt).toBeUndefined();
      expect(runner.approvals.decide(approval.value.toolCall.id, false)).toBe(true);
    }

    for await (const event of stream) {
      events.push(event);
    }
    expect(
      events.some((event) => event.type === "tool_call" && event.toolCall.status === "rejected")
    ).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: "run_end", status: "aborted" });
  });

  it("runs tools automatically in full access mode", async () => {
    const project = await store.createProject({ name: "tmp", path: dir });
    const { runner } = runnerWith(store, secrets, [{ text: "完成" }]);
    const events: StreamEvent[] = [];
    const transitions: string[] = [];
    let result: { startedAt?: string; createdAt: string } | undefined;

    for await (const event of runner.stream({
      prompt: "/shell pwd",
      projectId: project.id,
      accessMode: "full_access"
    })) {
      events.push(event);
      if (event.type === "tool_call") {
        transitions.push(event.toolCall.status);
        result = event.toolCall;
      }
    }

    expect(transitions).toEqual(["running", "completed"]);
    expect(events.some((event) => event.type === "message" && event.message.role === "assistant")).toBe(
      true
    );
    expect(events.at(-1)).toMatchObject({ type: "run_end", status: "completed" });
    // Auto-approved tools stamp startedAt when execution begins.
    expect(result?.startedAt).toBeDefined();
    expect(Date.parse(result!.startedAt!)).toBeGreaterThanOrEqual(
      Date.parse(result!.createdAt)
    );
  });

  it("uses a per-session workspace for standalone chats", async () => {
    const sessionWorkspacePath = (sessionId: string) => join(dir, "sessions", sessionId);
    const { runner } = runnerWith(store, secrets, [{ text: "完成" }], { sessionWorkspacePath });
    let sessionId: string | undefined;
    let toolOutput = "";

    for await (const event of runner.stream({
      prompt: "/write note.txt\nhello",
      projectId: null,
      accessMode: "full_access"
    })) {
      if (event.type === "run_started") {
        sessionId = event.sessionId;
        await rm(sessionWorkspacePath(sessionId), { recursive: true, force: true });
        await mkdir(sessionWorkspacePath(sessionId), { recursive: true });
      }
      if (event.type === "tool_call" && event.toolCall.status === "completed") {
        toolOutput = event.toolCall.result ?? "";
      }
    }

    expect(sessionId).toBeDefined();
    expect(toolOutput).toContain(sessionWorkspacePath(sessionId!));
    await expect(readFile(join(sessionWorkspacePath(sessionId!), "note.txt"), "utf8")).resolves.toBe(
      "hello"
    );
  });

  it("emits the persisted user message before assistant output", async () => {
    const { runner } = runnerWith(store, secrets, [{ text: "你好！" }]);
    const events: StreamEvent[] = [];

    for await (const event of runner.stream({
      prompt: "你好",
      projectId: null,
      accessMode: "approval"
    })) {
      events.push(event);
    }

    const started = events.find((event) => event.type === "run_started");
    const userMessage = events.find(
      (event) => event.type === "message" && event.message.role === "user"
    );
    expect(started?.type).toBe("run_started");
    expect(userMessage).toBeDefined();
    if (started?.type === "run_started") {
      const messages = await store.listMessages(started.sessionId);
      expect(messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    }
  });

  it("persists the model's streamed reasoning and pi payload on the assistant message", async () => {
    const { runner } = runnerWith(store, secrets, [{ thinking: "先想想再回答", text: "答案" }]);
    let sessionId: string | undefined;
    let sawThinkingDelta = false;

    for await (const event of runner.stream({
      prompt: "你好",
      projectId: null,
      accessMode: "approval"
    })) {
      if (event.type === "run_started") {
        sessionId = event.sessionId;
      }
      if (event.type === "delta" && event.channel === "thinking") {
        sawThinkingDelta = true;
      }
    }

    expect(sawThinkingDelta).toBe(true);
    expect(sessionId).toBeDefined();
    const assistant = (await store.listMessages(sessionId!)).find(
      (message) => message.role === "assistant"
    );
    expect(assistant?.content).toBe("答案");
    expect(assistant?.reasoning).toBe("先想想再回答");
    expect(assistant?.reasoningMs).toBeGreaterThanOrEqual(0);
    // Turn timing (model start → answer complete) is persisted alongside.
    expect(assistant?.durationMs).toBeGreaterThanOrEqual(0);
    // The raw pi message rides along for lossless history replay.
    expect(JSON.parse(assistant!.payload!)).toMatchObject({
      role: "assistant",
      stopReason: "stop"
    });
  });

  it("compacts older history into a summary and moves the session pointer", async () => {
    const { runner, calls } = runnerWith(store, secrets, [
      { text: "这是压缩摘要" },
      { text: "继续聊" }
    ]);
    const session = await store.createSession({
      projectId: null,
      title: "长对话",
      providerId: "deepseek",
      accessMode: "approval"
    });
    for (let index = 1; index <= 4; index += 1) {
      await store.addMessage({ sessionId: session.id, role: "user", content: `问题${index}` });
      await store.addMessage({ sessionId: session.id, role: "assistant", content: `回答${index}` });
    }

    const events: StreamEvent[] = [];
    for await (const event of runner.stream({
      sessionId: session.id,
      prompt: "/compact",
      projectId: null,
      accessMode: "approval"
    })) {
      events.push(event);
    }

    // The summary streams live on the thinking channel.
    expect(events.some((event) => event.type === "delta" && event.channel === "thinking")).toBe(
      true
    );
    expect(events.some((event) => event.type === "message")).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: "run_end", status: "completed" });

    const messages = await store.listMessages(session.id);
    // /compact itself never becomes a chat message.
    expect(messages.some((message) => message.content.includes("/compact"))).toBe(false);
    const summary = messages.find((message) => message.kind === "compaction_summary");
    expect(summary?.content).toBe("这是压缩摘要");
    // 8 visible messages, keep the last 4 → pointer lands on the 4th.
    const updated = await store.getSession(session.id);
    expect(updated?.compactedUpToMessageId).toBe(messages[3].id);

    // A follow-up run sends [summary + recent] instead of the full history.
    for await (const event of runner.stream({
      sessionId: session.id,
      prompt: "继续",
      projectId: null,
      accessMode: "approval"
    })) {
      void event;
    }
    const followUp = calls.at(-1)!.context.messages;
    const joined = followUp
      .map((message) => (typeof message.content === "string" ? message.content : ""))
      .join("\n");
    expect(joined).toContain("【此前对话的摘要】");
    expect(joined).toContain("这是压缩摘要");
    expect(joined).not.toContain("问题1");
    expect(joined).toContain("问题4");
  });

  it("skips compaction for short sessions without calling the model", async () => {
    const { runner, calls } = runnerWith(store, secrets, [{ text: "不应该被调用" }]);
    const session = await store.createSession({
      projectId: null,
      title: "短对话",
      providerId: "deepseek",
      accessMode: "approval"
    });
    await store.addMessage({ sessionId: session.id, role: "user", content: "你好" });

    const events: StreamEvent[] = [];
    for await (const event of runner.stream({
      sessionId: session.id,
      prompt: "/compact",
      projectId: null,
      accessMode: "approval"
    })) {
      events.push(event);
    }

    expect(calls).toHaveLength(0);
    expect(events.some((event) => event.type === "message")).toBe(true);
    const messages = await store.listMessages(session.id);
    expect(messages.at(-1)?.content).toContain("无需压缩");
    expect((await store.getSession(session.id))?.compactedUpToMessageId).toBeUndefined();
  });

  it("persists failed direct tool calls and ends the run as failed", async () => {
    const { runner, calls } = runnerWith(store, secrets, [{ text: "不应该被调用" }]);
    const events: StreamEvent[] = [];

    for await (const event of runner.stream({
      prompt: "/read missing.txt",
      projectId: null,
      accessMode: "full_access"
    })) {
      events.push(event);
    }

    const failed = events.find(
      (event) => event.type === "tool_call" && event.toolCall.status === "failed"
    );
    expect(failed?.type).toBe("tool_call");
    if (failed?.type === "tool_call") {
      expect(failed.toolCall.result).toContain("missing.txt");
    }
    expect(events.at(-1)).toMatchObject({ type: "run_end", status: "failed" });
    // The model is never consulted after a failed direct command.
    expect(calls).toHaveLength(0);
  });

  it("expands pi prompt template slash commands before model streaming", async () => {
    const projectPath = join(dir, "project");
    await mkdir(join(projectPath, ".chengxiaobang", "prompts"), { recursive: true });
    await writeFile(
      join(projectPath, ".chengxiaobang", "prompts", "review.md"),
      "请 review $ARGUMENTS",
      "utf8"
    );
    const project = await store.createProject({ name: "project", path: projectPath });
    const { runner, calls } = runnerWith(store, secrets, [{ text: "完成" }], {
      slashCommandService: new SlashCommandService(join(dir, "global"))
    });

    for await (const _event of runner.stream({
      prompt: "/review src/index.ts",
      projectId: project.id,
      accessMode: "approval"
    })) {
      // drain stream
    }

    const userContents = calls[0].context.messages
      .filter((message) => message.role === "user")
      .map((message) => message.content);
    expect(userContents).toContain("请 review src/index.ts");
  });

  it("requires at least one model with an API key before creating a run", async () => {
    const emptyStore = new SqliteStateStore(join(dir, "empty-state.sqlite"));
    await emptyStore.initialize();
    const { runner } = runnerWith(emptyStore, new MemorySecretStore(), []);

    await expect(async () => {
      for await (const _event of runner.stream({
        prompt: "你好",
        projectId: null,
        accessMode: "approval"
      })) {
        // no-op
      }
    }).rejects.toThrow("请先配置至少一个模型");
    expect(await emptyStore.listSessions()).toEqual([]);

    await emptyStore.close();
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
