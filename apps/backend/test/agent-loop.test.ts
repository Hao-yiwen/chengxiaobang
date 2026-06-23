import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  deriveTodoState,
  nowIso,
  type ProviderConfig,
  type StreamEvent
} from "@chengxiaobang/shared";
import { AgentRunner } from "../src/agent/agent-runner";
import { TOOL_RESULT_SPILL_DIR } from "../src/agent/tool-result-spill";
import { defaultDataDir } from "../src/paths";
import { SqliteStateStore } from "../src/repository/sqlite-state-store";
import { MemorySecretStore } from "../src/secrets/secret-store";
import { SHELL_GLOBAL_OUTPUT_DIR } from "../src/tools/shell";
import { createShellTools } from "../src/tools/shell-tools";
import { scriptedStreamFn, type ScriptedTurn } from "./helpers/scripted-stream";

async function drain(stream: AsyncGenerator<StreamEvent>): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}

function delayedEchoShellCommand(text: string): string {
  return process.platform === "win32"
    ? `ping 127.0.0.1 -n 2 >nul & echo ${text}`
    : `sleep 0.2; echo ${text}`;
}

function shortDelayedEchoShellCommand(text: string): string {
  return process.platform === "win32"
    ? `powershell -NoProfile -Command "Start-Sleep -Milliseconds 200; Write-Output ${text}"`
    : `sleep 0.2; echo ${text}`;
}

