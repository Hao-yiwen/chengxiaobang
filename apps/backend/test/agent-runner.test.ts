import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { nowIso, type ProviderConfig } from "@chengxiaobang/shared";
import { AgentRunner } from "../src/agent/agent-runner";
import type { ModelClient } from "../src/model/openai-compatible";
import { SqliteStateStore } from "../src/repository/sqlite-state-store";
import { MemorySecretStore } from "../src/secrets/secret-store";
import { SlashCommandService } from "../src/tools/slash-command-service";

describe("AgentRunner", () => {
  let dir: string;
  let store: SqliteStateStore;
  let secrets: MemorySecretStore;
  const modelClient: ModelClient = {
    async *streamCompletion() {
      yield { type: "text", delta: "完成" };
    },
    async testProvider() {}
  };

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
    const runner = new AgentRunner(store, secrets, modelClient);
    const events: string[] = [];
    const stream = runner.stream({
      prompt: "/shell pwd",
      projectId: null,
      accessMode: "approval"
    });

    const first = await stream.next();
    expect(first.value?.type).toBe("run_started");
    const userMessage = await stream.next();
    expect(userMessage.value?.type).toBe("user_message");
    const pending = await stream.next();
    expect(pending.value?.type).toBe("thinking_delta");
    const approval = await stream.next();
    expect(approval.value?.type).toBe("tool_call_pending");
    if (approval.value?.type === "tool_call_pending") {
      // Execution hasn't begun while awaiting approval, so no startedAt yet.
      expect(approval.value.toolCall.startedAt).toBeUndefined();
      expect(runner.approvals.decide(approval.value.toolCall.id, false)).toBe(true);
    }

    for await (const event of stream) {
      events.push(event.type);
    }
    expect(events).toContain("tool_result");
    expect(events).toContain("run_aborted");
  });

  it("runs tools automatically in full access mode", async () => {
    const project = await store.createProject({ name: "tmp", path: dir });
    const runner = new AgentRunner(store, secrets, modelClient);
    const events: string[] = [];
    let result: { startedAt?: string; createdAt: string } | undefined;

    for await (const event of runner.stream({
      prompt: "/shell pwd",
      projectId: project.id,
      accessMode: "full_access"
    })) {
      events.push(event.type);
      if (event.type === "tool_result") {
        result = event.toolCall;
      }
    }

    expect(events).toContain("tool_call_started");
    expect(events).toContain("tool_result");
    expect(events).toContain("assistant_done");
    // Auto-approved tools stamp startedAt when execution begins.
    expect(result?.startedAt).toBeDefined();
    expect(Date.parse(result!.startedAt!)).toBeGreaterThanOrEqual(
      Date.parse(result!.createdAt)
    );
  });

  it("uses a per-session workspace for standalone chats", async () => {
    const sessionWorkspacePath = (sessionId: string) => join(dir, "sessions", sessionId);
    const runner = new AgentRunner(
      store,
      secrets,
      modelClient,
      undefined,
      sessionWorkspacePath
    );
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
      if (event.type === "tool_result") {
        toolOutput = event.toolCall.result ?? "";
      }
    }

    expect(sessionId).toBeDefined();
    expect(toolOutput).toContain(sessionWorkspacePath(sessionId!));
    await expect(readFile(join(sessionWorkspacePath(sessionId!), "note.txt"), "utf8")).resolves.toBe(
      "hello"
    );
  });

  it("emits persisted user messages before assistant output", async () => {
    const runner = new AgentRunner(store, secrets, modelClient);
    const events = [];

    for await (const event of runner.stream({
      prompt: "你好",
      projectId: null,
      accessMode: "approval"
    })) {
      events.push(event);
    }

    const started = events.find((event) => event.type === "run_started");
    const userMessage = events.find((event) => event.type === "user_message");
    expect(started?.type).toBe("run_started");
    expect(userMessage?.type).toBe("user_message");
    if (started?.type === "run_started") {
      const messages = await store.listMessages(started.sessionId);
      expect(messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    }
  });

  it("persists the model's streamed reasoning on the assistant message", async () => {
    const reasoningModel: ModelClient = {
      async *streamCompletion() {
        yield { type: "thinking", delta: "先想想" };
        yield { type: "thinking", delta: "再回答" };
        yield { type: "text", delta: "答案" };
      },
      async testProvider() {}
    };
    const runner = new AgentRunner(store, secrets, reasoningModel);
    let sessionId: string | undefined;

    for await (const event of runner.stream({
      prompt: "你好",
      projectId: null,
      accessMode: "approval"
    })) {
      if (event.type === "run_started") {
        sessionId = event.sessionId;
      }
    }

    expect(sessionId).toBeDefined();
    const assistant = (await store.listMessages(sessionId!)).find(
      (message) => message.role === "assistant"
    );
    expect(assistant?.content).toBe("答案");
    expect(assistant?.reasoning).toBe("先想想再回答");
    expect(assistant?.reasoningMs).toBeGreaterThanOrEqual(0);
    // Turn timing (model start → answer complete) is persisted alongside.
    expect(assistant?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("compacts older history into a summary and moves the session pointer", async () => {
    const captured: Array<Array<{ role: string; content: string }>> = [];
    const compactionModel: ModelClient = {
      async *streamCompletion(input) {
        captured.push(input.messages.map(({ role, content }) => ({ role, content })));
        yield { type: "text", delta: "这是压缩摘要" };
      },
      async testProvider() {}
    };
    const runner = new AgentRunner(store, secrets, compactionModel);
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

    const events: string[] = [];
    for await (const event of runner.stream({
      sessionId: session.id,
      prompt: "/compact",
      projectId: null,
      accessMode: "approval"
    })) {
      events.push(event.type);
    }

    expect(events).toContain("thinking_delta");
    expect(events).toContain("assistant_done");
    expect(events).toContain("run_completed");
    // /compact itself never becomes a chat message.
    expect(events).not.toContain("user_message");

    const messages = await store.listMessages(session.id);
    expect(messages.some((message) => message.content.includes("/compact"))).toBe(false);
    const summary = messages.find((message) => message.kind === "compaction_summary");
    expect(summary?.content).toBe("这是压缩摘要");
    // 8 visible messages, keep the last 4 → pointer lands on the 4th.
    const updated = await store.getSession(session.id);
    expect(updated?.compactedUpToMessageId).toBe(messages[3].id);

    // A follow-up run sends [summary + recent] instead of the full history.
    captured.length = 0;
    for await (const event of runner.stream({
      sessionId: session.id,
      prompt: "继续",
      projectId: null,
      accessMode: "approval"
    })) {
      void event;
    }
    const followUp = captured[0] ?? [];
    const joined = followUp.map((message) => message.content).join("\n");
    expect(joined).toContain("【此前对话的摘要】");
    expect(joined).toContain("这是压缩摘要");
    expect(joined).not.toContain("问题1");
    expect(joined).toContain("问题4");
  });

  it("skips compaction for short sessions without calling the model", async () => {
    let modelCalls = 0;
    const spyModel: ModelClient = {
      async *streamCompletion() {
        modelCalls += 1;
        yield { type: "text", delta: "不应该被调用" };
      },
      async testProvider() {}
    };
    const runner = new AgentRunner(store, secrets, spyModel);
    const session = await store.createSession({
      projectId: null,
      title: "短对话",
      providerId: "deepseek",
      accessMode: "approval"
    });
    await store.addMessage({ sessionId: session.id, role: "user", content: "你好" });

    const events: string[] = [];
    for await (const event of runner.stream({
      sessionId: session.id,
      prompt: "/compact",
      projectId: null,
      accessMode: "approval"
    })) {
      events.push(event.type);
    }

    expect(modelCalls).toBe(0);
    expect(events).toContain("assistant_done");
    const messages = await store.listMessages(session.id);
    expect(messages.at(-1)?.content).toContain("无需压缩");
    expect((await store.getSession(session.id))?.compactedUpToMessageId).toBeUndefined();
  });

  it("persists failed tool calls before reporting run errors", async () => {
    const runner = new AgentRunner(store, secrets, modelClient);
    const events = [];

    for await (const event of runner.stream({
      prompt: "/read missing.txt",
      projectId: null,
      accessMode: "full_access"
    })) {
      events.push(event);
    }

    const toolResult = events.find((event) => event.type === "tool_result");
    expect(toolResult?.type).toBe("tool_result");
    if (toolResult?.type === "tool_result") {
      expect(toolResult.toolCall.status).toBe("failed");
      expect(toolResult.toolCall.result).toContain("missing.txt");
    }
    expect(events.some((event) => event.type === "run_error")).toBe(true);
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
    let modelMessages: Array<{ role: string; content: string }> = [];
    const model: ModelClient = {
      async *streamCompletion(input) {
        modelMessages = input.messages.map((message) => ({
          role: message.role,
          content: message.content
        }));
        yield { type: "text", delta: "完成" };
      },
      async testProvider() {}
    };
    const runner = new AgentRunner(
      store,
      secrets,
      model,
      undefined,
      undefined,
      new SlashCommandService(join(dir, "global"))
    );

    for await (const _event of runner.stream({
      prompt: "/review src/index.ts",
      projectId: project.id,
      accessMode: "approval"
    })) {
      // drain stream
    }

    expect(modelMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "user", content: "请 review src/index.ts" })
      ])
    );
  });

  it("requires at least one model with an API key before creating a run", async () => {
    const emptyStore = new SqliteStateStore(join(dir, "empty-state.sqlite"));
    await emptyStore.initialize();
    const runner = new AgentRunner(emptyStore, new MemorySecretStore(), modelClient);

    await expect(
      async () => {
        for await (const _event of runner.stream({
          prompt: "你好",
          projectId: null,
          accessMode: "approval"
        })) {
          // no-op
        }
      }
    ).rejects.toThrow("请先配置至少一个模型");
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
