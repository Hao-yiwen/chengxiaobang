import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nowIso, type ProviderConfig, type ToolCall } from "@chengxiaobang/shared";
import { AgentRunner } from "../src/agent/agent-runner";
import { createApp } from "../src/api/app";
import type { ModelClient } from "../src/model/openai-compatible";
import { ProviderService } from "../src/model/provider-service";
import { SqliteStateStore } from "../src/repository/sqlite-state-store";
import { MemorySecretStore } from "../src/secrets/secret-store";
import { SlashCommandService } from "../src/tools/slash-command-service";

describe("createApp", () => {
  let dir: string;
  let store: SqliteStateStore;
  let app: (request: Request) => Promise<Response>;

  const modelClient: ModelClient = {
    streamCompletion: vi.fn() as never,
    testProvider: vi.fn()
  };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "cxb-api-"));
    store = new SqliteStateStore(join(dir, "state.sqlite"));
    await store.initialize();
    const secrets = new MemorySecretStore();
    await seedProvider(store, secrets);
    app = createApp({
      store,
      providerService: new ProviderService(store, secrets, modelClient),
      runner: new AgentRunner(store, secrets, modelClient),
      slashCommandService: new SlashCommandService(join(dir, "global"))
    });
  });

  afterEach(async () => {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("updates and deletes sessions through HTTP API", async () => {
    const created = await app(
      jsonRequest("/api/sessions", "POST", {
        title: "旧标题",
        projectId: null,
        accessMode: "approval"
      })
    );
    const { session } = (await created.json()) as { session: { id: string } };

    const updated = await app(
      jsonRequest(`/api/sessions/${session.id}`, "PATCH", { title: "新标题" })
    );
    expect(updated.status).toBe(200);
    await expect(updated.json()).resolves.toMatchObject({
      session: { id: session.id, title: "新标题" }
    });

    const deleted = await app(new Request(`http://local/api/sessions/${session.id}`, {
      method: "DELETE"
    }));
    expect(deleted.status).toBe(200);
    await expect(deleted.json()).resolves.toEqual({ deleted: true });
  });

  it("rewinds a session to a message over HTTP", async () => {
    const session = await store.createSession({
      projectId: null,
      title: "回退",
      accessMode: "approval"
    });
    const first = await store.addMessage({ sessionId: session.id, role: "user", content: "一" });
    const second = await store.addMessage({
      sessionId: session.id,
      role: "assistant",
      content: "二"
    });

    const response = await app(
      jsonRequest(`/api/sessions/${session.id}/rewind`, "POST", { messageId: second.id })
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      messages: [{ id: first.id, content: "一" }]
    });

    const missing = await app(
      jsonRequest(`/api/sessions/${session.id}/rewind`, "POST", { messageId: "msg_nope" })
    );
    expect(missing.status).toBe(404);
  });

  it("lists project files for the composer autocomplete", async () => {
    await mkdir(join(dir, "proj", "src"), { recursive: true });
    await writeFile(join(dir, "proj", "src", "index.ts"), "export {};");
    const project = await store.createProject({ name: "demo", path: join(dir, "proj") });

    const response = await app(
      new Request(`http://local/api/projects/${project.id}/files?query=ind`, { method: "GET" })
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ files: ["src/index.ts"] });

    const missing = await app(
      new Request("http://local/api/projects/nope/files?query=", { method: "GET" })
    );
    expect(missing.status).toBe(404);
  });

  it("allows PATCH in CORS preflight responses", async () => {
    const response = await app(new Request("http://local/api/sessions/session_1", {
      method: "OPTIONS"
    }));

    expect(response.headers.get("Access-Control-Allow-Methods")).toContain("PATCH");
  });

  it("returns persisted runs and tool calls for a session", async () => {
    const session = await store.createSession({
      projectId: null,
      title: "工具历史",
      accessMode: "approval"
    });
    await store.createRun({
      id: "run_1",
      sessionId: session.id,
      status: "completed"
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
    await store.insertToolCall(toolCall);

    const response = await app(
      new Request(`http://local/api/sessions/${session.id}/runs`, {
        method: "GET"
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      runs: [{ id: "run_1", sessionId: session.id, status: "completed" }],
      toolCalls: [
        {
          id: "tool_1",
          runId: "run_1",
          name: "list_directory",
          args: { path: "." },
          status: "completed",
          result: "file package.json"
        }
      ]
    });
  });

  it("executes terminal commands inside the project directory", async () => {
    const projectRoot = join(dir, "workspace");
    await mkdir(projectRoot, { recursive: true });
    await writeFile(join(projectRoot, "hello.txt"), "hi", "utf8");
    const project = await store.createProject({ name: "workspace", path: projectRoot });

    const response = await app(
      jsonRequest("/api/terminal/exec", "POST", {
        projectId: project.id,
        command: "ls"
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      result: { output: "hello.txt", exitCode: 0 }
    });
  });

  it("returns the exit code of failing terminal commands", async () => {
    const projectRoot = join(dir, "workspace");
    await mkdir(projectRoot, { recursive: true });
    const project = await store.createProject({ name: "workspace", path: projectRoot });

    const response = await app(
      jsonRequest("/api/terminal/exec", "POST", {
        projectId: project.id,
        command: "echo broken >&2; exit 2"
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      result: { output: "broken", exitCode: 2 }
    });
  });

  it("rejects terminal commands for unknown projects", async () => {
    const response = await app(
      jsonRequest("/api/terminal/exec", "POST", {
        projectId: "missing",
        command: "echo hi"
      })
    );

    expect(response.status).toBe(404);
  });

  it("lists builtin and pi slash commands with project resources taking priority", async () => {
    const globalRoot = join(dir, "global");
    const projectRoot = join(dir, "project");
    await mkdir(join(globalRoot, "prompts"), { recursive: true });
    await mkdir(join(projectRoot, ".chengxiaobang", "prompts"), { recursive: true });
    await mkdir(join(projectRoot, ".chengxiaobang", "skills", "review"), { recursive: true });
    await writeFile(
      join(globalRoot, "prompts", "review.md"),
      "---\ndescription: Global review\n---\nGlobal $ARGUMENTS",
      "utf8"
    );
    await writeFile(
      join(projectRoot, ".chengxiaobang", "prompts", "review.md"),
      "---\ndescription: Project review\n---\nProject $ARGUMENTS",
      "utf8"
    );
    await writeFile(
      join(projectRoot, ".chengxiaobang", "skills", "review", "SKILL.md"),
      "---\ndescription: Review skill\n---\nUse this skill.",
      "utf8"
    );
    const project = await store.createProject({ name: "project", path: projectRoot });

    const response = await app(
      new Request(`http://local/api/slash-commands?projectId=${project.id}`, {
        method: "GET"
      })
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      commands: Array<{ name: string; source: string; description: string }>;
      diagnostics: unknown[];
    };
    expect(body.commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "/ls", source: "builtin" }),
        expect.objectContaining({
          name: "/review",
          source: "project",
          description: "Project review"
        })
      ])
    );
    expect(body.commands.filter((command) => command.name === "/review")).toHaveLength(1);
    expect(body.diagnostics).toEqual([]);
  });

  it("keeps slash command diagnostics non-fatal", async () => {
    const globalRoot = join(dir, "global");
    await mkdir(join(globalRoot, "skills", "Bad Name"), { recursive: true });
    await writeFile(
      join(globalRoot, "skills", "Bad Name", "SKILL.md"),
      "---\ndescription: Invalid name\n---\nBody",
      "utf8"
    );
    const localApp = createApp({
      store,
      providerService: new ProviderService(store, new MemorySecretStore(), modelClient),
      runner: new AgentRunner(store, new MemorySecretStore(), modelClient),
      slashCommandService: new SlashCommandService(globalRoot)
    });

    const response = await localApp(
      new Request("http://local/api/slash-commands", { method: "GET" })
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      commands: Array<{ name: string }>;
      diagnostics: Array<{ message: string; source: string }>;
    };
    expect(body.commands).toEqual(expect.arrayContaining([expect.objectContaining({ name: "/ls" })]));
    expect(body.diagnostics.length).toBeGreaterThan(0);
    expect(body.diagnostics[0]?.source).toBe("global");
  });
});

function jsonRequest(path: string, method: string, body: unknown): Request {
  return new Request(`http://local${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

async function seedProvider(
  store: SqliteStateStore,
  secrets: MemorySecretStore
): Promise<void> {
  const timestamp = nowIso();
  const provider: ProviderConfig = {
    id: "deepseek",
    kind: "deepseek",
    name: "DeepSeek",
    baseURL: "https://api.deepseek.com",
    model: "deepseek-v4-flash",
    apiKeyRef: await secrets.setSecret("deepseek", "test-key"),
    createdAt: timestamp,
    updatedAt: timestamp
  };
  await store.upsertProvider(provider);
}
