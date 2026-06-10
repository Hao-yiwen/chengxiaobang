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

    for await (const event of runner.stream({
      prompt: "/shell pwd",
      projectId: project.id,
      accessMode: "full_access"
    })) {
      events.push(event.type);
    }

    expect(events).toContain("tool_call_started");
    expect(events).toContain("tool_result");
    expect(events).toContain("assistant_done");
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
