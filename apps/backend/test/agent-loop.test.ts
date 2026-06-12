import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { nowIso, type ProviderConfig, type StreamEvent } from "@chengxiaobang/shared";
import { AgentRunner } from "../src/agent/agent-runner";
import { SqliteStateStore } from "../src/repository/sqlite-state-store";
import { MemorySecretStore } from "../src/secrets/secret-store";
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

    // The second model call sees the lossless toolCall/toolResult pair.
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

  it("waits for approval before running a model-requested mutating tool", async () => {
    const project = await store.createProject({ name: "proj", path: dir });
    const { runner } = runnerWith([
      {
        toolCalls: [
          { id: "call_1", name: "write_file", arguments: { path: "a.txt", content: "x" } }
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
          runner.approvals.decide(event.toolCall.id, true);
        }
        if (event.toolCall.status === "running") {
          runningStartedAt = event.toolCall.startedAt;
        }
      }
    }
    expect(transitions).toEqual(["pending_approval", "running", "completed"]);
    expect(pendingHadNoStart).toBe(true);
    expect(runningStartedAt).toBeDefined();
    await expect(readFile(join(dir, "a.txt"), "utf8")).resolves.toBe("x");
  });

  it("feeds a rejection back to the model instead of aborting", async () => {
    const project = await store.createProject({ name: "proj", path: dir });
    const { runner, calls } = runnerWith([
      {
        toolCalls: [
          { id: "call_1", name: "write_file", arguments: { path: "a.txt", content: "x" } }
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
        runner.approvals.decide(event.toolCall.id, false);
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
          { id: "call_1", name: "write_file", arguments: { path: "a.txt", content: "x" } }
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
    expect(end).toMatchObject({ type: "run_end", status: "failed" });
    expect(end?.type === "run_end" && end.error).toContain("401");
  });
});
