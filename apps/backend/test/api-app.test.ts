import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  nowIso,
  parseSseChunk,
  sessionSearchResultSchema,
  type FeishuConfig,
  type ProviderConfig,
  type StreamEvent,
  type ToolCall
} from "@chengxiaobang/shared";
import { AgentRunner } from "../src/agent/agent-runner";
import { createApp } from "../src/api/app";
import { ProviderService } from "../src/model/provider-service";
import { SqliteStateStore } from "../src/repository/sqlite-state-store";
import { MemorySecretStore } from "../src/secrets/secret-store";
import { SkillMarketService } from "../src/tools/skill-market-service";
import { runCommand } from "../src/tools/shell";
import { SlashCommandService } from "../src/tools/slash-command-service";
import { captureBackendLogs } from "./helpers/logging";
import { scriptedStreamFn } from "./helpers/scripted-stream";

function createTestApp(options: Parameters<typeof createApp>[0]): (request: Request) => Promise<Response> {
  return createApp({ allowUnauthenticated: true, ...options });
}

function listDirectoryCommand(): string {
  return process.platform === "win32" ? "dir /b" : "ls";
}

function failingTerminalCommand(exitCode: number, message: string): string {
  return process.platform === "win32"
    ? `echo ${message} 1>&2 & exit /b ${exitCode}`
    : `echo ${message} >&2; exit ${exitCode}`;
}

