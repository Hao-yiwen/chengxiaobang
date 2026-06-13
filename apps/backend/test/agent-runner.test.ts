import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  nowIso,
  type ProviderConfig,
  type StreamEvent,
  type ToolCallApproval
} from "@chengxiaobang/shared";
import { AgentRunner, type AgentRunnerOptions } from "../src/agent/agent-runner";
import { TOOL_RESULT_SPILL_DIR } from "../src/agent/tool-result-spill";
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

function builtinSkillSlashService(globalRoot: string): SlashCommandService {
  return new SlashCommandService(globalRoot, join(process.cwd(), "apps/backend"));
}

function smartDecision(
  verdict: ToolCallApproval["verdict"],
  overrides: Partial<ToolCallApproval> = {}
): ToolCallApproval {
  return {
    kind: "smart",
    source: "model",
    verdict,
    risk: verdict === "allow" ? "low" : "high",
    score: verdict === "allow" ? 0.1 : 0.9,
    reason: verdict === "allow" ? "普通工作区操作" : "风险过高",
    decidedAt: "2026-06-13T00:00:00.000Z",
    ...overrides
  };
}

function longRunningShellCommand(): string {
  return process.platform === "win32" ? "ping 127.0.0.1 -n 6 >nul" : "sleep 5";
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

  it("waits for approval before risky direct tools", async () => {
    const { runner } = runnerWith(store, secrets, [{ text: "完成" }]);
    const events: StreamEvent[] = [];
    const stream = runner.stream({
      prompt: "/shell npm publish",
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
      expect(runner.approvals.decide(approval.value.toolCall.id, { approved: false })).toBe(true);
    }

    for await (const event of stream) {
      events.push(event);
    }
    expect(
      events.some((event) => event.type === "tool_call" && event.toolCall.status === "rejected")
    ).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: "run_end", status: "aborted" });
  });

  it("runs ordinary direct file writes without manual approval", async () => {
    const project = await store.createProject({ name: "tmp", path: dir });
    const { runner } = runnerWith(store, secrets, [{ text: "完成" }]);
    const transitions: string[] = [];

    for await (const event of runner.stream({
      prompt: "/write ordinary.txt\nhello",
      projectId: project.id,
      accessMode: "approval"
    })) {
      if (event.type === "tool_call") {
        transitions.push(event.toolCall.status);
      }
    }

    expect(transitions).toEqual(["running", "completed"]);
    await expect(readFile(join(dir, "ordinary.txt"), "utf8")).resolves.toBe("hello");
  });

  it("requires approval before direct writes to absolute paths outside the workspace", async () => {
    const project = await store.createProject({ name: "tmp", path: dir });
    const outsideDir = await mkdtemp(join(tmpdir(), "cxb-agent-outside-"));
    const outsideFile = join(outsideDir, "note.txt");
    const { runner } = runnerWith(store, secrets, [{ text: "完成" }]);
    const transitions: string[] = [];
    let pendingHadNoStart = false;

    try {
      for await (const event of runner.stream({
        prompt: `/write ${outsideFile}\nhello`,
        projectId: project.id,
        accessMode: "approval"
      })) {
        if (event.type === "tool_call") {
          transitions.push(event.toolCall.status);
          if (event.toolCall.status === "pending_approval") {
            pendingHadNoStart = event.toolCall.startedAt === undefined;
            runner.approvals.decide(event.toolCall.id, { approved: true });
          }
        }
      }

      expect(transitions).toEqual(["pending_approval", "running", "completed"]);
      expect(pendingHadNoStart).toBe(true);
      await expect(readFile(outsideFile, "utf8")).resolves.toBe("hello");
    } finally {
      await rm(outsideDir, { recursive: true, force: true });
    }
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

  it("injects steering messages at the next safe turn boundary", async () => {
    let releaseFirstTurn: () => void = () => {};
    const firstTurnGate = new Promise<void>((resolve) => {
      releaseFirstTurn = resolve;
    });
    let markFirstTurnStarted: () => void = () => {};
    const firstTurnStarted = new Promise<void>((resolve) => {
      markFirstTurnStarted = resolve;
    });
    const { runner, calls } = runnerWith(store, secrets, [
      {
        onStart: () => {
          markFirstTurnStarted();
          return firstTurnGate;
        },
        text: "先处理当前请求"
      },
      { text: "已收到补充" }
    ]);
    const stream = runner.stream({
      prompt: "第一句话",
      projectId: null,
      accessMode: "approval"
    });
    const events: StreamEvent[] = [];
    let resolveStarted: (event: Extract<StreamEvent, { type: "run_started" }>) => void = () => {};
    const startedPromise = new Promise<Extract<StreamEvent, { type: "run_started" }>>(
      (resolve) => {
        resolveStarted = resolve;
      }
    );
    const consume = (async () => {
      for await (const event of stream) {
        events.push(event);
        if (event.type === "run_started") {
          resolveStarted(event);
        }
      }
    })();

    const started = await startedPromise;
    await firstTurnStarted;

    expect(
      runner.enqueueSteering(started.runId, {
        prompt: "补充一",
        displayContent: "补充一"
      })
    ).toBe(true);
    expect(
      runner.enqueueSteering(started.runId, {
        prompt: "补充二",
        displayContent: "补充二"
      })
    ).toBe(true);

    releaseFirstTurn();
    await consume;

    expect(
      events
        .filter((event) => event.type === "message" && event.message.role === "user")
        .map((event) => ("message" in event ? event.message.content : ""))
    ).toEqual(["第一句话", "补充一", "补充二"]);
    expect(calls).toHaveLength(2);
    expect(
      calls[1].context.messages
        .filter((message) => message.role === "user")
        .map((message) => String(message.content))
    ).toEqual(["第一句话", "补充一", "补充二"]);
    const messages = await store.listMessages(started.sessionId);
    expect(messages.map((message) => message.content)).toContain("补充一");
    expect(messages.map((message) => message.content)).toContain("补充二");
  });

  it("rejects steering for inactive runs without polluting history", async () => {
    const { runner } = runnerWith(store, secrets, [{ text: "完成" }]);
    let runId: string | undefined;
    let sessionId: string | undefined;

    for await (const event of runner.stream({
      prompt: "第一句话",
      projectId: null,
      accessMode: "approval"
    })) {
      if (event.type === "run_started") {
        runId = event.runId;
        sessionId = event.sessionId;
      }
    }

    expect(runId).toBeDefined();
    expect(sessionId).toBeDefined();
    expect(
      runner.enqueueSteering(runId!, {
        prompt: "迟到的补充",
        displayContent: "迟到的补充"
      })
    ).toBe(false);
    const messages = await store.listMessages(sessionId!);
    expect(messages.map((message) => message.content)).not.toContain("迟到的补充");
  });

  it("aborts a running direct shell command promptly", async () => {
    const project = await store.createProject({ name: "tmp", path: dir });
    const { runner, calls } = runnerWith(store, secrets, [{ text: "不应该被调用" }]);
    const events: StreamEvent[] = [];
    let runId: string | undefined;
    const startedAt = Date.now();

    for await (const event of runner.stream({
      prompt: `/shell ${longRunningShellCommand()}`,
      projectId: project.id,
      accessMode: "full_access"
    })) {
      events.push(event);
      if (event.type === "run_started") {
        runId = event.runId;
      }
      if (event.type === "tool_call" && event.toolCall.status === "running") {
        expect(runId).toBeDefined();
        runner.abort(runId!);
      }
    }

    expect(Date.now() - startedAt).toBeLessThan(2_000);
    expect(
      events.filter((event) => event.type === "tool_call").map((event) => event.toolCall.status)
    ).toEqual(["running", "failed"]);
    expect(events.at(-1)).toMatchObject({ type: "run_end", status: "aborted" });
    expect(calls).toHaveLength(0);
  });

  it("智能审批跳过低风险 direct 工具裁决", async () => {
    const project = await store.createProject({ name: "tmp", path: dir });
    const judge = vi.fn(async () => smartDecision("allow"));
    const { runner } = runnerWith(store, secrets, [{ text: "完成" }], {
      smartApprovalJudge: judge
    });
    const transitions: string[] = [];
    let completedApproval: ToolCallApproval | undefined;

    for await (const event of runner.stream({
      prompt: "/write smart.txt\nhello",
      projectId: project.id,
      accessMode: "smart_approval"
    })) {
      if (event.type === "tool_call") {
        transitions.push(event.toolCall.status);
        completedApproval = event.toolCall.approval;
      }
    }

    expect(judge).not.toHaveBeenCalled();
    expect(transitions).toEqual(["running", "completed"]);
    expect(completedApproval).toBeUndefined();
    await expect(readFile(join(dir, "smart.txt"), "utf8")).resolves.toBe("hello");
  });

  it("智能审批把工作区外 direct 写入升级为人工确认", async () => {
    const project = await store.createProject({ name: "tmp", path: dir });
    const outsideDir = await mkdtemp(join(tmpdir(), "cxb-agent-smart-outside-"));
    const outsideFile = join(outsideDir, "smart.txt");
    const { runner } = runnerWith(store, secrets, [{ text: "完成" }]);
    const transitions: string[] = [];
    let approval: ToolCallApproval | undefined;

    try {
      for await (const event of runner.stream({
        prompt: `/write ${outsideFile}\nhello`,
        projectId: project.id,
        accessMode: "smart_approval"
      })) {
        if (event.type === "tool_call") {
          transitions.push(event.toolCall.status);
          approval = event.toolCall.approval;
          if (event.toolCall.status === "pending_approval") {
            runner.approvals.decide(event.toolCall.id, { approved: true });
          }
        }
      }

      expect(transitions).toEqual([
        "pending_smart_approval",
        "pending_approval",
        "running",
        "completed"
      ]);
      expect(approval).toMatchObject({
        source: "rule",
        verdict: "ask_user",
        userDecision: { approved: true }
      });
      await expect(readFile(outsideFile, "utf8")).resolves.toBe("hello");
    } finally {
      await rm(outsideDir, { recursive: true, force: true });
    }
  });

  it("智能审批自动拒绝高风险 direct 工具", async () => {
    const project = await store.createProject({ name: "tmp", path: dir });
    const judge = vi.fn(async () => smartDecision("deny", { reason: "会删除文件" }));
    const { runner } = runnerWith(store, secrets, [], { smartApprovalJudge: judge });
    const events: StreamEvent[] = [];

    for await (const event of runner.stream({
      prompt: "/shell rm -rf build",
      projectId: project.id,
      accessMode: "smart_approval"
    })) {
      events.push(event);
    }

    expect(judge).toHaveBeenCalledOnce();
    expect(
      events.filter((event) => event.type === "tool_call").map((event) => event.toolCall.status)
    ).toEqual(["pending_smart_approval", "rejected"]);
    expect(events.find((event) => event.type === "tool_call" && event.toolCall.status === "rejected"))
      .toMatchObject({
        toolCall: {
          result: "智能审批不同意执行该操作",
          approval: { verdict: "deny" }
        }
      });
    expect(events.at(-1)).toMatchObject({ type: "run_end", status: "aborted" });
  });

  it("智能审批自动同意未命中危险规则的 direct shell", async () => {
    const project = await store.createProject({ name: "tmp", path: dir });
    const { runner } = runnerWith(store, secrets, [{ text: "完成" }]);
    const stream = runner.stream({
      prompt: "/shell echo hi; echo bye",
      projectId: project.id,
      accessMode: "smart_approval"
    });
    const transitions: string[] = [];

    for (;;) {
      const next = await stream.next();
      if (next.done) {
        break;
      }
      if (next.value.type !== "tool_call") {
        continue;
      }
      transitions.push(next.value.toolCall.status);
      if (next.value.toolCall.status === "completed") {
        expect(next.value.toolCall.approval).toMatchObject({
          source: "rule",
          verdict: "allow"
        });
        expect(next.value.toolCall.result).toContain("hi");
        break;
      }
    }

    for await (const event of stream) {
      if (event.type === "tool_call") {
        transitions.push(event.toolCall.status);
      }
    }

    expect(transitions).toEqual([
      "pending_smart_approval",
      "running",
      "completed"
    ]);
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

  it("passes native image attachments to multimodal models and persists them in history payload", async () => {
    const timestamp = nowIso();
    const kimiApiKeyRef = await secrets.setSecret("kimi", "test-kimi-key");
    await store.upsertProvider({
      id: "kimi",
      kind: "kimi",
      name: "Kimi",
      baseURL: "https://api.moonshot.ai/v1",
      model: "kimi-k2.6",
      apiKeyRef: kimiApiKeyRef,
      createdAt: timestamp,
      updatedAt: timestamp
    });
    const { runner, calls } = runnerWith(store, secrets, [{ text: "图里有文字" }]);
    let sessionId: string | undefined;

    for await (const event of runner.stream({
      prompt: "识别这张图",
      displayContent: "识别这张图",
      displayAttachments: [
        {
          id: "visible_attachment_1",
          name: "sample.png",
          kind: "image",
          mimeType: "image/png",
          size: 67,
          path: "/tmp/cxb/sample.png"
        }
      ],
      projectId: null,
      providerId: "kimi",
      model: "kimi-k2.6",
      accessMode: "approval",
      attachments: [
        {
          id: "attachment_1",
          name: "sample.png",
          mimeType: "image/png",
          dataBase64: "iVBORw0KGgo=",
          size: 67
        }
      ]
    })) {
      if (event.type === "run_started") {
        sessionId = event.sessionId;
      }
    }

    expect(calls[0].model.input).toEqual(["text", "image"]);
    const userContext = calls[0].context.messages.find((message) => message.role === "user");
    expect(userContext?.content).toEqual([
      { type: "text", text: "识别这张图" },
      { type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" }
    ]);
    const userMessage = (await store.listMessages(sessionId!)).find(
      (message) => message.role === "user"
    );
    expect(userMessage?.content).toBe("识别这张图");
    expect(userMessage?.attachments?.[0]).toMatchObject({
      id: "visible_attachment_1",
      name: "sample.png",
      kind: "image"
    });
    expect(JSON.parse(userMessage!.payload!)).toMatchObject({
      role: "user",
      content: [{ type: "text" }, { type: "image", mimeType: "image/png" }]
    });
  });

  it("keeps OCR text in the model prompt while persisting the visible attachment message", async () => {
    const { runner, calls } = runnerWith(store, secrets, [{ text: "这是一张截图" }]);
    let userEvent: Extract<StreamEvent, { type: "message" }> | undefined;
    let sessionId: string | undefined;

    for await (const event of runner.stream({
      prompt: "以下是文件 screenshot.png 的内容：\n```\nOCR 识别文字\n```\n\n这个图片展示了什么？",
      displayContent: "这个图片展示了什么？",
      displayAttachments: [
        {
          id: "visible_attachment_ocr",
          name: "screenshot.png",
          kind: "image",
          mimeType: "image/png",
          size: 128,
          path: "/tmp/cxb/screenshot.png"
        }
      ],
      projectId: null,
      accessMode: "approval"
    })) {
      if (event.type === "run_started") {
        sessionId = event.sessionId;
      }
      if (event.type === "message" && event.message.role === "user") {
        userEvent = event;
      }
    }

    const userContext = calls[0].context.messages.find((message) => message.role === "user");
    expect(userContext?.content).toContain("OCR 识别文字");
    expect(userEvent?.message.content).toBe("这个图片展示了什么？");
    expect(userEvent?.message.attachments?.[0]).toMatchObject({
      name: "screenshot.png",
      kind: "image"
    });
    const persisted = (await store.listMessages(sessionId!)).find(
      (message) => message.role === "user"
    );
    expect(persisted?.content).toBe("这个图片展示了什么？");
    expect(persisted?.attachments?.[0]?.path).toBe("/tmp/cxb/screenshot.png");
    expect(JSON.parse(persisted!.payload!)).toMatchObject({
      role: "user",
      content: "以下是文件 screenshot.png 的内容：\n```\nOCR 识别文字\n```\n\n这个图片展示了什么？"
    });
  });

  it("titles new sessions with the AI summary and streams session_updated mid-run", async () => {
    const titleScripted = scriptedStreamFn([{ text: "「修复登录报错」" }]);
    const { runner } = runnerWith(
      store,
      secrets,
      [{ text: "好的" }, { text: "继续" }],
      { titleStreamFn: titleScripted.streamFn }
    );
    const events: StreamEvent[] = [];
    let sessionId: string | undefined;

    for await (const event of runner.stream({
      prompt: "帮我修复一下登录页面报错的问题，控制台提示 401",
      projectId: null,
      accessMode: "approval"
    })) {
      events.push(event);
      if (event.type === "run_started") {
        sessionId = event.sessionId;
      }
    }

    // The title is pushed into the run's stream so the sidebar can update
    // without waiting for the post-run session refetch.
    const titleEvent = events.find((event) => event.type === "session_updated");
    expect(titleEvent).toMatchObject({
      type: "session_updated",
      session: { id: sessionId, title: "修复登录报错" }
    });
    await expect(store.getSession(sessionId!)).resolves.toMatchObject({
      title: "修复登录报错"
    });
    expect(titleScripted.calls).toHaveLength(1);

    // Follow-up runs on an already-titled session must not retitle it.
    for await (const event of runner.stream({
      prompt: "继续",
      sessionId,
      projectId: null,
      accessMode: "approval"
    })) {
      void event;
    }
    expect(titleScripted.calls).toHaveLength(1);
    await expect(store.getSession(sessionId!)).resolves.toMatchObject({
      title: "修复登录报错"
    });
  });

  it("uses the first user message as fallback title when title generation fails", async () => {
    const titleScripted = scriptedStreamFn([{ error: "标题模型不可用" }]);
    const { runner } = runnerWith(store, secrets, [{ text: "好的" }, { text: "继续" }], {
      titleStreamFn: titleScripted.streamFn
    });
    let sessionId: string | undefined;

    for await (const event of runner.stream({
      prompt: "登录页面报错了，帮我看看",
      projectId: null,
      accessMode: "approval"
    })) {
      if (event.type === "run_started") {
        sessionId = event.sessionId;
      }
    }
    await expect(store.getSession(sessionId!)).resolves.toMatchObject({
      title: "登录页面报错了，帮我看看"
    });

    // 已经写入兜底标题后，后续运行不再重复调用标题模型。
    for await (const event of runner.stream({
      prompt: "继续",
      sessionId,
      projectId: null,
      accessMode: "approval"
    })) {
      void event;
    }
    expect(titleScripted.calls).toHaveLength(1);
    await expect(store.getSession(sessionId!)).resolves.toMatchObject({
      title: "登录页面报错了，帮我看看"
    });
  });

  it("配置 memoryDir 后注册 memory 工具并在系统提示注入记忆快照", async () => {
    const memoryDir = join(dir, "memories");
    await mkdir(memoryDir, { recursive: true });
    await writeFile(join(memoryDir, "user.md"), "用户喜欢简洁回复\n");
    const { runner } = runnerWith(store, secrets, [{ text: "完成" }], { memoryDir });
    const session = await store.createSession({
      projectId: null,
      title: "记忆测试",
      providerId: "deepseek",
      accessMode: "approval"
    });

    const debug = await runner.buildSessionDebugContext(session.id);
    expect(debug?.availableTools.some((tool) => tool.name === "memory")).toBe(true);
    expect(debug?.systemPrompt).toContain("## 长期记忆");
    expect(debug?.systemPrompt).toContain("/memories/user.md");

    // 未配置 memoryDir 时两者都不出现。
    const { runner: plain } = runnerWith(store, secrets, [{ text: "完成" }]);
    const plainDebug = await plain.buildSessionDebugContext(session.id);
    expect(plainDebug?.availableTools.some((tool) => tool.name === "memory")).toBe(false);
    expect(plainDebug?.systemPrompt).not.toContain("长期记忆");
  });

  it("retitles sessions still on the placeholder from their first user message", async () => {
    const session = await store.createSession({
      projectId: null,
      title: "新对话",
      providerId: "deepseek",
      accessMode: "approval"
    });
    await store.addMessage({
      sessionId: session.id,
      role: "user",
      content: "帮我写一个周报模板"
    });
    const titleScripted = scriptedStreamFn([{ text: "周报模板" }]);
    const { runner } = runnerWith(store, secrets, [{ text: "好的" }], {
      titleStreamFn: titleScripted.streamFn
    });

    for await (const event of runner.stream({
      prompt: "继续",
      sessionId: session.id,
      projectId: null,
      accessMode: "approval"
    })) {
      void event;
    }

    // The retry titles from the session's first user message, not "继续".
    expect(titleScripted.calls).toHaveLength(1);
    expect(titleScripted.calls[0].context.messages[0]?.content).toBe("帮我写一个周报模板");
    await expect(store.getSession(session.id)).resolves.toMatchObject({ title: "周报模板" });
  });

  it("pushes a reasoning-only message before the tool calls it preceded", async () => {
    const { runner } = runnerWith(store, secrets, [
      {
        thinking: "先想清楚要列哪个目录",
        toolCalls: [{ id: "call_1", name: "list_directory", arguments: { path: "." } }]
      },
      { text: "目录已列出" }
    ]);
    const events: StreamEvent[] = [];

    for await (const event of runner.stream({
      prompt: "看看目录",
      projectId: null,
      accessMode: "full_access"
    })) {
      events.push(event);
    }

    const reasoningOnlyIndex = events.findIndex(
      (event) =>
        event.type === "message" &&
        event.message.role === "assistant" &&
        event.message.content === ""
    );
    const firstToolIndex = events.findIndex((event) => event.type === "tool_call");
    expect(reasoningOnlyIndex).toBeGreaterThanOrEqual(0);
    expect(firstToolIndex).toBeGreaterThan(reasoningOnlyIndex);
    const reasoningOnly = events[reasoningOnlyIndex];
    if (reasoningOnly.type === "message") {
      expect(reasoningOnly.message.reasoning).toBe("先想清楚要列哪个目录");
    }
    expect(events.at(-1)).toMatchObject({ type: "run_end", status: "completed" });
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

  it("resolves reasoningMode with run > session > provider priority", async () => {
    const saved = await store.getProvider("deepseek");
    await store.upsertProvider({ ...saved!, reasoningMode: "high" });
    const { runner, calls } = runnerWith(store, secrets, [
      { text: "provider" },
      { text: "session" },
      { text: "run" }
    ]);

    const providerEvents: StreamEvent[] = [];
    for await (const event of runner.stream({
      prompt: "provider 默认",
      projectId: null,
      accessMode: "approval"
    })) {
      providerEvents.push(event);
    }
    expect(providerEvents.find((event) => event.type === "run_started")).toMatchObject({
      type: "run_started",
      reasoningMode: "high"
    });
    expect(capturedReasoning(calls[0].options)).toBe("high");

    const session = await store.createSession({
      projectId: null,
      title: "会话推理",
      providerId: "deepseek",
      accessMode: "approval",
      reasoningMode: "xhigh"
    });
    const sessionEvents: StreamEvent[] = [];
    for await (const event of runner.stream({
      sessionId: session.id,
      prompt: "session 记忆",
      projectId: null,
      accessMode: "approval"
    })) {
      sessionEvents.push(event);
    }
    expect(sessionEvents.find((event) => event.type === "run_started")).toMatchObject({
      type: "run_started",
      reasoningMode: "xhigh"
    });
    expect(capturedReasoning(calls[1].options)).toBe("xhigh");

    const runEvents: StreamEvent[] = [];
    for await (const event of runner.stream({
      sessionId: session.id,
      prompt: "run 覆盖",
      projectId: null,
      accessMode: "approval",
      model: "deepseek-v4-pro",
      reasoningMode: "off"
    })) {
      runEvents.push(event);
    }
    expect(runEvents.find((event) => event.type === "run_started")).toMatchObject({
      type: "run_started",
      model: "deepseek-v4-pro",
      reasoningMode: "off"
    });
    expect(calls[2].model).toMatchObject({ id: "deepseek-v4-pro", reasoning: true });
    expect(capturedReasoning(calls[2].options)).toBeUndefined();
    await expect(store.getSession(session.id)).resolves.toMatchObject({
      model: "deepseek-v4-pro",
      reasoningMode: "off"
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

  it("reports the persisted total session cost in context usage", async () => {
    const { runner } = runnerWith(store, secrets, []);
    const session = await store.createSession({
      projectId: null,
      title: "费用汇总",
      providerId: "deepseek",
      accessMode: "approval"
    });
    await store.createRun({ id: "run_cost_1", sessionId: session.id, status: "running" });
    await store.updateRunStatus("run_cost_1", "completed", {
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      costUsd: 0.0015
    });
    await store.createRun({ id: "run_cost_2", sessionId: session.id, status: "running" });
    await store.updateRunStatus("run_cost_2", "completed", {
      promptTokens: 200,
      completionTokens: 80,
      totalTokens: 280,
      costUsd: 0.0028
    });

    const usage = await runner.buildSessionContextUsage(session.id);

    expect(usage?.sessionCostCny).toBe(0.03);
  });

  it("estimates missing usage for failed runs in context usage", async () => {
    const { runner } = runnerWith(store, secrets, []);
    const session = await store.createSession({
      projectId: null,
      title: "失败费用估算",
      providerId: "deepseek",
      accessMode: "approval",
      model: "deepseek-v4-pro"
    });
    await store.addMessage({
      sessionId: session.id,
      role: "user",
      content: "请分析这段很长的上下文".repeat(2000)
    });
    await store.createRun({ id: "run_failed_cost", sessionId: session.id, status: "running" });
    await store.updateRunStatus("run_failed_cost", "failed", undefined, "429 rate limit");

    const usage = await runner.buildSessionContextUsage(session.id);

    expect(usage?.sessionCostCny).toBeGreaterThan(0);
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

  it("spills oversized direct tool results before storing them as model context", async () => {
    const project = await store.createProject({ name: "project", path: dir });
    const largeText = `DIRECT_START\n${"C".repeat(30_000)}\nDIRECT_MIDDLE\n${"D".repeat(30_000)}\nDIRECT_END`;
    await writeFile(join(dir, "large.txt"), largeText, "utf8");
    const { runner, calls } = runnerWith(store, secrets, [{ text: "已处理大输出" }]);
    const events: StreamEvent[] = [];

    for await (const event of runner.stream({
      prompt: "/read large.txt",
      projectId: project.id,
      accessMode: "full_access"
    })) {
      events.push(event);
    }

    const started = events.find((event) => event.type === "run_started");
    const completed = events.find(
      (event) => event.type === "tool_call" && event.toolCall.status === "completed"
    );
    const runId = started?.type === "run_started" ? started.runId : "";
    const summary = completed?.type === "tool_call" ? completed.toolCall.result ?? "" : "";

    expect(summary).toContain("结果过长，已写入文件");
    expect(summary).toContain(`${TOOL_RESULT_SPILL_DIR}/${runId}/`);
    expect(summary).toContain("DIRECT_START");
    expect(summary).toContain("DIRECT_END");
    expect(summary).not.toContain("DIRECT_MIDDLE");

    const messages = await store.listMessages(
      started?.type === "run_started" ? started.sessionId : ""
    );
    const toolMessage = messages.find((message) => message.role === "tool");
    expect(toolMessage?.content).toContain("结果过长，已写入文件");
    expect(toolMessage?.content).not.toContain("DIRECT_MIDDLE");
    expect(
      calls[0].context.messages
        .map((message) => ("content" in message ? JSON.stringify(message.content) : ""))
        .join("\n")
    ).not.toContain("DIRECT_MIDDLE");
    await expect(
      readFile(
        join(
          dir,
          TOOL_RESULT_SPILL_DIR,
          runId,
          `${completed?.type === "tool_call" ? completed.toolCall.id : ""}-read_file.txt`
        ),
        "utf8"
      )
    ).resolves.toBe(largeText);
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
      // 消费完整事件流
    }

    const userContents = calls[0].context.messages
      .filter((message) => message.role === "user")
      .map((message) => message.content);
    expect(userContents).toContain("请 review src/index.ts");
  });

  it("keeps office generation out of the model tool list", async () => {
    const { runner, calls } = runnerWith(store, secrets, [{ text: "先说明" }]);

    for await (const _event of runner.stream({
      prompt: "帮我做一个 PPT",
      projectId: null,
      accessMode: "approval"
    })) {
      // 消费完整事件流
    }

    expect(toolNames(calls[0])).not.toContain("create_pptx");
    expect(toolNames(calls[0])).not.toContain("create_docx");
    expect(toolNames(calls[0])).not.toContain("create_xlsx");
    expect(toolNames(calls[0])).toContain("use_skill");
  });

  it("loads skill instructions without adding office tools to the next turn", async () => {
    const { runner, calls } = runnerWith(store, secrets, [
      {
        toolCalls: [{ id: "call_skill", name: "use_skill", arguments: { name: "ppt" } }]
      },
      { text: "可以开始做 PPT" }
    ], {
      slashCommandService: builtinSkillSlashService(join(dir, "global"))
    });

    for await (const _event of runner.stream({
      prompt: "帮我做一个 PPT",
      projectId: null,
      accessMode: "approval"
    })) {
      // 消费完整事件流
    }

    expect(toolNames(calls[0])).not.toContain("create_pptx");
    expect(toolNames(calls[1])).not.toContain("create_pptx");
    expect(toolNames(calls[1])).not.toContain("create_docx");
    expect(toolNames(calls[1])).not.toContain("create_xlsx");
  });

  it("allows a loaded skill to read resources from its absolute skill directory", async () => {
    const projectPath = join(dir, "project");
    const globalRoot = join(dir, "global");
    const skillDir = join(globalRoot, "skills", "daily-report");
    const resourcePath = join(skillDir, "scripts", "template.md");
    await mkdir(projectPath, { recursive: true });
    await mkdir(join(skillDir, "scripts"), { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      "---\nname: daily-report\ndescription: 生成日报\n---\n请读取 scripts/template.md 获取日报模板。",
      "utf8"
    );
    await writeFile(resourcePath, "日报模板内容", "utf8");
    const project = await store.createProject({ name: "project", path: projectPath });
    const { runner } = runnerWith(store, secrets, [
      {
        toolCalls: [{ id: "call_skill", name: "use_skill", arguments: { name: "daily-report" } }]
      },
      {
        toolCalls: [{ id: "call_read", name: "read_file", arguments: { path: resourcePath } }]
      },
      { text: "已读取日报技能模板" }
    ], {
      slashCommandService: new SlashCommandService(globalRoot, join(dir, "builtin"))
    });
    const events: StreamEvent[] = [];

    for await (const event of runner.stream({
      prompt: "按日报技能生成日报",
      projectId: project.id,
      accessMode: "approval"
    })) {
      events.push(event);
    }

    const completedRead = events.find(
      (event) =>
        event.type === "tool_call" &&
        event.toolCall.name === "read_file" &&
        event.toolCall.status === "completed"
    );
    expect(completedRead?.type).toBe("tool_call");
    if (completedRead?.type === "tool_call") {
      expect(completedRead.toolCall.result).toContain("日报模板内容");
    }
    expect(events.at(-1)).toMatchObject({ type: "run_end", status: "completed" });
  });

  it("allows model-requested writes to absolute skill resource paths after approval", async () => {
    const projectPath = join(dir, "project-write");
    const outsideDir = await mkdtemp(join(tmpdir(), "cxb-agent-skill-write-"));
    const outsideFile = join(outsideDir, "generated.md");
    await mkdir(projectPath, { recursive: true });
    const project = await store.createProject({ name: "project-write", path: projectPath });
    const { runner } = runnerWith(store, secrets, [
      {
        toolCalls: [
          {
            id: "call_write",
            name: "write_file",
            arguments: { path: outsideFile, content: "技能生成内容" }
          }
        ]
      },
      { text: "已写入" }
    ]);
    const transitions: string[] = [];

    try {
      for await (const event of runner.stream({
        prompt: "把技能资源写到指定绝对路径",
        projectId: project.id,
        accessMode: "approval"
      })) {
        if (event.type === "tool_call") {
          transitions.push(event.toolCall.status);
          if (event.toolCall.status === "pending_approval") {
            runner.approvals.decide(event.toolCall.id, { approved: true });
          }
        }
      }

      expect(transitions).toEqual(["pending_approval", "running", "completed"]);
      await expect(readFile(outsideFile, "utf8")).resolves.toBe("技能生成内容");
    } finally {
      await rm(outsideDir, { recursive: true, force: true });
    }
  });

  it("expands slash skills into script instructions on the first model turn", async () => {
    const { runner, calls } = runnerWith(store, secrets, [{ text: "可以生成" }], {
      slashCommandService: builtinSkillSlashService(join(dir, "global"))
    });

    for await (const _event of runner.stream({
      prompt: "/ppt 做一个产品路线图",
      projectId: null,
      accessMode: "approval"
    })) {
      // 消费完整事件流
    }

    const userContents = calls[0].context.messages
      .filter((message) => message.role === "user")
      .map((message) => message.content)
      .join("\n");
    expect(userContents).toContain("scripts/create-pptx.mjs");
    expect(userContents).not.toContain("create_pptx");
    expect(toolNames(calls[0])).not.toContain("create_pptx");
    expect(toolNames(calls[0])).not.toContain("create_docx");
    expect(toolNames(calls[0])).not.toContain("create_xlsx");
  });

  it("hides ask_user from headless runs but keeps it for interactive ones", async () => {
    const { runner, calls } = runnerWith(store, secrets, [{ text: "好" }, { text: "好" }]);

    for await (const _event of runner.stream(
      { prompt: "执行定时任务", projectId: null, accessMode: "approval" },
      { headless: true }
    )) {
      // 消费完整事件流
    }
    const headlessTools = calls[0].context.tools?.map((tool) => tool.name) ?? [];
    expect(headlessTools).not.toContain("ask_user");
    expect(headlessTools).not.toContain("todo_create");
    expect(headlessTools).not.toContain("todo_update");
    // 定时任务工具对所有 run 可见（含 headless，模型可在执行中管理任务）。
    expect(headlessTools).toContain("schedule_create");
    expect(headlessTools).toContain("schedule_create_once");

    for await (const _event of runner.stream({
      prompt: "普通对话",
      projectId: null,
      accessMode: "approval"
    })) {
      // 消费完整事件流
    }
    const interactiveTools = calls[1].context.tools?.map((tool) => tool.name) ?? [];
    expect(interactiveTools).toContain("ask_user");
    expect(interactiveTools).toContain("todo_create");
    expect(interactiveTools).toContain("todo_update");
    expect(interactiveTools).toContain("schedule_create");
    expect(interactiveTools).toContain("schedule_create_once");
  });

  it("auto-compacts long session context before the model loop", async () => {
    const session = await store.createSession({
      projectId: null,
      title: "长上下文",
      providerId: "deepseek",
      accessMode: "approval"
    });
    for (let index = 0; index < 6; index += 1) {
      await store.addMessage({
        sessionId: session.id,
        role: index % 2 === 0 ? "user" : "assistant",
        content: `第 ${index} 段\n${"你".repeat(150_000)}`
      });
    }
    const { runner, calls } = runnerWith(store, secrets, [
      {
        text: "这是压缩摘要",
        usage: {
          input: 10,
          output: 5,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 15,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.01 }
        }
      },
      {
        text: "继续回答",
        usage: {
          input: 20,
          output: 10,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 30,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.02 }
        }
      }
    ]);
    const events: StreamEvent[] = [];

    for await (const event of runner.stream({
      prompt: "继续",
      sessionId: session.id,
      projectId: null,
      accessMode: "approval"
    })) {
      events.push(event);
    }

    expect(calls).toHaveLength(2);
    expect(calls[0].context.systemPrompt).toContain("对话压缩器");
    expect(calls[1].context.messages[0]?.role).toBe("user");
    expect(String(calls[1].context.messages[0]?.content)).toContain("【此前对话的摘要】");
    expect(
      events.some(
        (event) =>
          event.type === "message" && event.message.kind === "compaction_summary"
      )
    ).toBe(true);
    const end = events.filter((event) => event.type === "run_end").at(-1);
    expect(end?.type === "run_end" ? end.usage?.costUsd : undefined).toBeCloseTo(0.03);
    expect((await store.listRuns(session.id)).at(-1)?.usage?.costUsd).toBeCloseTo(0.03);
    await expect(store.getSession(session.id)).resolves.toMatchObject({
      compactedUpToMessageId: expect.any(String)
    });
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

function capturedReasoning(options: unknown): string | undefined {
  return (options as { reasoning?: string } | undefined)?.reasoning;
}

function toolNames(call: { context: { tools?: Array<{ name: string }> } }): string[] {
  return call.context.tools?.map((tool) => tool.name) ?? [];
}
