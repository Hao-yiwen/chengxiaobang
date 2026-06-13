import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  deriveTodoState,
  nowIso,
  type ProviderConfig,
  type StreamEvent
} from "@chengxiaobang/shared";
import { AgentRunner } from "../src/agent/agent-runner";
import { TOOL_RESULT_SPILL_DIR } from "../src/agent/tool-result-spill";
import { SqliteStateStore } from "../src/repository/sqlite-state-store";
import { MemorySecretStore } from "../src/secrets/secret-store";
import { createShellTools } from "../src/tools/shell-tools";
import { scriptedStreamFn, type ScriptedTurn } from "./helpers/scripted-stream";

async function drain(stream: AsyncGenerator<StreamEvent>): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}

describe("AgentRunner agentic loop (pi)", () => {
  let dir: string;
  let store: SqliteStateStore;
  let secrets: MemorySecretStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "cxb-loop-"));
    store = new SqliteStateStore(join(dir, "state.sqlite"));
    await store.initialize();
    secrets = new MemorySecretStore();
    const apiKeyRef = await secrets.setSecret("deepseek", "test-key");
    const provider: ProviderConfig = {
      id: "deepseek",
      kind: "deepseek",
      name: "DeepSeek",
      baseURL: "https://api.deepseek.com",
      model: "deepseek-v4-flash",
      apiKeyRef,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    await store.upsertProvider(provider);
  });

  afterEach(async () => {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  });

  function runnerWith(turns: ScriptedTurn[]) {
    const scripted = scriptedStreamFn(turns);
    const runner = new AgentRunner(store, secrets, { streamFn: scripted.streamFn });
    return { runner, calls: scripted.calls };
  }

  it("emits the golden event sequence for a thinking + tool + answer run", async () => {
    const project = await store.createProject({ name: "proj", path: dir });
    const { runner } = runnerWith([
      {
        thinking: "先看看目录",
        text: "我先列一下目录。",
        toolCalls: [{ id: "call_1", name: "list_directory", arguments: {} }]
      },
      {
        text: "目录已经看完。",
        usage: { input: 6, cacheRead: 4, output: 5, totalTokens: 15 }
      }
    ]);

    const events = await drain(
      runner.stream({ prompt: "看看目录", projectId: project.id, accessMode: "full_access" })
    );

    const compact = events.map((event) =>
      event.type === "delta"
        ? `delta:${event.channel}`
        : event.type === "tool_call"
          ? `tool_call:${event.toolCall.status}`
          : event.type === "message"
            ? `message:${event.message.role}`
            : event.type === "run_end"
              ? `run_end:${event.status}`
              : event.type
    );
    expect(compact).toEqual([
      "run_started",
      "message:user",
      "delta:thinking",
      "delta:text",
      "tool_activity",
      "message:assistant",
      "tool_call:running",
      "tool_call:completed",
      "delta:text",
      "message:assistant",
      "run_end:completed"
    ]);
    // pi usage (input net of cache) maps back to full prompt + cached share.
    const end = events.at(-1);
    expect(end?.type === "run_end" && end.usage).toEqual({
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
      cachedPromptTokens: 4
    });
  });

  it("executes a model-requested tool then produces a final answer", async () => {
    const project = await store.createProject({ name: "proj", path: dir });
    const { runner, calls } = runnerWith([
      {
        toolCalls: [
          { id: "call_1", name: "write_file", arguments: { path: "out.txt", content: "done" } }
        ]
      },
      { text: "已经写好文件。", usage: { input: 10, output: 5, totalTokens: 15 } }
    ]);

    const events = await drain(
      runner.stream({ prompt: "把内容写入 out.txt", projectId: project.id, accessMode: "full_access" })
    );

    expect(
      events.filter((event) => event.type === "tool_call").map((event) => event.toolCall.status)
    ).toEqual(["running", "completed"]);
    expect(events.at(-1)).toMatchObject({ type: "run_end", status: "completed" });
    await expect(readFile(join(dir, "out.txt"), "utf8")).resolves.toBe("done");

    // 第二次模型调用应看到无损的 toolCall/toolResult 配对。
    const replay = calls[1].context.messages;
    const assistant = replay.find(
      (message) =>
        message.role === "assistant" &&
        message.content.some((block) => block.type === "toolCall" && block.id === "call_1")
    );
    const toolResult = replay.find(
      (message) => message.role === "toolResult" && message.toolCallId === "call_1"
    );
    expect(assistant).toBeDefined();
    expect(toolResult).toMatchObject({ isError: false });
  });

  it("keeps repeated provider tool ids unique across runs", async () => {
    const project = await store.createProject({ name: "proj", path: dir });
    const { runner } = runnerWith([
      {
        toolCalls: [
          { id: "list_directory_0", name: "list_directory", arguments: { path: "." } }
        ]
      },
      { text: "第一轮完成。" },
      {
        toolCalls: [
          { id: "list_directory_0", name: "list_directory", arguments: { path: "." } }
        ]
      },
      { text: "第二轮完成。" }
    ]);

    const firstEvents = await drain(
      runner.stream({ prompt: "先看目录", projectId: project.id, accessMode: "full_access" })
    );
    const sessionId = firstEvents.find((event) => event.type === "run_started")?.sessionId;
    const firstRunId = firstEvents.find((event) => event.type === "run_started")?.runId;
    expect(sessionId).toBeDefined();
    expect(firstRunId).toBeDefined();
    const secondEvents = await drain(
      runner.stream({
        prompt: "再看一次目录",
        sessionId: sessionId!,
        projectId: project.id,
        accessMode: "full_access"
      })
    );
    const secondRunId = secondEvents.find((event) => event.type === "run_started")?.runId;
    expect(secondRunId).toBeDefined();

    expect(firstEvents.at(-1)).toMatchObject({ type: "run_end", status: "completed" });
    expect(secondEvents.at(-1)).toMatchObject({ type: "run_end", status: "completed" });
    const calls = (await store.listToolCallsForSession(sessionId!)).filter(
      (toolCall) => toolCall.name === "list_directory"
    );
    expect(calls).toHaveLength(2);
    expect(new Set(calls.map((toolCall) => toolCall.id)).size).toBe(2);
    expect(calls.map((toolCall) => toolCall.runId).sort()).toEqual(
      [firstRunId!, secondRunId!].sort()
    );
    expect(calls.every((toolCall) => toolCall.id.startsWith(`${toolCall.runId}:tool_`))).toBe(
      true
    );
  });

  it("routes ask_user answers through app tool ids while preserving model ids", async () => {
    const project = await store.createProject({ name: "proj", path: dir });
    const { runner, calls } = runnerWith([
      {
        toolCalls: [
          {
            id: "ask_0",
            name: "ask_user",
            arguments: { questions: [{ question: "要继续分析吗？" }] }
          }
        ]
      },
      { text: "继续分析。" }
    ]);
    const events: StreamEvent[] = [];

    for await (const event of runner.stream({
      prompt: "先问我",
      projectId: project.id,
      accessMode: "full_access"
    })) {
      events.push(event);
      if (event.type === "tool_call" && event.toolCall.status === "pending_approval") {
        runner.approvals.decide(event.toolCall.id, {
          approved: true,
          answer: { answers: [{ question: "要继续分析吗？", text: "继续分析" }] }
        });
      }
    }

    expect(events.at(-1)).toMatchObject({ type: "run_end", status: "completed" });
    const replayToolResult = calls[1].context.messages.find(
      (message) => message.role === "toolResult" && message.toolCallId === "ask_0"
    );
    expect(replayToolResult).toMatchObject({ isError: false });
    expect(JSON.stringify(replayToolResult?.content)).toContain("继续分析");
  });

  it("计划确认后同一 run 恢复普通工具且不暴露 update_plan", async () => {
    const project = await store.createProject({ name: "proj", path: dir });
    const { runner, calls } = runnerWith([
      {
        toolCalls: [
          {
            id: "plan_0",
            name: "propose_plan",
            arguments: {
              markdown:
                "# 示例计划\n\n## Summary\n先确认计划。\n\n## Key Changes\n- 写入文件。\n\n## Test Plan\n- 读取文件。\n\n## Assumptions\n- 使用当前项目。"
            }
          }
        ]
      },
      {
        toolCalls: [
          {
            id: "write_0",
            name: "write_file",
            arguments: { path: "plan.txt", content: "done" }
          }
        ]
      },
      { text: "已按计划完成。" }
    ]);

    const events: StreamEvent[] = [];
    for await (const event of runner.stream({
      prompt: "先出计划再做",
      projectId: project.id,
      accessMode: "full_access",
      planMode: true
    })) {
      events.push(event);
      if (event.type === "tool_call" && event.toolCall.status === "pending_approval") {
        runner.approvals.decide(event.toolCall.id, { approved: true });
      }
    }

    const secondCall = calls[1];
    expect(secondCall).toBeDefined();
    const secondTurnTools = secondCall.context.tools?.map((tool) => tool.name) ?? [];
    expect(secondTurnTools).toContain("write_file");
    expect(secondTurnTools).not.toContain("propose_plan");
    expect(secondTurnTools).not.toContain("update_plan");
    expect(events.at(-1)).toMatchObject({ type: "run_end", status: "completed" });
    await expect(readFile(join(dir, "plan.txt"), "utf8")).resolves.toBe("done");
  });

	  it("records todo progress as non-approval tool calls", async () => {
	    const project = await store.createProject({ name: "proj", path: dir });
    const { runner } = runnerWith([
      {
        toolCalls: [
          {
            id: "todo_1",
            name: "todo_create",
            arguments: {
              title: "实现进度面板",
              items: [
                { id: "s1", title: "新增契约" },
                { id: "s2", title: "接入 UI" }
              ]
            }
          }
        ]
      },
      {
        toolCalls: [
          {
            id: "todo_2",
            name: "todo_update",
            arguments: { itemId: "s1", status: "completed", note: "契约完成" }
          }
        ]
      },
      { text: "todo 已更新。" }
    ]);

    const events = await drain(
      runner.stream({ prompt: "实现复杂功能", projectId: project.id, accessMode: "approval" })
    );
    const todoEvents = events.filter(
      (event) =>
        event.type === "tool_call" &&
        (event.toolCall.name === "todo_create" || event.toolCall.name === "todo_update")
    );

    expect(todoEvents.map((event) => (event.type === "tool_call" ? event.toolCall.status : ""))).toEqual([
      "running",
      "completed",
      "running",
      "completed"
    ]);
    expect(
      todoEvents.some(
        (event) => event.type === "tool_call" && event.toolCall.status === "pending_approval"
      )
    ).toBe(false);
    const sessionId = events.find((event) => event.type === "run_started")?.sessionId;
    const state = deriveTodoState(await store.listToolCallsForSession(sessionId ?? ""));
    expect(state).toMatchObject({
      title: "实现进度面板",
      latestNote: { itemId: "s1", note: "契约完成" }
    });
    expect(state!.items.map((item) => item.status)).toEqual(["completed", "pending"]);
  });

  it("spills oversized model-requested tool results before the next model turn", async () => {
    const project = await store.createProject({ name: "proj", path: dir });
    const largeText = `START\n${"A".repeat(30_000)}\nMIDDLE_UNIQUE\n${"B".repeat(30_000)}\nEND`;
    await writeFile(join(dir, "large.txt"), largeText, "utf8");
    const { runner, calls } = runnerWith([
      { toolCalls: [{ id: "call_1", name: "read_file", arguments: { path: "large.txt" } }] },
      { text: "已经按需查看摘要。" }
    ]);

    const events = await drain(
      runner.stream({ prompt: "读大文件", projectId: project.id, accessMode: "full_access" })
    );
    const started = events.find((event) => event.type === "run_started");
    const completed = events.find(
      (event) => event.type === "tool_call" && event.toolCall.status === "completed"
    );
    const summary = completed?.type === "tool_call" ? completed.toolCall.result ?? "" : "";
    const runId = started?.type === "run_started" ? started.runId : "";

    expect(summary).toContain("结果过长，已写入文件");
    expect(summary).toContain(`${TOOL_RESULT_SPILL_DIR}/${runId}/call_1-read_file.txt`);
    expect(summary).toContain("START");
    expect(summary).toContain("END");
    expect(summary).not.toContain("MIDDLE_UNIQUE");
    await expect(
      readFile(join(dir, TOOL_RESULT_SPILL_DIR, runId, "call_1-read_file.txt"), "utf8")
    ).resolves.toBe(largeText);

    const replayToolResult = calls[1].context.messages.find(
      (message) => message.role === "toolResult" && message.toolCallId === "call_1"
    );
    const replayText =
      replayToolResult?.role === "toolResult"
        ? replayToolResult.content
            .filter((block): block is { type: "text"; text: string } => block.type === "text")
            .map((block) => block.text)
            .join("\n")
        : "";
    expect(replayText).toContain("结果过长，已写入文件");
    expect(replayText).not.toContain("MIDDLE_UNIQUE");
  });

  it("returns slow model-requested shell commands as background output files", async () => {
    const project = await store.createProject({ name: "proj", path: dir });
    const scripted = scriptedStreamFn([
      {
        toolCalls: [
          {
            id: "call_shell",
            name: "shell",
            arguments: { command: "sleep 0.2; echo loop-background-done" }
          }
        ]
      },
      { text: "我会读取输出文件确认结果。" }
    ]);
    const runner = new AgentRunner(store, secrets, {
      streamFn: scripted.streamFn,
      createTools: (workspacePath) => createShellTools(workspacePath, { backgroundAfterMs: 50 })
    });
    const startedAt = Date.now();

    const events = await drain(
      runner.stream({ prompt: "执行慢命令", projectId: project.id, accessMode: "full_access" })
    );

    expect(Date.now() - startedAt).toBeLessThan(1_500);
    const completed = events.find(
      (event) => event.type === "tool_call" && event.toolCall.status === "completed"
    );
    const summary = completed?.type === "tool_call" ? completed.toolCall.result ?? "" : "";
    const outputPath = parseBackgroundOutputPath(summary);
    const replayToolResult = scripted.calls[1].context.messages.find(
      (message) => message.role === "toolResult" && message.toolCallId === "call_shell"
    );
    const replayText =
      replayToolResult?.role === "toolResult"
        ? replayToolResult.content
            .filter((block): block is { type: "text"; text: string } => block.type === "text")
            .map((block) => block.text)
            .join("\n")
        : "";

    expect(summary).toContain("已转入后台继续运行");
    expect(replayText).toContain("后台命令 ID");
    expect(replayText).toContain(outputPath);
    await waitForFileToContain(join(dir, outputPath), "loop-background-done");
  });

  it("starts model-requested shell commands in the background when requested", async () => {
    const project = await store.createProject({ name: "proj", path: dir });
    const scripted = scriptedStreamFn([
      {
        toolCalls: [
          {
            id: "call_shell_background",
            name: "shell",
            arguments: {
              command: "sleep 0.2; echo requested-background-done",
              background: true
            }
          }
        ]
      },
      { text: "后台命令已启动，我会查看输出文件。" }
    ]);
    const runner = new AgentRunner(store, secrets, {
      streamFn: scripted.streamFn
    });
    const startedAt = Date.now();

    const events = await drain(
      runner.stream({ prompt: "启动后台命令", projectId: project.id, accessMode: "full_access" })
    );

    expect(Date.now() - startedAt).toBeLessThan(1_500);
    const completed = events.find(
      (event) => event.type === "tool_call" && event.toolCall.status === "completed"
    );
    const summary = completed?.type === "tool_call" ? completed.toolCall.result ?? "" : "";
    const outputPath = parseBackgroundOutputPath(summary);

    expect(summary).toContain("background=true");
    expect(summary).toContain("后台命令 ID");
    await waitForFileToContain(join(dir, outputPath), "requested-background-done");
  });

  it("emits tool_activity while tool arguments stream and omits large content", async () => {
    const project = await store.createProject({ name: "proj", path: dir });
    const { runner } = runnerWith([
      {
        toolCalls: [
          {
            id: "call_1",
            name: "write_file",
            arguments: { path: "out.txt", content: "最终文件内容" },
            argumentDeltas: [
              { content: "正在生成的大段内容" },
              { path: "out.txt", content: "正在生成的大段内容" }
            ]
          }
        ]
      },
      { text: "已经写好文件。" }
    ]);

    const events = await drain(
      runner.stream({ prompt: "写文件", projectId: project.id, accessMode: "full_access" })
    );
    const activityIndex = events.findIndex(
      (event) =>
        event.type === "tool_activity" && event.activity.argsPreview.path === "out.txt"
    );
    const runningIndex = events.findIndex(
      (event) => event.type === "tool_call" && event.toolCall.status === "running"
    );
    const activity = events[activityIndex];

    expect(activityIndex).toBeGreaterThanOrEqual(0);
    expect(runningIndex).toBeGreaterThan(activityIndex);
    expect(activity?.type === "tool_activity" && activity.activity.name).toBe("write_file");
    expect(activity?.type === "tool_activity" && activity.activity.argsPreview).toEqual({
      path: "out.txt"
    });
    expect(
      activity?.type === "tool_activity" &&
        "content" in activity.activity.argsPreview
    ).toBe(false);
  });

  it("replays toolCall history losslessly in a later run of the same session", async () => {
    const project = await store.createProject({ name: "proj", path: dir });
    const { runner, calls } = runnerWith([
      {
        toolCalls: [
          { id: "call_1", name: "write_file", arguments: { path: "out.txt", content: "done" } }
        ]
      },
      { text: "第一轮完成。" },
      { text: "第二轮回答。" }
    ]);

    let sessionId: string | undefined;
    for await (const event of runner.stream({
      prompt: "写文件",
      projectId: project.id,
      accessMode: "full_access"
    })) {
      if (event.type === "run_started") {
        sessionId = event.sessionId;
      }
    }
    await drain(
      runner.stream({ sessionId, prompt: "接着说", projectId: project.id, accessMode: "full_access" })
    );

    // The third model call (new run) rebuilds history from payload rows.
    const replay = calls[2].context.messages;
    const assistant = replay.find(
      (message) =>
        message.role === "assistant" &&
        message.content.some((block) => block.type === "toolCall" && block.id === "call_1")
    );
    expect(assistant).toBeDefined();
    expect(
      replay.find((message) => message.role === "toolResult" && message.toolCallId === "call_1")
    ).toBeDefined();
  });

  it("waits for approval before running a model-requested sensitive tool", async () => {
    const project = await store.createProject({ name: "proj", path: dir });
    const { runner } = runnerWith([
      {
        toolCalls: [
          { id: "call_1", name: "write_file", arguments: { path: ".env", content: "TOKEN=x" } }
        ]
      },
      { text: "好的。" }
    ]);
    const stream = runner.stream({
      prompt: "写文件",
      projectId: project.id,
      accessMode: "approval"
    });

    const transitions: string[] = [];
    let pendingHadNoStart = false;
    let runningStartedAt: string | undefined;
    for await (const event of stream) {
      if (event.type === "tool_call") {
        transitions.push(event.toolCall.status);
        if (event.toolCall.status === "pending_approval") {
          pendingHadNoStart = event.toolCall.startedAt === undefined;
          runner.approvals.decide(event.toolCall.id, { approved: true });
        }
        if (event.toolCall.status === "running") {
          runningStartedAt = event.toolCall.startedAt;
        }
      }
    }
    expect(transitions).toEqual(["pending_approval", "running", "completed"]);
    expect(pendingHadNoStart).toBe(true);
    expect(runningStartedAt).toBeDefined();
    await expect(readFile(join(dir, ".env"), "utf8")).resolves.toBe("TOKEN=x");
  });

  it("feeds a rejection back to the model instead of aborting", async () => {
    const project = await store.createProject({ name: "proj", path: dir });
    const { runner, calls } = runnerWith([
      {
        toolCalls: [
          { id: "call_1", name: "write_file", arguments: { path: ".env", content: "TOKEN=x" } }
        ]
      },
      { text: "明白，那我先不写文件。" }
    ]);

    const events: StreamEvent[] = [];
    for await (const event of runner.stream({
      prompt: "写文件",
      projectId: project.id,
      accessMode: "approval"
    })) {
      events.push(event);
      if (event.type === "tool_call" && event.toolCall.status === "pending_approval") {
        runner.approvals.decide(event.toolCall.id, { approved: false });
      }
    }

    const rejected = events.find(
      (event) => event.type === "tool_call" && event.toolCall.status === "rejected"
    );
    expect(rejected?.type === "tool_call" && rejected.toolCall.result).toBe("用户拒绝执行该操作");
    // The run completes — the rejection became an error tool result the model saw.
    expect(events.at(-1)).toMatchObject({ type: "run_end", status: "completed" });
    const replayToolResult = calls[1].context.messages.find(
      (message) => message.role === "toolResult" && message.toolCallId === "call_1"
    );
    expect(replayToolResult).toMatchObject({ isError: true });
    expect(
      replayToolResult?.role === "toolResult" &&
        replayToolResult.content.some(
          (block) => block.type === "text" && block.text.includes("用户拒绝执行该操作")
        )
    ).toBe(true);
  });

  it("feeds tool failures back to the model instead of aborting", async () => {
    const project = await store.createProject({ name: "proj", path: dir });
    const { runner, calls } = runnerWith([
      { toolCalls: [{ id: "call_1", name: "read_file", arguments: { path: "missing.txt" } }] },
      { text: "文件不存在，已说明。" }
    ]);

    const events = await drain(
      runner.stream({ prompt: "读文件", projectId: project.id, accessMode: "full_access" })
    );

    const failed = events.find(
      (event) => event.type === "tool_call" && event.toolCall.status === "failed"
    );
    expect(failed).toBeDefined();
    // The run still completes because the failure is handed back to the model.
    expect(events.at(-1)).toMatchObject({ type: "run_end", status: "completed" });
    expect(
      calls[1].context.messages.find(
        (message) => message.role === "toolResult" && message.toolCallId === "call_1"
      )
    ).toMatchObject({ isError: true });
  });

  it("persists the partial answer when a run aborts mid-stream", async () => {
    let runId: string | undefined;
    const abortSelf = () => {
      expect(runId).toBeDefined();
      runner.abort(runId!);
    };
    const scripted = scriptedStreamFn([
      { text: "写到一半的回答", abort: true, onStart: () => abortSelf() }
    ]);
    const runner = new AgentRunner(store, secrets, { streamFn: scripted.streamFn });

    const events: StreamEvent[] = [];
    let sessionId: string | undefined;
    for await (const event of runner.stream({
      prompt: "你好",
      projectId: null,
      accessMode: "approval"
    })) {
      if (event.type === "run_started") {
        runId = event.runId;
        sessionId = event.sessionId;
      }
      events.push(event);
    }

    expect(events.at(-1)).toMatchObject({ type: "run_end", status: "aborted" });
    const partial = events.find(
      (event) => event.type === "message" && event.message.role === "assistant"
    );
    expect(partial?.type === "message" && partial.message.content).toBe("写到一半的回答");
    const assistant = (await store.listMessages(sessionId!)).find(
      (message) => message.role === "assistant"
    );
    expect(assistant?.content).toBe("写到一半的回答");
    const runs = await store.listRuns(sessionId!);
    expect(runs.at(-1)?.status).toBe("aborted");
  });

  it("aborting during an approval wait rejects the tool and skips further model calls", async () => {
    const project = await store.createProject({ name: "proj", path: dir });
    const { runner, calls } = runnerWith([
      {
        toolCalls: [
          { id: "call_1", name: "write_file", arguments: { path: ".env", content: "TOKEN=x" } }
        ]
      },
      { text: "不应该被调用" }
    ]);

    let runId: string | undefined;
    const events: StreamEvent[] = [];
    for await (const event of runner.stream({
      prompt: "写文件",
      projectId: project.id,
      accessMode: "approval"
    })) {
      events.push(event);
      if (event.type === "run_started") {
        runId = event.runId;
      }
      if (event.type === "tool_call" && event.toolCall.status === "pending_approval") {
        runner.abort(runId!);
      }
    }

    expect(
      events.some((event) => event.type === "tool_call" && event.toolCall.status === "rejected")
    ).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: "run_end", status: "aborted" });
    // No second model turn after the abort.
    expect(calls).toHaveLength(1);
  });

  it("aborts a running model-requested shell tool promptly", async () => {
    const project = await store.createProject({ name: "proj", path: dir });
    const { runner, calls } = runnerWith([
      { toolCalls: [{ id: "call_1", name: "shell", arguments: { command: "sleep 5" } }] },
      { text: "不应该被调用" }
    ]);
    const events: StreamEvent[] = [];
    let runId: string | undefined;
    const startedAt = Date.now();

    for await (const event of runner.stream({
      prompt: "执行一个长命令",
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
    expect(calls).toHaveLength(1);
  });

  it("fails the run after 25 consecutive tool turns", async () => {
    const project = await store.createProject({ name: "proj", path: dir });
    const turns: ScriptedTurn[] = Array.from({ length: 30 }, (_, index) => ({
      toolCalls: [{ id: `call_${index}`, name: "list_directory", arguments: {} }]
    }));
    const { runner, calls } = runnerWith(turns);

    const events = await drain(
      runner.stream({ prompt: "一直列目录", projectId: project.id, accessMode: "full_access" })
    );

    const end = events.at(-1);
    expect(end).toMatchObject({ type: "run_end", status: "failed" });
    expect(end?.type === "run_end" && end.error).toContain("已达到最大工具调用轮数（25）");
    expect(calls).toHaveLength(25);
  });

  it("surfaces provider errors as a failed run", async () => {
    const { runner } = runnerWith([{ error: "模型请求失败 401: bad key" }]);

    const events = await drain(
      runner.stream({ prompt: "你好", projectId: null, accessMode: "approval" })
    );

    const end = events.at(-1);
    const started = events.find((event) => event.type === "run_started");
    expect(end).toMatchObject({ type: "run_end", status: "failed" });
    expect(end?.type === "run_end" && end.error).toContain("401");
    expect(started?.type).toBe("run_started");
    if (started?.type === "run_started") {
      const runs = await store.listRuns(started.sessionId);
      expect(runs.at(-1)).toMatchObject({
        id: started.runId,
        status: "failed",
        error: expect.stringContaining("401")
      });
    }
  });
});

function parseBackgroundOutputPath(result: string): string {
  const match = result.match(/输出文件：(\S+)/);
  if (!match) {
    throw new Error(`未找到输出文件路径: ${result}`);
  }
  return match[1];
}

async function waitForFileToContain(
  path: string,
  expected: string,
  timeoutMs = 1_500
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastContent = "";
  while (Date.now() < deadline) {
    try {
      lastContent = await readFile(path, "utf8");
      if (lastContent.includes(expected)) {
        return;
      }
    } catch {
      // 文件可能刚创建但还没写入，继续轮询。
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`文件未出现预期内容 path=${path} expected=${expected} content=${lastContent}`);
}