function longRunningShellCommand(): string {
  return process.platform === "win32" ? "ping 127.0.0.1 -n 6 >nul" : "sleep 5";
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
        toolCalls: [{ id: "call_1", name: "LS", arguments: {} }]
      },
      {
        text: "目录已经看完。",
        usage: { input: 6, cacheRead: 4, output: 5, totalTokens: 15 }
      }
    ]);

    const events = await drain(
      runner.stream({ prompt: "看看目录", projectId: project.id, accessMode: "full_access" })
    );

    const compact = events
      .filter((event) => event.type !== "session_updated")
      .map((event) =>
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
          { id: "call_1", name: "Write", arguments: { file_path: "out.txt", content: "done" } }
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
    const completedTool = events.find(
      (event) => event.type === "tool_call" && event.toolCall.status === "completed"
    );
    if (completedTool?.type !== "tool_call") {
      throw new Error("expected completed tool_call event");
    }
    expect(completedTool.toolCall.fileChange).toMatchObject({
      path: "out.txt",
      operation: "write",
      additions: 1,
      deletions: 0
    });
    expect(events.at(-1)).toMatchObject({ type: "run_end", status: "completed" });
    const end = events.at(-1);
    if (end?.type !== "run_end") {
      throw new Error("expected run_end event");
    }
    expect(end.fileChanges).toMatchObject([
      {
        path: "out.txt",
        operation: "write",
        additions: 1,
        deletions: 0
      }
    ]);
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

  it("aggregates repeated file changes in one run from first before to final after", async () => {
    const project = await store.createProject({ name: "proj", path: dir });
    const { runner } = runnerWith([
      {
        toolCalls: [
          {
            id: "write_1",
            name: "Write",
            arguments: { file_path: "out.txt", content: "alpha\n" }
          }
        ]
      },
      {
        toolCalls: [
          {
            id: "edit_1",
            name: "Edit",
            arguments: { file_path: "out.txt", old_string: "alpha", new_string: "beta" }
          }
        ]
      },
      { text: "已经完成。", usage: { input: 10, output: 5, totalTokens: 15 } }
    ]);

    const events = await drain(
      runner.stream({
        prompt: "先写入再修改 out.txt",
        projectId: project.id,
        accessMode: "full_access"
      })
    );

    const end = events.at(-1);
    if (end?.type !== "run_end") {
      throw new Error("expected run_end event");
    }
    expect(end.fileChanges).toMatchObject([
      {
        path: "out.txt",
        operation: "mixed",
        additions: 1,
        deletions: 0
      }
    ]);
    expect(end.fileChanges?.[0]?.toolCallIds).toHaveLength(2);
    expect(end.fileChanges?.[0]?.patch).toContain("+beta");
    expect(end.fileChanges?.[0]?.patch).not.toContain("+alpha");

    await expect(readFile(join(dir, "out.txt"), "utf8")).resolves.toBe("beta\n");
    const sessionId = events.find((event) => event.type === "run_started")?.sessionId;
    expect(sessionId).toBeDefined();
    const [run] = await store.listRuns(sessionId!);
    expect(run.fileChanges).toMatchObject(end.fileChanges ?? []);
  });

  it("keeps repeated provider tool ids unique across runs", async () => {
    const project = await store.createProject({ name: "proj", path: dir });
    const { runner } = runnerWith([
      {
        toolCalls: [
          { id: "ls_0", name: "LS", arguments: { path: "." } }
        ]
      },
      { text: "第一轮完成。" },
      {
        toolCalls: [
          { id: "ls_0", name: "LS", arguments: { path: "." } }
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
      (toolCall) => toolCall.name === "LS"
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

  it("routes AskUserQuestion answers through app tool ids while preserving model ids", async () => {
    const project = await store.createProject({ name: "proj", path: dir });
    const { runner, calls } = runnerWith([
      {
        toolCalls: [
          {
            id: "ask_0",
            name: "AskUserQuestion",
            arguments: { questions: [{ question: "要继续分析吗？", options: ["继续分析", "停止"] }] }
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
          answer: { answers: [{ question: "要继续分析吗？", optionLabel: "继续分析" }] }
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

  it("计划确认后同一 run 恢复普通工具且不暴露 TodoWrite", async () => {
    const project = await store.createProject({ name: "proj", path: dir });
    const { runner, calls } = runnerWith([
      {
        toolCalls: [
          {
            id: "plan_0",
            name: "ExitPlanMode",
            arguments: {
              plan:
                "# 示例计划\n\n## Summary\n先确认计划。\n\n## Key Changes\n- 写入文件。\n\n## Test Plan\n- 读取文件。\n\n## Assumptions\n- 使用当前项目。"
            }
          }
        ]
      },
      {
        toolCalls: [
          {
            id: "write_0",
            name: "Write",
            arguments: { file_path: "plan.txt", content: "done" }
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
    expect(secondTurnTools).toContain("Write");
    expect(secondTurnTools).not.toContain("ExitPlanMode");
    expect(secondTurnTools).not.toContain("ExitPlanMode");
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
            name: "TodoWrite",
            arguments: {
              todos: [
                { content: "新增契约", status: "in_progress", priority: "high" },
                { content: "接入 UI", status: "pending", priority: "medium" }
              ]
            }
          }
        ]
      },
      {
        toolCalls: [
          {
            id: "todo_2",
            name: "TodoWrite",
            arguments: {
              todos: [
                { content: "新增契约", status: "completed", priority: "high" },
                { content: "接入 UI", status: "pending", priority: "medium" }
              ]
            }
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
        event.toolCall.name === "TodoWrite"
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
      title: "执行清单"
    });
    expect(state!.items.map((item) => item.content)).toEqual(["新增契约", "接入 UI"]);
    expect(state!.items.map((item) => item.status)).toEqual(["completed", "pending"]);
  });

  it("spills oversized model-requested tool results before the next model turn", async () => {
    const project = await store.createProject({ name: "proj", path: dir });
    const largeText = `START\n${"A".repeat(30_000)}\nMIDDLE_UNIQUE\n${"B".repeat(30_000)}\nEND`;
    await writeFile(join(dir, "large.txt"), largeText, "utf8");
    const { runner, calls } = runnerWith([
      { toolCalls: [{ id: "call_1", name: "Read", arguments: { file_path: "large.txt" } }] },
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
    const spillPath = join(defaultDataDir(), TOOL_RESULT_SPILL_DIR, runId, "call_1-Read.txt");

    expect(summary).toContain("结果过长，已写入文件");
    expect(summary).toContain(spillPath);
    expect(summary).toContain("START");
    expect(summary).toContain("END");
    expect(summary).not.toContain("MIDDLE_UNIQUE");
    const spilled = await readFile(spillPath, "utf8");
    expect(spilled).toContain("large.txt 的第 1-5 行");
    expect(spilled).toContain("     1\tSTART");
    expect(spilled).toContain("     3\tMIDDLE_UNIQUE");
    expect(spilled).toContain("     5\tEND");
    await expect(
      readFile(join(dir, ".chengxiaobang", "tool-results", runId, "call_1-Read.txt"), "utf8")
    ).rejects.toThrow();

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
            name: "Bash",
            arguments: { command: delayedEchoShellCommand("loop-background-done") }
          }
        ]
      },
      { text: "我会读取输出文件确认结果。" }
    ]);
    const runner = new AgentRunner(store, secrets, {
      streamFn: scripted.streamFn,
      createTools: (workspacePath, runtime) =>
        createShellTools(workspacePath, {
          backgroundAfterMs: 50,
          shellOutputDir: join(defaultDataDir(), SHELL_GLOBAL_OUTPUT_DIR),
          ...(runtime?.runId ? { runId: runtime.runId } : {})
        })
    });
    const startedAt = Date.now();

    const events = await drain(
      runner.stream({ prompt: "执行慢命令", projectId: project.id, accessMode: "full_access" })
    );

    expect(Date.now() - startedAt).toBeLessThan(1_500);
    const completed = events.find(
      (event) => event.type === "tool_call" && event.toolCall.status === "completed"
    );
    const started = events.find((event) => event.type === "run_started");
    const runId = started?.type === "run_started" ? started.runId : "";
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
    expect(outputPath).toContain(join(defaultDataDir(), SHELL_GLOBAL_OUTPUT_DIR, runId));
    await waitForFileToContain(resolveOutputPath(dir, outputPath), "loop-background-done");
    await expect(
      readFile(join(dir, ".chengxiaobang", "shell-outputs", basename(outputPath)), "utf8")
    ).rejects.toThrow();
  });

  it("starts model-requested shell commands in the background when requested", async () => {
    const project = await store.createProject({ name: "proj", path: dir });
    const scripted = scriptedStreamFn([
      {
        toolCalls: [
          {
            id: "call_shell_background",
            name: "Bash",
            arguments: {
              command: delayedEchoShellCommand("requested-background-done"),
              run_in_background: true
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
    const started = events.find((event) => event.type === "run_started");
    const runId = started?.type === "run_started" ? started.runId : "";
    const summary = completed?.type === "tool_call" ? completed.toolCall.result ?? "" : "";
    const outputPath = parseBackgroundOutputPath(summary);

    expect(summary).toContain("run_in_background=true");
    expect(summary).toContain("后台命令 ID");
    expect(outputPath).toContain(join(defaultDataDir(), SHELL_GLOBAL_OUTPUT_DIR, runId));
    await waitForFileToContain(resolveOutputPath(dir, outputPath), "requested-background-done");
  });

  it("waits for model-requested shell commands in blocking mode", async () => {
    const project = await store.createProject({ name: "proj", path: dir });
    const scripted = scriptedStreamFn([
      {
        toolCalls: [
          {
            id: "call_shell_blocking",
            name: "Bash",
            arguments: {
              command: shortDelayedEchoShellCommand("blocking-loop-done"),
              timeout: 1_000
            }
          }
        ]
      },
      { text: "阻塞等待拿到了结果。" }
    ]);
    const runner = new AgentRunner(store, secrets, {
      streamFn: scripted.streamFn,
      createTools: (workspacePath) => createShellTools(workspacePath, { backgroundAfterMs: 50 })
    });

    const events = await drain(
      runner.stream({ prompt: "阻塞等待慢命令", projectId: project.id, accessMode: "full_access" })
    );

    const completed = events.find(
      (event) => event.type === "tool_call" && event.toolCall.status === "completed"
    );
    const summary = completed?.type === "tool_call" ? completed.toolCall.result ?? "" : "";

    expect(summary).toContain("blocking-loop-done");
    expect(summary).not.toContain("后台命令 ID");
  });

  it("returns Bash timeout commands as background output files when timeout elapses", async () => {
    const project = await store.createProject({ name: "proj", path: dir });
    const scripted = scriptedStreamFn([
      {
        toolCalls: [
          {
            id: "call_shell_blocking_background",
            name: "Bash",
            arguments: {
              command: delayedEchoShellCommand("blocking-background-done"),
              timeout: 50
            }
          }
        ]
      },
      { text: "阻塞窗口结束后转后台。" }
    ]);
    const runner = new AgentRunner(store, secrets, {
      streamFn: scripted.streamFn
    });

    const events = await drain(
      runner.stream({ prompt: "阻塞等待超时", projectId: project.id, accessMode: "full_access" })
    );

    const completed = events.find(
      (event) => event.type === "tool_call" && event.toolCall.status === "completed"
    );
    const started = events.find((event) => event.type === "run_started");
    const runId = started?.type === "run_started" ? started.runId : "";
    const summary = completed?.type === "tool_call" ? completed.toolCall.result ?? "" : "";
    const outputPath = parseBackgroundOutputPath(summary);

    expect(summary).toContain("timeout=50ms");
    expect(summary).toContain("后台命令 ID");
    expect(outputPath).toContain(join(defaultDataDir(), SHELL_GLOBAL_OUTPUT_DIR, runId));
    await waitForFileToContain(resolveOutputPath(dir, outputPath), "blocking-background-done");
  });

  it("emits tool_activity while tool arguments stream and omits large content", async () => {
    const project = await store.createProject({ name: "proj", path: dir });
    const { runner } = runnerWith([
      {
        toolCalls: [
          {
            id: "call_1",
            name: "Write",
            arguments: { file_path: "out.txt", content: "最终文件内容" },
            argumentDeltas: [
              "{\"file_path\":\"out.txt\"",
              "{\"file_path\":\"out.txt\",\"content\":\"正在生成的大段内容"
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
        event.type === "tool_activity" && event.activity.argsPreview.file_path === "out.txt"
    );
    const runningIndex = events.findIndex(
      (event) => event.type === "tool_call" && event.toolCall.status === "running"
    );
    const activity = events[activityIndex];

    expect(activityIndex).toBeGreaterThanOrEqual(0);
    expect(runningIndex).toBeGreaterThan(activityIndex);
    expect(activity?.type === "tool_activity" && activity.activity.name).toBe("Write");
    expect(activity?.type === "tool_activity" && activity.activity.argsPreview).toEqual({
      file_path: "out.txt"
    });
    expect(
      activity?.type === "tool_activity" &&
        "content" in activity.activity.argsPreview
    ).toBe(false);
  });

  it("emits tool_activity for Edit file_path while tool arguments stream", async () => {
    const project = await store.createProject({ name: "proj", path: dir });
    await writeFile(join(dir, "out.txt"), "旧内容", "utf8");
    const { runner } = runnerWith([
      {
        toolCalls: [
          {
            id: "call_1",
            name: "Edit",
            arguments: { file_path: "out.txt", old_string: "旧内容", new_string: "新内容" },
            argumentDeltas: [
              "{\"file_path\":\"out.txt\"",
              "{\"file_path\":\"out.txt\",\"old_string\":\"旧内容"
            ]
          }
        ]
      },
      { text: "已经编辑文件。" }
    ]);

    const events = await drain(
      runner.stream({ prompt: "编辑文件", projectId: project.id, accessMode: "full_access" })
    );
    const activity = events.find(
      (event) =>
        event.type === "tool_activity" && event.activity.argsPreview.file_path === "out.txt"
    );

    expect(activity?.type === "tool_activity" && activity.activity.name).toBe("Edit");
    expect(activity?.type === "tool_activity" && activity.activity.argsPreview).toEqual({
      file_path: "out.txt"
    });
    expect(activity?.type === "tool_activity" && "old_string" in activity.activity.argsPreview).toBe(
      false
    );
  });

  it("does not emit tool_activity for non edit/write tools while arguments stream", async () => {
    const project = await store.createProject({ name: "proj", path: dir });
    await writeFile(join(dir, "input.txt"), "hello", "utf8");
    const { runner } = runnerWith([
      {
        toolCalls: [
          {
            id: "call_1",
            name: "Read",
            arguments: { file_path: "input.txt" },
            argumentDeltas: ["{\"file_path\":\"input.txt\""]
          },
          {
            id: "call_2",
            name: "Bash",
            arguments: { command: shortDelayedEchoShellCommand("activity-filter-ok") },
            argumentDeltas: ["{\"command\":\"echo activity-filter-ok\""]
          }
        ]
      },
      { text: "已经完成。" }
    ]);

    const events = await drain(
      runner.stream({ prompt: "读文件并运行命令", projectId: project.id, accessMode: "full_access" })
    );

    expect(events.some((event) => event.type === "tool_activity")).toBe(false);
    expect(
      events.filter((event) => event.type === "tool_call" && event.toolCall.status === "completed")
    ).toHaveLength(2);
  });

  it("replays toolCall history losslessly in a later run of the same session", async () => {
    const project = await store.createProject({ name: "proj", path: dir });
    const { runner, calls } = runnerWith([
      {
        toolCalls: [
          { id: "call_1", name: "Write", arguments: { file_path: "out.txt", content: "done" } }
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
          { id: "call_1", name: "Write", arguments: { file_path: ".env", content: "TOKEN=x" } }
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
          { id: "call_1", name: "Write", arguments: { file_path: ".env", content: "TOKEN=x" } }
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
      { toolCalls: [{ id: "call_1", name: "Read", arguments: { file_path: "missing.txt" } }] },
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
          { id: "call_1", name: "Write", arguments: { file_path: ".env", content: "TOKEN=x" } }
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
      {
        toolCalls: [
          { id: "call_1", name: "Bash", arguments: { command: longRunningShellCommand() } }
        ]
      },
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

  it("allows long tool runs under the model-level default limit", async () => {
    const project = await store.createProject({ name: "proj", path: dir });
    const turns: ScriptedTurn[] = [
      ...Array.from({ length: 30 }, (_, index) => ({
        toolCalls: [{ id: `call_${index}`, name: "LS", arguments: {} }]
      })),
      { text: "已经列完目录。" }
    ];
    const { runner, calls } = runnerWith(turns);

    const events = await drain(
      runner.stream({ prompt: "一直列目录", projectId: project.id, accessMode: "full_access" })
    );

    const end = events.at(-1);
    expect(end).toMatchObject({ type: "run_end", status: "completed" });
    expect(events.filter((event) => event.type === "tool_call")).toHaveLength(60);
    expect(calls).toHaveLength(31);
  });

  it("fails the run at the selected model's configured tool limit", async () => {
    const saved = await store.getProvider("deepseek");
    await store.upsertProvider({
      ...saved!,
      modelOverrides: { "deepseek-v4-flash": { maxToolIterations: 3 } }
    });
    const project = await store.createProject({ name: "proj", path: dir });
    const turns: ScriptedTurn[] = Array.from({ length: 5 }, (_, index) => ({
      toolCalls: [{ id: `call_${index}`, name: "LS", arguments: {} }]
    }));
    const { runner, calls } = runnerWith(turns);

    const events = await drain(
      runner.stream({ prompt: "一直列目录", projectId: project.id, accessMode: "full_access" })
    );

    const end = events.at(-1);
    expect(end).toMatchObject({ type: "run_end", status: "failed" });
    expect(end?.type === "run_end" && end.error).toContain("工具调用上限（3）");
    expect(calls).toHaveLength(3);
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

function resolveOutputPath(workspacePath: string, outputPath: string): string {
  return isAbsolute(outputPath) ? outputPath : join(workspacePath, outputPath);
}

async function waitForFileToContain(
  path: string,
  expected: string,
  timeoutMs = 4_000
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