describe("createApp", () => {
  let dir: string;
  let store: SqliteStateStore;
  let secrets: MemorySecretStore;
  let app: (request: Request) => Promise<Response>;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "cxb-api-"));
    store = new SqliteStateStore(join(dir, "state.sqlite"));
    await store.initialize();
    secrets = new MemorySecretStore();
    await seedProvider(store, secrets);
    app = createTestApp({
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

  it("keeps health public and protects API routes when a token is configured", async () => {
    const tokenApp = createApp({
      token: "secret-token",
      store,
      providerService: new ProviderService(store, secrets, vi.fn()),
      runner: new AgentRunner(store, secrets)
    });

    const health = await tokenApp(new Request("http://local/api/health", { method: "GET" }));
    expect(health.status).toBe(200);

    const rejected = await tokenApp(new Request("http://local/api/projects", { method: "GET" }));
    expect(rejected.status).toBe(401);
    await expect(rejected.json()).resolves.toEqual({ error: "未授权" });

    const accepted = await tokenApp(
      new Request("http://local/api/projects", {
        method: "GET",
        headers: { "x-chengxiaobang-token": "secret-token" }
      })
    );
    expect(accepted.status).toBe(200);
    await expect(accepted.json()).resolves.toEqual({ projects: [] });
  });

  it("rejects protected API routes by default when no token is configured", async () => {
    const protectedApp = createApp({
      store,
      providerService: new ProviderService(store, secrets, vi.fn()),
      runner: new AgentRunner(store, secrets)
    });

    const response = await protectedApp(new Request("http://local/api/projects", { method: "GET" }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "未授权" });
  });

  it("rejects untrusted CORS origins before route handling", async () => {
    const response = await app(
      new Request("http://local/api/projects", {
        method: "GET",
        headers: { Origin: "https://evil.example" }
      })
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "不允许的请求来源" });
  });

  it("uses frontend request id and route session id in request logs", async () => {
    const { entries, restore } = captureBackendLogs();
    const session = await store.createSession({
      projectId: null,
      title: "日志上下文",
      accessMode: "approval"
    });
    try {
      const response = await app(
        new Request(`http://local/api/sessions/${session.id}/messages`, {
          method: "GET",
          headers: { "x-request-id": "req_front_1" }
        })
      );

      expect(response.status).toBe(200);
      expect(entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            level: "info",
            message: "HTTP 请求结束",
            fields: expect.objectContaining({
              requestId: "req_front_1",
              sessionId: session.id,
              method: "GET",
              path: `/api/sessions/${session.id}/messages`,
              status: 200,
              durationMs: expect.any(Number)
            })
          })
        ])
      );
    } finally {
      restore();
    }
  });

  it("generates backend request id when the header is missing", async () => {
    const { entries, restore } = captureBackendLogs();
    try {
      const response = await app(new Request("http://local/api/health", { method: "GET" }));

      expect(response.status).toBe(200);
      const finished = entries.find((entry) => entry.message === "HTTP 请求结束");
      expect(finished?.fields.requestId).toEqual(expect.stringMatching(/^req_/));
    } finally {
      restore();
    }
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

  it("pins a session via PATCH without bumping updated_at", async () => {
    const created = await app(
      jsonRequest("/api/sessions", "POST", {
        title: "置顶会话",
        projectId: null,
        accessMode: "approval"
      })
    );
    const { session } = (await created.json()) as {
      session: { id: string; updatedAt: string };
    };

    const pinned = await app(
      jsonRequest(`/api/sessions/${session.id}`, "PATCH", { pinned: true })
    );
    expect(pinned.status).toBe(200);
    const pinnedBody = (await pinned.json()) as {
      session: { pinnedAt?: string; updatedAt: string };
    };
    expect(pinnedBody.session.pinnedAt).toEqual(expect.any(String));
    // 置顶不 bump updated_at，避免扰动按 updated_at 排序的会话列表。
    expect(pinnedBody.session.updatedAt).toBe(session.updatedAt);

    const unpinned = await app(
      jsonRequest(`/api/sessions/${session.id}`, "PATCH", { pinned: false })
    );
    const unpinnedBody = (await unpinned.json()) as { session: { pinnedAt?: string } };
    expect(unpinnedBody.session.pinnedAt).toBeUndefined();
  });

  it("renames or pins a project via PATCH", async () => {
    const created = await app(
      jsonRequest("/api/projects", "POST", { path: join(dir, "pin-proj"), name: "demo" })
    );
    const { project } = (await created.json()) as { project: { id: string } };

    const pinned = await app(
      jsonRequest(`/api/projects/${project.id}`, "PATCH", { pinned: true })
    );
    expect(pinned.status).toBe(200);
    const pinnedBody = (await pinned.json()) as { project: { pinnedAt?: string } };
    expect(pinnedBody.project.pinnedAt).toEqual(expect.any(String));

    // rename 兼容回归：旧客户端只发 name，置顶状态保留。
    const renamed = await app(
      jsonRequest(`/api/projects/${project.id}`, "PATCH", { name: "新名" })
    );
    const renamedBody = (await renamed.json()) as {
      project: { name: string; pinnedAt?: string };
    };
    expect(renamedBody.project.name).toBe("新名");
    expect(renamedBody.project.pinnedAt).toBe(pinnedBody.project.pinnedAt);

    const empty = await app(jsonRequest(`/api/projects/${project.id}`, "PATCH", {}));
    expect(empty.status).toBe(400);
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

  it("updates assistant message feedback over HTTP", async () => {
    const session = await store.createSession({
      projectId: null,
      title: "反馈",
      accessMode: "approval"
    });
    const user = await store.addMessage({ sessionId: session.id, role: "user", content: "一" });
    const assistant = await store.addMessage({
      sessionId: session.id,
      role: "assistant",
      content: "二"
    });

    const liked = await app(
      jsonRequest(`/api/sessions/${session.id}/messages/${assistant.id}/feedback`, "PATCH", {
        feedback: "up"
      })
    );
    expect(liked.status).toBe(200);
    await expect(liked.json()).resolves.toMatchObject({
      message: { id: assistant.id, feedback: "up" }
    });

    const cleared = await app(
      jsonRequest(`/api/sessions/${session.id}/messages/${assistant.id}/feedback`, "PATCH", {
        feedback: null
      })
    );
    expect(cleared.status).toBe(200);
    const clearedBody = (await cleared.json()) as { message: { feedback?: string } };
    expect(clearedBody.message).not.toHaveProperty("feedback");

    const rejectedUser = await app(
      jsonRequest(`/api/sessions/${session.id}/messages/${user.id}/feedback`, "PATCH", {
        feedback: "down"
      })
    );
    expect(rejectedUser.status).toBe(400);
    await expect(rejectedUser.json()).resolves.toEqual({ error: "只能评价助手消息" });

    const missing = await app(
      jsonRequest(`/api/sessions/${session.id}/messages/msg_nope/feedback`, "PATCH", {
        feedback: "down"
      })
    );
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toEqual({ error: "消息不存在" });
  });

  it("clears failed run history and tool calls when retry rewinds the user message", async () => {
    const session = await store.createSession({
      projectId: null,
      title: "重试清理",
      accessMode: "approval"
    });
    await store.createRun({
      id: "run_interrupted",
      sessionId: session.id,
      status: "running"
    });
    await tick();
    const userMessage = await store.addMessage({
      sessionId: session.id,
      role: "user",
      content: "帮我做一份介绍『人工智能发展简史』的演示文稿"
    });
    await tick();
    const timestamp = nowIso();
    await store.insertToolCall({
      id: "tool_skill_ppt",
      runId: "run_interrupted",
      name: "Skill",
      args: { skill: "ppt" },
      status: "completed",
      result: "已加载技能 ppt",
      createdAt: timestamp,
      updatedAt: timestamp
    });
    await store.updateRunStatus(
      "run_interrupted",
      "failed",
      undefined,
      "运行进程已重启，无法继续等待审批或工具结果。请重新发起本次请求。"
    );

    const before = await app(
      new Request(`http://local/api/sessions/${session.id}/runs`, { method: "GET" })
    );
    await expect(before.json()).resolves.toMatchObject({
      runs: [expect.objectContaining({ id: "run_interrupted", status: "failed" })],
      toolCalls: [expect.objectContaining({ id: "tool_skill_ppt", name: "Skill" })]
    });

    const response = await app(
      jsonRequest(`/api/sessions/${session.id}/rewind`, "POST", { messageId: userMessage.id })
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ messages: [] });

    const after = await app(
      new Request(`http://local/api/sessions/${session.id}/runs`, { method: "GET" })
    );
    await expect(after.json()).resolves.toEqual({ runs: [], toolCalls: [] });
  });

  it("searches sessions by title or visible message content over HTTP", async () => {
    const empty = await app(
      new Request("http://local/api/sessions/search?query=", { method: "GET" })
    );
    expect(empty.status).toBe(200);
    await expect(empty.json()).resolves.toEqual({ results: [] });

    const session = await store.createSession({
      projectId: null,
      title: "普通标题",
      accessMode: "approval"
    });
    const message = await store.addMessage({
      sessionId: session.id,
      role: "assistant",
      content: "这里记录了湖蓝色线索，应该能被正文搜索找到。"
    });

    const response = await app(
      new Request(
        `http://local/api/sessions/search?query=${encodeURIComponent("湖蓝色线索")}`,
        { method: "GET" }
      )
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { results: unknown[] };
    expect(sessionSearchResultSchema.array().safeParse(body.results).success).toBe(true);
    expect(body.results).toMatchObject([
      {
        session: { id: session.id, title: "普通标题" },
        matchType: "content",
        messageId: message.id,
        role: "assistant",
        snippet: expect.stringContaining("湖蓝色线索")
      }
    ]);
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

  it("reports lightweight git repository info for right-panel menu filtering", async () => {
    const plainRoot = join(dir, "plain-info");
    const repoRoot = join(dir, "repo-info");
    await mkdir(plainRoot, { recursive: true });
    await mkdir(repoRoot, { recursive: true });
    const plain = await store.createProject({ name: "plain", path: plainRoot });
    const repo = await store.createProject({ name: "repo", path: repoRoot });
    const init = await runCommand("git init", repoRoot);
    expect(init.exitCode).toBe(0);

    const plainResponse = await app(
      new Request(`http://local/api/projects/${plain.id}/git/info`, { method: "GET" })
    );
    expect(plainResponse.status).toBe(200);
    await expect(plainResponse.json()).resolves.toEqual({ info: { isRepo: false } });

    const repoResponse = await app(
      new Request(`http://local/api/projects/${repo.id}/git/info`, { method: "GET" })
    );
    expect(repoResponse.status).toBe(200);
    await expect(repoResponse.json()).resolves.toEqual({ info: { isRepo: true } });

    const missing = await app(
      new Request("http://local/api/projects/nope/git/info", { method: "GET" })
    );
    expect(missing.status).toBe(404);
  }, 20_000);

  it("reports git changes for a project directory", async () => {
    await mkdir(join(dir, "plain"), { recursive: true });
    const project = await store.createProject({ name: "plain", path: join(dir, "plain") });

    const response = await app(
      new Request(`http://local/api/projects/${project.id}/git/changes`, { method: "GET" })
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      changes: { isRepo: false, files: [] }
    });

    const missing = await app(
      new Request("http://local/api/projects/nope/git/changes", { method: "GET" })
    );
    expect(missing.status).toBe(404);
  }, 20_000);

  it("reports a single git change diff for a project file", async () => {
    const repoRoot = join(dir, "repo-diff");
    await mkdir(repoRoot, { recursive: true });
    const project = await store.createProject({ name: "repo", path: repoRoot });
    expect((await runCommand("git init", repoRoot)).exitCode).toBe(0);
    await writeFile(join(repoRoot, "space name.txt"), "old\n");
    expect((await runCommand("git -c user.name=t -c user.email=t@t.com add .", repoRoot)).exitCode).toBe(0);
    expect(
      (await runCommand('git -c user.name=t -c user.email=t@t.com commit -m "base"', repoRoot))
        .exitCode
    ).toBe(0);
    await writeFile(join(repoRoot, "space name.txt"), "new\n");

    const query = new URLSearchParams({ scope: "unstaged", path: "space name.txt" });
    const response = await app(
      new Request(`http://local/api/projects/${project.id}/git/changes/diff?${query}`, {
        method: "GET"
      })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.file.path).toBe("space name.txt");
    expect(body.file.scope).toBe("unstaged");
    expect(body.file.diff).toContain("-old");
    expect(body.file.diff).toContain("+new");

    const invalidScope = await app(
      new Request(
        `http://local/api/projects/${project.id}/git/changes/diff?scope=bad&path=space%20name.txt`,
        { method: "GET" }
      )
    );
    expect(invalidScope.status).toBe(400);

    const missingProject = await app(
      new Request(`http://local/api/projects/nope/git/changes/diff?${query}`, { method: "GET" })
    );
    expect(missingProject.status).toBe(404);
  }, 20_000);

  it("forks a standalone session over HTTP and copies its workspace", async () => {
    const sessionWorkspacePath = (sessionId: string) => join(dir, "sessions", sessionId);
    const workspaceApp = createTestApp({
      store,
      providerService: new ProviderService(store, secrets, vi.fn()),
      runner: new AgentRunner(store, secrets, { sessionWorkspacePath }),
      slashCommandService: new SlashCommandService(join(dir, "global"))
    });
    const session = await store.createSession({
      projectId: null,
      title: "分支源",
      accessMode: "approval"
    });
    const first = await store.addMessage({ sessionId: session.id, role: "user", content: "一" });
    await store.addMessage({ sessionId: session.id, role: "assistant", content: "二" });
    await mkdir(join(sessionWorkspacePath(session.id), "sub"), { recursive: true });
    await writeFile(join(sessionWorkspacePath(session.id), "note.txt"), "hello");
    await writeFile(join(sessionWorkspacePath(session.id), ".env"), "TOKEN=ok");
    await writeFile(join(sessionWorkspacePath(session.id), "sub", "todo.md"), "- item");

    const response = await workspaceApp(
      jsonRequest(`/api/sessions/${session.id}/fork`, "POST", { messageId: first.id })
    );
    expect(response.status).toBe(201);
    const { session: fork } = (await response.json()) as {
      session: { id: string; parentSessionId?: string; forkPointMessageId?: string };
    };
    expect(fork.parentSessionId).toBe(session.id);

    await expect(readFile(join(sessionWorkspacePath(fork.id), "note.txt"), "utf8")).resolves.toBe(
      "hello"
    );
    await expect(readFile(join(sessionWorkspacePath(fork.id), ".env"), "utf8")).resolves.toBe(
      "TOKEN=ok"
    );
    await expect(
      readFile(join(sessionWorkspacePath(fork.id), "sub", "todo.md"), "utf8")
    ).resolves.toBe("- item");

    const messages = await workspaceApp(
      new Request(`http://local/api/sessions/${fork.id}/messages`, { method: "GET" })
    );
    await expect(messages.json()).resolves.toMatchObject({
      messages: [{ id: fork.forkPointMessageId, content: "一" }]
    });

    const missing = await workspaceApp(
      jsonRequest("/api/sessions/nope/fork", "POST", { messageId: first.id })
    );
    expect(missing.status).toBe(404);
  });

  it("forks a standalone session when the source workspace is missing", async () => {
    const sessionWorkspacePath = (sessionId: string) => join(dir, "sessions", sessionId);
    const workspaceApp = createTestApp({
      store,
      providerService: new ProviderService(store, secrets, vi.fn()),
      runner: new AgentRunner(store, secrets, { sessionWorkspacePath })
    });
    const session = await store.createSession({
      projectId: null,
      title: "无目录源",
      accessMode: "approval"
    });
    const first = await store.addMessage({ sessionId: session.id, role: "user", content: "一" });

    const response = await workspaceApp(
      jsonRequest(`/api/sessions/${session.id}/fork`, "POST", { messageId: first.id })
    );

    expect(response.status).toBe(201);
    const { session: fork } = (await response.json()) as { session: { id: string } };
    await expect(lstat(sessionWorkspacePath(fork.id))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not copy the project directory when forking a project session", async () => {
    const sessionWorkspacePath = (sessionId: string) => join(dir, "sessions", sessionId);
    const workspaceApp = createTestApp({
      store,
      providerService: new ProviderService(store, secrets, vi.fn()),
      runner: new AgentRunner(store, secrets, { sessionWorkspacePath })
    });
    const projectRoot = join(dir, "project-workspace");
    await mkdir(projectRoot, { recursive: true });
    await writeFile(join(projectRoot, "project.txt"), "shared");
    const project = await store.createProject({ name: "项目", path: projectRoot });
    const session = await store.createSession({
      projectId: project.id,
      title: "项目分支源",
      accessMode: "approval"
    });
    const first = await store.addMessage({ sessionId: session.id, role: "user", content: "一" });

    const response = await workspaceApp(
      jsonRequest(`/api/sessions/${session.id}/fork`, "POST", { messageId: first.id })
    );

    expect(response.status).toBe(201);
    const { session: fork } = (await response.json()) as {
      session: { id: string; projectId: string | null };
    };
    expect(fork.projectId).toBe(project.id);
    await expect(lstat(sessionWorkspacePath(fork.id))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(join(projectRoot, "project.txt"), "utf8")).resolves.toBe("shared");
  });

  it("rolls back the fork when workspace copy fails", async () => {
    const sharedWorkspacePath = join(dir, "shared-session-workspace");
    const workspaceApp = createTestApp({
      store,
      providerService: new ProviderService(store, secrets, vi.fn()),
      runner: new AgentRunner(store, secrets, { sessionWorkspacePath: () => sharedWorkspacePath })
    });
    const session = await store.createSession({
      projectId: null,
      title: "复制失败源",
      accessMode: "approval"
    });
    const first = await store.addMessage({ sessionId: session.id, role: "user", content: "一" });
    await mkdir(sharedWorkspacePath, { recursive: true });
    await writeFile(join(sharedWorkspacePath, "note.txt"), "hello");

    const response = await workspaceApp(
      jsonRequest(`/api/sessions/${session.id}/fork`, "POST", { messageId: first.id })
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: "派生工作区目标目录已存在，已取消派生"
    });
    await expect(store.listSessions(null)).resolves.toHaveLength(1);
  });

  it("serves and saves the feishu config without exposing the secret", async () => {
    const { FeishuConfigService } = await import("../src/feishu/feishu-config-service");
    const { FeishuService } = await import("../src/feishu/feishu-service");
    const { FakeFeishuBridge } = await import("./helpers/fake-feishu-bridge");
    const bridge = new FakeFeishuBridge();
    const feishuConfigService = new FeishuConfigService(store, secrets);
    const feishuService = new FeishuService({
      configService: feishuConfigService,
      store,
      runner: new AgentRunner(store, secrets),
      bridgeFactory: () => bridge
    });
    const feishuApp = createTestApp({
      store,
      providerService: new ProviderService(store, secrets, vi.fn()),
      runner: new AgentRunner(store, secrets),
      feishuConfigService,
      feishuService
    });

    const initial = await feishuApp(
      new Request("http://local/api/settings/feishu", { method: "GET" })
    );
    await expect(initial.json()).resolves.toMatchObject({
      config: { enabled: false, appId: "", domain: "feishu", fullAccess: false }
    });

    const saved = await feishuApp(
      jsonRequest("/api/settings/feishu", "PUT", {
        enabled: true,
        appId: "cli_a1",
        appSecret: "super-secret",
        domain: "feishu",
        fullAccess: false
      })
    );
    expect(saved.status).toBe(200);
    const body = (await saved.json()) as {
      config: { appSecretRef?: string };
      status: { status: string };
    };
    expect(body.config.appSecretRef).toBe("memory:feishu");
    expect(JSON.stringify(body)).not.toContain("super-secret");
    // Saving restarted the service against the (fake) bridge.
    expect(body.status.status).toBe("connected");

    const status = await feishuApp(
      new Request("http://local/api/settings/feishu/status", { method: "GET" })
    );
    await expect(status.json()).resolves.toMatchObject({ status: { status: "connected" } });
  });

  it("starts and completes the feishu QR install flow without exposing the secret", async () => {
    const { FeishuConfigService } = await import("../src/feishu/feishu-config-service");
    const { FeishuInstallService } = await import("../src/feishu/feishu-install-service");
    const { FeishuService } = await import("../src/feishu/feishu-service");
    const { FakeFeishuBridge } = await import("./helpers/fake-feishu-bridge");
    const bridge = new FakeFeishuBridge();
    const feishuConfigService = new FeishuConfigService(store, secrets);
    const feishuInstallService = new FeishuInstallService({
      fetch: vi.fn(async (_url: string, init?: RequestInit) => {
        const params = new URLSearchParams(String(init?.body ?? ""));
        if (params.get("action") === "begin") {
          return new Response(
            JSON.stringify({
              verification_uri_complete: "https://open.feishu.cn/page/cli?user_code=QR-CODE",
              device_code: "device-api",
              user_code: "QR-CODE",
              interval: 3,
              expires_in: 120
            }),
            { headers: { "content-type": "application/json" } }
          );
        }
        return new Response(
          JSON.stringify({
            client_id: "cli_qr",
            client_secret: "qr-secret",
            user_info: { tenant_brand: "feishu" }
          }),
          { headers: { "content-type": "application/json" } }
        );
      }) as never
    });
    const feishuService = new FeishuService({
      configService: feishuConfigService,
      store,
      runner: new AgentRunner(store, secrets),
      bridgeFactory: () => bridge
    });
    const feishuApp = createTestApp({
      store,
      providerService: new ProviderService(store, secrets, vi.fn()),
      runner: new AgentRunner(store, secrets),
      feishuConfigService,
      feishuInstallService,
      feishuService
    });

    const started = await feishuApp(
      jsonRequest("/api/settings/feishu/install/start", "POST", { domain: "feishu" })
    );
    expect(started.status).toBe(200);
    await expect(started.json()).resolves.toMatchObject({
      ok: true,
      deviceCode: "device-api",
      interval: 3
    });

    const polled = await feishuApp(
      jsonRequest("/api/settings/feishu/install/poll", "POST", { deviceCode: "device-api" })
    );
    expect(polled.status).toBe(200);
    const body = (await polled.json()) as {
      done: boolean;
      config: FeishuConfig;
      status: { status: string };
    };
    expect(body).toMatchObject({
      done: true,
      config: { appId: "cli_qr", appSecretRef: "memory:feishu" },
      status: { status: "connected" }
    });
    expect(JSON.stringify(body)).not.toContain("qr-secret");
    await expect(feishuConfigService.getAppSecret(body.config)).resolves.toBe("qr-secret");
  });

  it("starts and completes generic connect-phone QR flows for WeChat and Feishu", async () => {
    const { FeishuConfigService } = await import("../src/feishu/feishu-config-service");
    const { FeishuInstallService } = await import("../src/feishu/feishu-install-service");
    const { FeishuService } = await import("../src/feishu/feishu-service");
    const { WechatConfigService } = await import("../src/wechat/wechat-config-service");
    const { WechatService } = await import("../src/wechat/wechat-service");
    const { FakeFeishuBridge } = await import("./helpers/fake-feishu-bridge");
    const { FakeWechatBridge } = await import("./helpers/fake-wechat-bridge");
    const feishuBridge = new FakeFeishuBridge();
    const wechatBridge = new FakeWechatBridge();
    const feishuConfigService = new FeishuConfigService(store, secrets);
    const wechatConfigService = new WechatConfigService(store);
    const feishuInstallService = new FeishuInstallService({
      fetch: vi.fn(async (_url: string, init?: RequestInit) => {
        const params = new URLSearchParams(String(init?.body ?? ""));
        if (params.get("action") === "begin") {
          return new Response(
            JSON.stringify({
              verification_uri_complete: "https://open.feishu.cn/page/cli?user_code=QR-CODE",
              device_code: "device-api",
              user_code: "QR-CODE",
              interval: 3,
              expires_in: 120
            }),
            { headers: { "content-type": "application/json" } }
          );
        }
        return new Response(
          JSON.stringify({
            client_id: "cli_qr",
            client_secret: "qr-secret",
            user_info: { tenant_brand: "feishu" }
          }),
          { headers: { "content-type": "application/json" } }
        );
      }) as never
    });
    const runner = new AgentRunner(store, secrets);
    const feishuService = new FeishuService({
      configService: feishuConfigService,
      store,
      runner,
      bridgeFactory: () => feishuBridge
    });
    const wechatService = new WechatService({
      configService: wechatConfigService,
      store,
      runner,
      bridge: wechatBridge
    });
    const connectPhoneApp = createTestApp({
      store,
      providerService: new ProviderService(store, secrets, vi.fn()),
      runner,
      feishuConfigService,
      feishuInstallService,
      feishuService,
      wechatConfigService,
      wechatService
    });

    const wechatStarted = await connectPhoneApp(
      jsonRequest("/api/settings/connect-phone/install/start", "POST", { target: "wechat" })
    );
    expect(wechatStarted.status).toBe(200);
    await expect(wechatStarted.json()).resolves.toMatchObject({
      ok: true,
      target: "wechat",
      deviceCode: "wechat-device"
    });
    const wechatPolled = await connectPhoneApp(
      jsonRequest("/api/settings/connect-phone/install/poll", "POST", {
        target: "wechat",
        deviceCode: "wechat-device"
      })
    );
    const wechatBody = await wechatPolled.json();
    expect(wechatBody).toMatchObject({
      done: true,
      target: "wechat",
      config: { accountId: "wechat_account", sessionKey: "wechat_session" },
      status: { status: "connected", accountId: "wechat_account" }
    });
    expect(wechatBridge.startedAccountId).toBe("wechat_account");

    const feishuStarted = await connectPhoneApp(
      jsonRequest("/api/settings/connect-phone/install/start", "POST", { target: "feishu" })
    );
    expect(feishuStarted.status).toBe(200);
    await expect(feishuStarted.json()).resolves.toMatchObject({
      ok: true,
      target: "feishu",
      deviceCode: "device-api",
      interval: 3
    });
    const feishuPolled = await connectPhoneApp(
      jsonRequest("/api/settings/connect-phone/install/poll", "POST", {
        target: "feishu",
        deviceCode: "device-api"
      })
    );
    const feishuBody = await feishuPolled.json();
    expect(feishuBody).toMatchObject({
      done: true,
      target: "feishu",
      config: { appId: "cli_qr", appSecretRef: "memory:feishu" },
      status: { status: "connected" }
    });
    expect(JSON.stringify(feishuBody)).not.toContain("qr-secret");
  });

  it("serves, saves and tests the web search config without exposing the API Key", async () => {
    const { WebSearchConfigService } = await import(
      "../src/web-search/web-search-config-service"
    );
    const webSearchConfigService = new WebSearchConfigService(store, secrets);
    const webSearchApp = createTestApp({
      store,
      providerService: new ProviderService(store, secrets, vi.fn()),
      runner: new AgentRunner(store, secrets),
      webSearchConfigService
    });

    const initial = await webSearchApp(
      new Request("http://local/api/settings/web-search", { method: "GET" })
    );
    await expect(initial.json()).resolves.toEqual({ config: { enabled: false } });

    const saved = await webSearchApp(
      jsonRequest("/api/settings/web-search", "PUT", {
        enabled: true,
        apiKey: "tvly-secret"
      })
    );
    expect(saved.status).toBe(200);
    const body = (await saved.json()) as { config: { apiKeyRef?: string } };
    expect(body.config.apiKeyRef).toBe("memory:web-search:tavily");
    expect(JSON.stringify(body)).not.toContain("tvly-secret");

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ results: [{ title: "OK", url: "https://example.com" }] }), {
        headers: { "content-type": "application/json" }
      })) as typeof fetch;
    try {
      const tested = await webSearchApp(
        new Request("http://local/api/settings/web-search/test", { method: "POST" })
      );
      expect(tested.status).toBe(200);
      await expect(tested.json()).resolves.toEqual({ ok: true });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("reports feishu routes as unavailable when not wired", async () => {
    const connectWechatStart = await app(
      jsonRequest("/api/settings/connect-phone/install/start", "POST", { target: "wechat" })
    );
    expect(connectWechatStart.status).toBe(200);
    await expect(connectWechatStart.json()).resolves.toEqual({
      ok: false,
      target: "wechat",
      message: "微信连接服务不可用"
    });
    const connectFeishuStart = await app(
      jsonRequest("/api/settings/connect-phone/install/start", "POST", { target: "feishu" })
    );
    expect(connectFeishuStart.status).toBe(200);
    await expect(connectFeishuStart.json()).resolves.toEqual({
      ok: false,
      target: "feishu",
      message: "飞书扫码安装服务不可用"
    });
    const connectWechatPoll = await app(
      jsonRequest("/api/settings/connect-phone/install/poll", "POST", {
        target: "wechat",
        deviceCode: "missing"
      })
    );
    expect(connectWechatPoll.status).toBe(200);
    await expect(connectWechatPoll.json()).resolves.toEqual({
      done: false,
      target: "wechat",
      error: "微信连接服务不可用"
    });
    const response = await app(
      new Request("http://local/api/settings/feishu", { method: "GET" })
    );
    expect(response.status).toBe(404);
    const installStart = await app(
      jsonRequest("/api/settings/feishu/install/start", "POST", { domain: "feishu" })
    );
    expect(installStart.status).toBe(404);
    await expect(installStart.json()).resolves.toEqual({ error: "飞书扫码安装服务不可用" });
    const installPoll = await app(
      jsonRequest("/api/settings/feishu/install/poll", "POST", { deviceCode: "missing" })
    );
    expect(installPoll.status).toBe(404);
    await expect(installPoll.json()).resolves.toEqual({ error: "飞书服务不可用" });
    const status = await app(
      new Request("http://local/api/settings/feishu/status", { method: "GET" })
    );
    await expect(status.json()).resolves.toEqual({ status: { status: "disconnected" } });
    const wechat = await app(
      new Request("http://local/api/settings/wechat", { method: "GET" })
    );
    expect(wechat.status).toBe(404);
    await expect(wechat.json()).resolves.toEqual({ error: "微信服务不可用" });
    const wechatStatus = await app(
      new Request("http://local/api/settings/wechat/status", { method: "GET" })
    );
    await expect(wechatStatus.json()).resolves.toEqual({ status: { status: "disconnected" } });
    const webSearch = await app(
      new Request("http://local/api/settings/web-search", { method: "GET" })
    );
    expect(webSearch.status).toBe(404);
  });

  it("allows PATCH in CORS preflight responses", async () => {
    const response = await app(new Request("http://local/api/sessions/session_1", {
      method: "OPTIONS"
    }));

    expect(response.headers.get("Access-Control-Allow-Methods")).toContain("PATCH");
  });

  it("streams setup failures as setup_error before a run exists", async () => {
    await store.deleteProvider("deepseek");
    const { entries, restore } = captureBackendLogs();

    try {
      const response = await app(
        jsonRequest("/api/runs/stream", "POST", {
          prompt: "你好",
          accessMode: "approval"
        })
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toContain("text/event-stream");
      const body = await response.text();
      expect(body).toContain('"type":"setup_error"');
      expect(body).toContain("请先配置至少一个模型");
      expect(body).not.toContain('"runId":"setup"');
      expect(entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            level: "error",
            message: "/api/runs/stream 运行失败",
            fields: expect.objectContaining({
              displayError: "请先配置至少一个模型",
              errorMessage: "请先配置至少一个模型"
            })
          })
        ])
      );
    } finally {
      restore();
    }
  });

  it("streams a full run as SSE events in contract order", async () => {
    const scripted = scriptedStreamFn([{ thinking: "想一想", text: "你好！" }]);
    const sseApp = createTestApp({
      store,
      providerService: new ProviderService(store, secrets, vi.fn()),
      runner: new AgentRunner(store, secrets, { streamFn: scripted.streamFn })
    });

    const response = await sseApp(
      jsonRequest("/api/runs/stream", "POST", {
        prompt: "你好",
        accessMode: "approval"
      })
    );

    expect(response.status).toBe(200);
    const events = parseSseChunk(await response.text());
    expect(events.map((event) => event.type)).toEqual([
      "run_started",
      "session_updated",
      "message",
      "delta",
      "delta",
      "message",
      "run_end"
    ]);
    expect(events.at(-1)).toMatchObject({ type: "run_end", status: "completed" });
  });

  it("starts a run through POST /api/runs and publishes events on the global SSE stream", async () => {
    const scripted = scriptedStreamFn([{ thinking: "想一想", text: "你好！" }]);
    const eventApp = createTestApp({
      store,
      providerService: new ProviderService(store, secrets, vi.fn()),
      runner: new AgentRunner(store, secrets, { streamFn: scripted.streamFn })
    });
    const eventsController = new AbortController();
    const eventsResponse = await eventApp(
      new Request("http://local/api/events", { signal: eventsController.signal })
    );
    const eventsPromise = collectSseEvents(eventsResponse, eventsController);

    const startedResponse = await eventApp(
      jsonRequest("/api/runs", "POST", {
        prompt: "你好",
        clientRequestId: "client_1",
        accessMode: "approval"
      })
    );

    expect(startedResponse.status).toBe(200);
    await expect(startedResponse.json()).resolves.toMatchObject({
      sessionId: expect.any(String),
      runId: expect.any(String),
      clientRequestId: "client_1",
      model: expect.any(String)
    });
    const events = await eventsPromise;
    expect(events.map((event) => event.type)).toEqual([
      "run_started",
      "session_updated",
      "message",
      "delta",
      "delta",
      "message",
      "run_end"
    ]);
    expect(events[0]).toMatchObject({ type: "run_started", clientRequestId: "client_1" });
    expect(events.at(-1)).toMatchObject({ type: "run_end", status: "completed" });
  });

  it("keeps request id, client request id, run id and session id on POST /api/runs logs", async () => {
    const scripted = scriptedStreamFn([{ text: "你好！" }]);
    const runApp = createTestApp({
      store,
      providerService: new ProviderService(store, secrets, vi.fn()),
      runner: new AgentRunner(store, secrets, { streamFn: scripted.streamFn })
    });
    const { entries, restore } = captureBackendLogs();
    try {
      const response = await runApp(
        new Request("http://local/api/runs", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-request-id": "req_run_1"
          },
          body: JSON.stringify({
            prompt: "你好",
            clientRequestId: "client_log_1",
            accessMode: "approval"
          })
        })
      );
      expect(response.status).toBe(200);
      const started = (await response.json()) as { runId: string; sessionId: string };

      await vi.waitFor(async () => {
        const run = (await store.listRuns(started.sessionId)).find((item) => item.id === started.runId);
        expect(run?.status).toBe("completed");
      });

      expect(entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            message: "登记活跃 run",
            fields: expect.objectContaining({
              requestId: "req_run_1",
              clientRequestId: "client_log_1",
              runId: started.runId,
              sessionId: started.sessionId,
              module: "active-runs"
            })
          })
        ])
      );
    } finally {
      restore();
    }
  });

  it("replays missed global SSE events after the last event id", async () => {
    const scripted = scriptedStreamFn([{ thinking: "想一想", text: "你好！" }]);
    const eventApp = createTestApp({
      store,
      providerService: new ProviderService(store, secrets, vi.fn()),
      runner: new AgentRunner(store, secrets, { streamFn: scripted.streamFn })
    });
    const firstController = new AbortController();
    const firstResponse = await eventApp(
      new Request("http://local/api/events", { signal: firstController.signal })
    );
    const firstEventsPromise = collectSseEventsWithIds(
      firstResponse,
      firstController,
      (event) => event.type === "run_started"
    );

    const startedResponse = await eventApp(
      jsonRequest("/api/runs", "POST", {
        prompt: "你好",
        clientRequestId: "client_replay",
        accessMode: "approval"
      })
    );
    const started = (await startedResponse.json()) as { runId: string; sessionId: string };
    const firstEvents = await firstEventsPromise;
    expect(firstEvents.events.map((event) => event.type)).toEqual(["run_started"]);
    const lastEventId = firstEvents.ids.at(-1);
    expect(lastEventId).toEqual(expect.any(String));

    await vi.waitFor(async () => {
      const run = (await store.listRuns(started.sessionId)).find((item) => item.id === started.runId);
      expect(run?.status).toBe("completed");
    });

    const replayController = new AbortController();
    const replayResponse = await eventApp(
      new Request(`http://local/api/events?lastEventId=${lastEventId}`, {
        signal: replayController.signal
      })
    );
    const replayEvents = await collectSseEventsWithIds(
      replayResponse,
      replayController,
      (event) => event.type === "run_end"
    );

    expect(replayEvents.events.map((event) => event.type)).toEqual([
      "session_updated",
      "message",
      "delta",
      "delta",
      "message",
      "run_end"
    ]);
    expect(replayEvents.events.at(-1)).toMatchObject({ type: "run_end", status: "completed" });
  });

  it("returns an HTTP error when POST /api/runs fails before run_started", async () => {
    await store.deleteProvider("deepseek");
    const { entries, restore } = captureBackendLogs();

    try {
      const response = await app(
        jsonRequest("/api/runs", "POST", {
          prompt: "你好",
          accessMode: "approval"
        })
      );

      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toMatchObject({ error: "请先配置至少一个模型" });
      expect(entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            level: "error",
            message: "/api/runs 启动失败",
            fields: expect.objectContaining({
              displayError: "请先配置至少一个模型",
              errorMessage: "请先配置至少一个模型"
            })
          })
        ])
      );
    } finally {
      restore();
    }
  });

  it("rejects steering for inactive runs through HTTP API", async () => {
    const response = await app(
      jsonRequest("/api/runs/run_missing/steering", "POST", {
        prompt: "补充说明",
        displayContent: "补充说明"
      })
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "当前运行已结束，无法注入引导"
    });
  });

  it("returns in-process active run snapshots and lets approval continue after reconnect", async () => {
    const scripted = scriptedStreamFn([
      {
        toolCalls: [
          {
            id: "call_write",
            name: "Write",
            arguments: { file_path: ".env", content: "TOKEN=ok" }
          }
        ]
      },
      { text: "写好了。" }
    ]);
    const runner = new AgentRunner(store, secrets, {
      streamFn: scripted.streamFn,
      sessionWorkspacePath: (sessionId) => join(dir, "sessions", sessionId)
    });
    const activeApp = createTestApp({
      store,
      providerService: new ProviderService(store, secrets, vi.fn()),
      runner
    });

    const startedResponse = await activeApp(
      jsonRequest("/api/runs", "POST", {
        prompt: "写文件",
        accessMode: "approval"
      })
    );
    expect(startedResponse.status).toBe(200);
    const started = (await startedResponse.json()) as { runId: string; sessionId: string };

    let activePayload:
      | { runs: Array<{ run: { id: string; sessionId: string }; toolCalls: ToolCall[] }> }
      | undefined;
    await vi.waitFor(async () => {
      const response = await activeApp(
        new Request(`http://local/api/runs/active?sessionId=${started.sessionId}`)
      );
      expect(response.status).toBe(200);
      activePayload = (await response.json()) as typeof activePayload;
      expect(activePayload?.runs).toHaveLength(1);
      expect(activePayload?.runs[0]?.run).toMatchObject({
        id: started.runId,
        sessionId: started.sessionId
      });
      expect(activePayload?.runs[0]?.toolCalls).toEqual([
        expect.objectContaining({ name: "Write", status: "pending_approval" })
      ]);
    });

    const pendingTool = activePayload?.runs[0]?.toolCalls[0];
    expect(pendingTool?.id).toBeTruthy();
    const approval = await activeApp(
      jsonRequest(`/api/approvals/${pendingTool!.id}`, "POST", { approved: true })
    );
    expect(approval.status).toBe(200);

    await vi.waitFor(async () => {
      const response = await activeApp(
        new Request(`http://local/api/runs/active?sessionId=${started.sessionId}`)
      );
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ runs: [] });
      const runs = await store.listRuns(started.sessionId);
      expect(runs.find((run) => run.id === started.runId)?.status).toBe("completed");
    });
  });

  it("does not expose stale DB running records as active run snapshots", async () => {
    const session = await store.createSession({
      projectId: null,
      title: "残留运行",
      accessMode: "approval"
    });
    await store.createRun({
      id: "run_stale",
      sessionId: session.id,
      status: "running"
    });

    const response = await app(
      new Request(`http://local/api/runs/active?sessionId=${session.id}`, { method: "GET" })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ runs: [] });
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
    await store.createRun({
      id: "run_2",
      sessionId: session.id,
      status: "running"
    });
    await store.updateRunStatus("run_2", "failed", undefined, "模型 token 超限");
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
    await store.insertToolCall(toolCall);

    const response = await app(
      new Request(`http://local/api/sessions/${session.id}/runs`, {
        method: "GET"
      })
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.runs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "run_1", sessionId: session.id, status: "completed" }),
        expect.objectContaining({
          id: "run_2",
          sessionId: session.id,
          status: "failed",
          error: "模型 token 超限"
        })
      ])
    );
    expect(payload).toMatchObject({
      toolCalls: [
        {
          id: "tool_1",
          runId: "run_1",
          name: "LS",
          args: { path: "." },
          status: "completed",
          result: "file package.json"
        }
      ]
    });
  });

  it("returns global usage stats from settings API", async () => {
    const session = await store.createSession({
      projectId: null,
      title: "用量统计",
      providerId: "deepseek",
      accessMode: "approval"
    });
    await store.createRun({
      id: "run_usage_stats",
      sessionId: session.id,
      status: "running",
      providerId: "deepseek",
      providerKind: "deepseek",
      model: "deepseek-v4-flash"
    });
    await store.updateRunStatus("run_usage_stats", "completed");
    await store.upsertUsageCostEntry({
      runId: "run_usage_stats",
      sessionId: session.id,
      attemptIndex: 0,
      providerId: "deepseek",
      providerKind: "deepseek",
      model: "deepseek-v4-flash",
      promptTokens: 1_000_000,
      completionTokens: 1_000_000,
      cachedPromptTokens: 0,
      totalTokens: 2_000_000,
      inputEstimatedTokens: 1_000_000,
      costUsd: 0.5,
      costCny: 3.5,
      costSource: "catalog_usage",
      tokenCountSource: "provider_usage",
      billable: true,
      entryCreatedAt: nowIso()
    });

    const response = await app(
      new Request("http://local/api/settings/usage-stats?timezoneOffsetMinutes=-480", {
        method: "GET"
      })
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.stats).toMatchObject({
      currency: "CNY",
      total: {
        runCount: 1,
        usageRunCount: 1,
        totalTokens: 2_000_000
      },
      dataQuality: {
        totalRunCount: 1,
        pricedRunCount: 1
      }
    });
    expect(payload.stats.dailyBuckets).toHaveLength(371);
    expect(payload.stats.total.costCny).toBeGreaterThan(2);
  });

  it("executes terminal commands inside the project directory", async () => {
    const projectRoot = join(dir, "workspace");
    await mkdir(projectRoot, { recursive: true });
    await writeFile(join(projectRoot, "hello.txt"), "hi", "utf8");
    const project = await store.createProject({ name: "workspace", path: projectRoot });

    const response = await app(
      jsonRequest("/api/terminal/exec", "POST", {
        projectId: project.id,
        command: listDirectoryCommand()
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
        command: failingTerminalCommand(2, "broken")
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

  it("lists compaction and pi slash commands with project resources taking priority", async () => {
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
        expect.objectContaining({ name: "/compact", source: "builtin" }),
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
    const localApp = createTestApp({
      store,
      providerService: new ProviderService(store, new MemorySecretStore(), vi.fn()),
      runner: new AgentRunner(store, new MemorySecretStore()),
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
    expect(body.commands).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "/compact" })])
    );
    expect(body.diagnostics.length).toBeGreaterThan(0);
    expect(body.diagnostics[0]?.source).toBe("global");
  });

  it("passes full approval decisions through HTTP API", async () => {
    const runner = new AgentRunner(store, secrets);
    const decideSpy = vi.spyOn(runner.approvals, "decide");
    const localApp = createTestApp({
      store,
      providerService: new ProviderService(store, secrets, vi.fn()),
      runner
    });

    const response = await localApp(
      jsonRequest("/api/approvals/tool_plan", "POST", {
        approved: true,
        approvalScope: "project",
        editedSteps: [{ id: "s1", title: "确认后的步骤" }]
      })
    );

    expect(response.status).toBe(200);
    expect(decideSpy).toHaveBeenCalledWith("tool_plan", {
      approved: true,
      approvalScope: "project",
      editedSteps: [{ id: "s1", title: "确认后的步骤", status: "pending" }]
    });
  });

  it("lists provider models through HTTP API", async () => {
    const listModels = vi.fn(async () => ["deepseek-v4-flash", "deepseek-chat"]);
    const localApp = createTestApp({
      store,
      providerService: new ProviderService(store, secrets, vi.fn(), listModels),
      runner: new AgentRunner(store, secrets)
    });

    const response = await localApp(
      new Request("http://local/api/settings/providers/deepseek/models", { method: "GET" })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      models: ["deepseek-v4-flash", "deepseek-chat"]
    });
    expect(listModels).toHaveBeenCalledWith(
      expect.objectContaining({ id: "deepseek" }),
      "test-key"
    );
  });

  it("manages scheduled tasks through HTTP API", async () => {
    const session = await store.createSession({
      projectId: null,
      title: "会话",
      accessMode: "approval"
    });
    const task = await store.createScheduledTask({
      sessionId: session.id,
      name: "AI 日报",
      prompt: "生成日报",
      kind: "recurring",
      cron: "0 9 * * *",
      fullAccess: false,
      nextRunAt: "2020-01-01T00:00:00.000Z"
    });

    const listed = await app(new Request("http://local/api/tasks", { method: "GET" }));
    expect(listed.status).toBe(200);
    await expect(listed.json()).resolves.toMatchObject({
      tasks: [{ id: task.id, name: "AI 日报", enabled: true }]
    });

    // 非法 cron 拒绝
    const badCron = await app(
      jsonRequest(`/api/tasks/${task.id}`, "PATCH", { cron: "0 0 9 * * *" })
    );
    expect(badCron.status).toBe(400);

    // 停用再启用：重新启用必须重算 nextRunAt，不得立刻补跑陈旧时间点。
    const disabled = await app(jsonRequest(`/api/tasks/${task.id}`, "PATCH", { enabled: false }));
    expect(disabled.status).toBe(200);
    const reEnabled = await app(jsonRequest(`/api/tasks/${task.id}`, "PATCH", { enabled: true }));
    const reEnabledBody = (await reEnabled.json()) as { task: { nextRunAt: string } };
    expect(Date.parse(reEnabledBody.task.nextRunAt)).toBeGreaterThan(Date.now());

    const onceTask = await store.createScheduledTask({
      sessionId: session.id,
      name: "一次性提醒",
      prompt: "提醒我睡觉",
      kind: "once",
      runAt: "2020-01-01T00:00:00.000Z",
      fullAccess: false,
      nextRunAt: "2020-01-01T00:00:00.000Z"
    });
    await store.updateScheduledTask(onceTask.id, { enabled: false, nextRunAt: null });
    const reEnableOnce = await app(
      jsonRequest(`/api/tasks/${onceTask.id}`, "PATCH", { enabled: true })
    );
    expect(reEnableOnce.status).toBe(400);

    const missing = await app(jsonRequest("/api/tasks/task_missing", "PATCH", { enabled: false }));
    expect(missing.status).toBe(404);

    // 未注入调度器时立即运行返回 503（AppContext.taskScheduler 可选）。
    const runWithoutScheduler = await app(
      new Request(`http://local/api/tasks/${task.id}/run`, { method: "POST" })
    );
    expect(runWithoutScheduler.status).toBe(503);

    const runNow = vi.fn(async () => {});
    const schedulerApp = createTestApp({
      store,
      providerService: new ProviderService(store, secrets, vi.fn()),
      runner: new AgentRunner(store, secrets),
      taskScheduler: { runNow } as never
    });
    const ran = await schedulerApp(
      new Request(`http://local/api/tasks/${task.id}/run`, { method: "POST" })
    );
    expect(ran.status).toBe(202);
    expect(runNow).toHaveBeenCalledWith(task.id);

    const deleted = await app(
      new Request(`http://local/api/tasks/${task.id}`, { method: "DELETE" })
    );
    expect(deleted.status).toBe(200);
    await expect(deleted.json()).resolves.toEqual({ deleted: true });
  });

  it("returns 404 for skills routes when the market service is absent", async () => {
    const missing = await app(new Request("http://local/api/skills", { method: "GET" }));
    expect(missing.status).toBe(404);
  });

  it("lists, toggles and manages skills through HTTP API", async () => {
    await mkdir(join(dir, "market", "code-review"), { recursive: true });
    await writeFile(
      join(dir, "market", "code-review", "SKILL.md"),
      "---\nname: code-review\ndescription: 审代码\nmetadata:\n  category: coding\n---\n正文",
      "utf8"
    );
    const skillsApp = createTestApp({
      store,
      providerService: new ProviderService(store, secrets, vi.fn()),
      runner: new AgentRunner(store, secrets),
      skillMarketService: new SkillMarketService(store, {
        builtinRoot: join(dir, "builtin"),
        marketRoot: join(dir, "market"),
        customRoot: join(dir, "custom")
      })
    });

    const listed = await skillsApp(new Request("http://local/api/skills", { method: "GET" }));
    expect(listed.status).toBe(200);
    await expect(listed.json()).resolves.toEqual({
      skills: [
        {
          name: "code-review",
          description: "审代码",
          category: "coding",
          source: "market",
          enabled: false
        }
      ]
    });

    const detail = await skillsApp(
      new Request("http://local/api/skills/detail/code-review", { method: "GET" })
    );
    expect(detail.status).toBe(200);
    await expect(detail.json()).resolves.toMatchObject({
      skill: { name: "code-review", source: "market", content: "正文" }
    });

    const detailMissing = await skillsApp(
      new Request("http://local/api/skills/detail/nope", { method: "GET" })
    );
    expect(detailMissing.status).toBe(404);

    const enabled = await skillsApp(
      jsonRequest("/api/skills/market/code-review", "PUT", { enabled: true })
    );
    expect(enabled.status).toBe(200);
    const enabledBody = (await enabled.json()) as { skills: Array<{ enabled: boolean }> };
    expect(enabledBody.skills[0]?.enabled).toBe(true);

    const unknown = await skillsApp(
      jsonRequest("/api/skills/market/missing", "PUT", { enabled: true })
    );
    expect(unknown.status).toBe(400);

    const created = await skillsApp(
      jsonRequest("/api/skills/custom", "POST", {
        name: "daily-report",
        description: "生成日报",
        content: "按模板写日报"
      })
    );
    expect(created.status).toBe(200);
    await expect(created.json()).resolves.toMatchObject({
      skill: { name: "daily-report", source: "custom", enabled: true }
    });

    const deletedSkill = await skillsApp(
      new Request("http://local/api/skills/custom/daily-report", { method: "DELETE" })
    );
    expect(deletedSkill.status).toBe(200);
    await expect(deletedSkill.json()).resolves.toEqual({ deleted: true });
  });
});

