import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nowIso } from "@chengxiaobang/shared";
import { AgentRunner } from "../src/agent/agent-runner";
import { createApp } from "../src/api/app";
import { ProviderService } from "../src/model/provider-service";
import { SqliteStateStore } from "../src/repository/sqlite-state-store";
import { MemorySecretStore } from "../src/secrets/secret-store";
import { createAgentTools } from "../src/tools/registry";
import { SlashCommandService } from "../src/tools/slash-command-service";

describe("session debug context API", () => {
  const token = "test-token";
  let dir: string;
  let store: SqliteStateStore;
  let app: (request: Request) => Promise<Response>;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "cxb-debug-"));
    store = new SqliteStateStore(join(dir, "state.sqlite"));
    await store.initialize();
    const secrets = new MemorySecretStore();
    app = createApp({
      token,
      store,
      providerService: new ProviderService(store, secrets, vi.fn()),
      runner: new AgentRunner(store, secrets),
      slashCommandService: new SlashCommandService(join(dir, "global"))
    });
  });

  afterEach(async () => {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("returns the exact system prompt and reconstructed model context for a session", async () => {
    const project = await store.createProject({
      name: "debug-demo",
      path: join(dir, "project")
    });
    const session = await store.createSession({
      projectId: project.id,
      title: "调试会话",
      accessMode: "approval"
    });
    const timestamp = nowIso();
    await store.addMessage({
      sessionId: session.id,
      role: "user",
      content: "解释一下当前上下文",
      payload: JSON.stringify({ role: "user", content: "payload 用户消息", timestamp: 1 })
    });
    await store.addMessage({
      sessionId: session.id,
      role: "assistant",
      content: "好的",
      payload: JSON.stringify({
        role: "assistant",
        content: [{ type: "text", text: "payload 助手消息" }],
        api: "openai-completions",
        provider: "test",
        model: "debug",
        usage: {
          input: 1,
          output: 1,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
        },
        stopReason: "stop",
        timestamp: 2
      })
    });
    await store.createRun({ id: "run_debug", sessionId: session.id, status: "completed" });
    await store.insertToolCall({
      id: "tool_debug",
      runId: "run_debug",
      name: "read_file",
      args: { path: "README.md" },
      status: "completed",
      result: "ok",
      createdAt: timestamp,
      updatedAt: timestamp
    });

    const response = await app(
      authRequest(`http://local/api/sessions/${session.id}/debug-context?planMode=true`)
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, any>;
    expect(body.debug.systemPrompt).toContain(`工作目录: ${project.path}`);
    expect(body.debug.systemPrompt).toContain("当前为「计划模式」");
    expect(body.debug.modelMessages[0]).toMatchObject({
      role: "user",
      content: "payload 用户消息"
    });
    expect(body.debug.messages[0]).not.toHaveProperty("payload");
    expect(body.debug.toolCalls[0]).toMatchObject({ id: "tool_debug", name: "read_file" });
    expect(body.debug.availableTools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "read_file", requiresApproval: false })
      ])
    );
  });

  it("returns 404 for a missing session", async () => {
    const response = await app(authRequest("http://local/api/sessions/session_missing/debug-context"));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "会话不存在" });
  });

  it("shows web_search in debug tools when the runtime registry enables it", async () => {
    const secrets = new MemorySecretStore();
    const webApp = createApp({
      token,
      store,
      providerService: new ProviderService(store, secrets, vi.fn()),
      runner: new AgentRunner(store, secrets, {
        createTools: async (workspacePath) =>
          createAgentTools(workspacePath, { webSearch: async () => "搜索结果" })
      })
    });
    const session = await store.createSession({
      projectId: null,
      title: "搜索调试",
      accessMode: "approval"
    });

    const response = await webApp(
      authRequest(`http://local/api/sessions/${session.id}/debug-context?planMode=true`)
    );

    const text = await response.text();
    expect(response.status, text).toBe(200);
    const body = JSON.parse(text) as Record<string, any>;
    expect(body.debug.availableTools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "web_search", requiresApproval: false })
      ])
    );
  });

  function authRequest(url: string): Request {
    return new Request(url, { headers: { "x-chengxiaobang-token": token } });
  }
});