function jsonRequest(path: string, method: string, body: unknown): Request {
  return new Request(`http://local${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

async function collectSseEvents(
  response: Response,
  controller: AbortController
): Promise<StreamEvent[]> {
  expect(response.status).toBe(200);
  expect(response.body).toBeTruthy();
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events: StreamEvent[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split(/\n\n+/);
    buffer = blocks.pop() ?? "";
    for (const block of blocks) {
      const data = block
        .split("\n")
        .find((line) => line.startsWith("data: "))
        ?.slice(6);
      if (!data) {
        continue;
      }
      const event = JSON.parse(data) as StreamEvent;
      events.push(event);
      if (event.type === "run_end") {
        controller.abort();
        return events;
      }
    }
  }
  return events;
}

async function collectSseEventsWithIds(
  response: Response,
  controller: AbortController,
  shouldStop: (event: StreamEvent) => boolean
): Promise<{ events: StreamEvent[]; ids: string[] }> {
  expect(response.status).toBe(200);
  expect(response.body).toBeTruthy();
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events: StreamEvent[] = [];
  const ids: string[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split(/\n\n+/);
    buffer = blocks.pop() ?? "";
    for (const block of blocks) {
      const lines = block.split("\n");
      const data = lines.find((line) => line.startsWith("data: "))?.slice(6);
      if (!data) {
        continue;
      }
      const event = JSON.parse(data) as StreamEvent;
      const id = lines.find((line) => line.startsWith("id: "))?.slice(4);
      events.push(event);
      if (id) {
        ids.push(id);
      }
      if (shouldStop(event)) {
        controller.abort();
        return { events, ids };
      }
    }
  }
  return { events, ids };
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

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 2));
}
