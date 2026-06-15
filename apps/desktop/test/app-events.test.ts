// @vitest-environment jsdom
import { waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Message,
  ProviderConfig,
  ScheduledTaskEvent,
  Session,
  StreamEvent,
  ToolCall
} from "@chengxiaobang/shared";
import type { ApiClient } from "../src/renderer/lib/api";
import { resetAppStore, type QueuedRunItem, useAppStore } from "../src/renderer/store";

const session: Session = {
  id: "session_1",
  projectId: null,
  title: "AI 日报",
  providerId: "deepseek",
  accessMode: "approval",
  createdAt: "2026-06-13T00:00:00.000Z",
  updatedAt: "2026-06-13T00:00:00.000Z"
};

const deepseek: ProviderConfig = {
  id: "deepseek",
  kind: "deepseek",
  name: "DeepSeek",
  baseURL: "https://api.deepseek.com",
  model: "deepseek-v4-flash",
  apiKeyRef: "test:deepseek",
  createdAt: "2026-06-13T00:00:00.000Z",
  updatedAt: "2026-06-13T00:00:00.000Z"
};

function createClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    listProjects: vi.fn(async () => []),
    createProject: vi.fn() as never,
    renameProject: vi.fn() as never,
    setProjectPinned: vi.fn() as never,
    deleteProject: vi.fn(async () => true),
    listSessions: vi.fn(async () => [session]),
    listProjectFiles: vi.fn(async () => []),
    listProjectDirectory: vi.fn(async () => []),
    getGitChanges: vi.fn(async () => ({ isRepo: false, files: [] })),
    updateSession: vi.fn() as never,
    deleteSession: vi.fn() as never,
    listMessages: vi.fn(async () => []),
    rewindSession: vi.fn(async () => []),
    forkSession: vi.fn() as never,
    listSessionRuns: vi.fn(async () => ({ runs: [], toolCalls: [] })),
    listActiveRuns: vi.fn(async () => []),
    listSlashCommands: vi.fn(async () => ({ commands: [], diagnostics: [] })),
    listProviders: vi.fn(async () => [deepseek]),
    saveProvider: vi.fn() as never,
    deleteProvider: vi.fn(async () => true),
    testProvider: vi.fn() as never,
    listProviderModels: vi.fn(async () => []),
    listProviderModelOptions: vi.fn(async () => []),
    listTasks: vi.fn(async () => []),
    updateTask: vi.fn() as never,
    deleteTask: vi.fn(async () => true),
    runTaskNow: vi.fn(async () => {}),
    getFeishuConfig: vi.fn(async () => ({
      enabled: false,
      appId: "",
      domain: "feishu" as const,
      fullAccess: false
    })),
    saveFeishuConfig: vi.fn() as never,
    getFeishuStatus: vi.fn(async () => ({ status: "disconnected" as const })),
    approve: vi.fn() as never,
    abort: vi.fn() as never,
    terminalExec: vi.fn() as never,
    streamRun: vi.fn(async () => {}),
    ...overrides
  };
}

function queuedRun(id: string, content: string): QueuedRunItem {
  return {
    id,
    sessionId: session.id,
    projectId: null,
    content,
    sourceAttachments: [],
    displayAttachments: [],
    providerId: deepseek.id,
    model: deepseek.model,
    accessMode: "approval",
    planMode: false,
    createdAt: Date.now()
  };
}

beforeEach(() => {
  window.localStorage.clear();
  resetAppStore();
  useAppStore.setState({ sessions: [session] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("app event handling", () => {
  it("tracks scheduled task running state and shows a completion toast", () => {
    const started: ScheduledTaskEvent = {
      type: "scheduled_task_started",
      taskId: "task_1",
      sessionId: session.id,
      name: "AI 日报",
      trigger: "schedule",
      occurredAt: "2026-06-13T01:00:00.000Z"
    };
    const finished: ScheduledTaskEvent = {
      type: "scheduled_task_finished",
      taskId: "task_1",
      sessionId: session.id,
      name: "AI 日报",
      trigger: "schedule",
      status: "completed",
      runId: "run_1",
      occurredAt: "2026-06-13T01:01:00.000Z"
    };

    useAppStore.getState().handleAppEvent(started);
    expect(useAppStore.getState().runningSessionsById[session.id]).toBe(true);
    expect(useAppStore.getState().runningTaskIds.task_1).toBe(true);

    useAppStore.getState().handleAppEvent(finished);
    expect(useAppStore.getState().runningSessionsById[session.id]).toBeUndefined();
    expect(useAppStore.getState().runningTaskIds.task_1).toBeUndefined();
    expect(useAppStore.getState().notificationToasts[0]).toMatchObject({
      kind: "success",
      title: "定时任务「AI 日报」已完成"
    });
  });

  it("does not show a toast for normal run completion", () => {
    const runStarted: StreamEvent = {
      type: "run_started",
      runId: "run_1",
      sessionId: session.id
    };
    const runFinished: StreamEvent = {
      type: "run_end",
      runId: "run_1",
      status: "completed"
    };

    useAppStore.getState().handleRunEvent(runStarted, { force: true });
    expect(useAppStore.getState().runningSessionsById[session.id]).toBe(true);
    useAppStore.getState().handleRunEvent(runFinished);

    expect(useAppStore.getState().runningSessionsById[session.id]).toBeUndefined();
    expect(useAppStore.getState().notificationToasts).toHaveLength(0);
  });

  it("shows setup errors without recording a fake run", () => {
    useAppStore.setState({
      activeSessionId: session.id,
      activeRunId: "local_pending",
      isRunning: true,
      runHistory: []
    });

    useAppStore.getState().handleRunEvent({
      type: "setup_error",
      error: "请先配置至少一个模型"
    });

    expect(useAppStore.getState().isRunning).toBe(false);
    expect(useAppStore.getState().notice).toBe("请先配置至少一个模型");
    expect(useAppStore.getState().runHistory).toEqual([]);
  });

  it("tracks non-current run events without taking over the active composer", () => {
    const otherSessionId = "session_other";

    useAppStore.setState({
      view: "home",
      activeSessionId: undefined,
      activeRunId: undefined,
      isRunning: false
    });

    useAppStore.getState().handleRunEvent({
      type: "run_started",
      runId: "run_other",
      sessionId: otherSessionId
    });

    expect(useAppStore.getState().runningSessionsById[otherSessionId]).toBe(true);
    expect(useAppStore.getState().runningRunSessionById.run_other).toBe(otherSessionId);
    expect(useAppStore.getState().activeRunId).toBeUndefined();
    expect(useAppStore.getState().activeSessionId).toBeUndefined();
    expect(useAppStore.getState().view).toBe("home");
    expect(useAppStore.getState().isRunning).toBe(false);

    useAppStore.getState().handleRunEvent({
      type: "run_end",
      runId: "run_other",
      status: "completed"
    });

    expect(useAppStore.getState().runningSessionsById[otherSessionId]).toBeUndefined();
    expect(useAppStore.getState().runningRunSessionById.run_other).toBeUndefined();
    expect(useAppStore.getState().view).toBe("home");
  });

  it("accepts live run events when a restored running record exists before activeRunId is set", () => {
    const pendingTool: ToolCall = {
      id: "tool_pending",
      runId: "run_restored",
      name: "Write",
      args: { file_path: "active.txt", content: "ok" },
      status: "pending_approval",
      createdAt: "2026-06-13T00:00:01.000Z",
      updatedAt: "2026-06-13T00:00:01.000Z"
    };

    useAppStore.setState({
      activeSessionId: session.id,
      runHistory: [
        {
          id: "run_restored",
          sessionId: session.id,
          status: "running",
          createdAt: "2026-06-13T00:00:00.000Z",
          updatedAt: "2026-06-13T00:00:00.000Z"
        }
      ]
    });

    useAppStore.getState().handleRunEvent({
      type: "tool_call",
      runId: "run_restored",
      toolCall: pendingTool
    });

    expect(useAppStore.getState().pendingTool?.id).toBe(pendingTool.id);
  });

  it("batches text deltas and flushes them before tool events", async () => {
    vi.useFakeTimers();
    const toolCall: ToolCall = {
      id: "tool_running",
      runId: "run_active",
      name: "Bash",
      args: { command: "echo ok" },
      status: "running",
      createdAt: "2026-06-13T00:00:01.000Z",
      updatedAt: "2026-06-13T00:00:01.000Z"
    };
    useAppStore.setState({
      activeSessionId: session.id,
      activeRunId: "run_active",
      isRunning: true
    });
    let lastStreamText = useAppStore.getState().streamText;
    const streamTextChanges: string[] = [];
    const unsubscribe = useAppStore.subscribe((state) => {
      if (state.streamText === lastStreamText) {
        return;
      }
      lastStreamText = state.streamText;
      streamTextChanges.push(state.streamText);
    });

    try {
      useAppStore.getState().handleRunEvent({
        type: "delta",
        runId: "run_active",
        channel: "text",
        delta: "你"
      });
      useAppStore.getState().handleRunEvent({
        type: "delta",
        runId: "run_active",
        channel: "text",
        delta: "好"
      });

      expect(useAppStore.getState().streamText).toBe("");
      expect(streamTextChanges).toEqual([]);
      await vi.advanceTimersByTimeAsync(31);
      expect(useAppStore.getState().streamText).toBe("");
      expect(streamTextChanges).toEqual([]);

      useAppStore.getState().handleRunEvent({
        type: "tool_call",
        runId: "run_active",
        toolCall
      });

      expect(useAppStore.getState().streamText).toBe("你好");
      expect(streamTextChanges).toEqual(["你好"]);
      expect(useAppStore.getState().runningTool?.id).toBe(toolCall.id);
    } finally {
      unsubscribe();
    }
  });

  it("does not replay a buffered delta after the assistant message clears streaming text", async () => {
    vi.useFakeTimers();
    const assistantMessage: Message = {
      id: "msg_assistant",
      sessionId: session.id,
      role: "assistant",
      content: "最终回答",
      createdAt: "2026-06-13T00:00:02.000Z"
    };
    useAppStore.setState({
      activeSessionId: session.id,
      activeRunId: "run_active",
      isRunning: true
    });

    useAppStore.getState().handleRunEvent({
      type: "delta",
      runId: "run_active",
      channel: "text",
      delta: "过程"
    });
    useAppStore.getState().handleRunEvent({
      type: "message",
      runId: "run_active",
      message: assistantMessage
    });

    expect(useAppStore.getState().streamText).toBe("");
    await vi.advanceTimersByTimeAsync(40);
    expect(useAppStore.getState().streamText).toBe("");
    expect(useAppStore.getState().messages.at(-1)?.id).toBe(assistantMessage.id);
  });

  it("does not clear the active stream when selecting the current running session again", async () => {
    const listMessages = vi.fn(async () => []);
    await useAppStore.getState().initClient(createClient({ listMessages }));
    useAppStore.setState({
      view: "chat",
      activeSessionId: session.id,
      activeRunId: "run_active",
      isRunning: true,
      streamText: "输出中",
      runningSessionsById: { [session.id]: true },
      runningRunSessionById: { run_active: session.id }
    });

    await useAppStore.getState().selectSession(session.id);

    expect(useAppStore.getState().activeRunId).toBe("run_active");
    expect(useAppStore.getState().streamText).toBe("输出中");
    expect(listMessages).not.toHaveBeenCalled();
  });

  it("starts exactly one queued run after a completed run and leaves the next item waiting", async () => {
    const streamRun = vi.fn(async () => {});
    await useAppStore.getState().initClient(createClient({ streamRun: streamRun as never }));
    useAppStore.setState({
      view: "chat",
      activeSessionId: session.id,
      activeRunId: "run_active",
      activeRunClientRequestId: undefined,
      isRunning: true,
      sessions: [session],
      providers: [deepseek],
      providerId: deepseek.id,
      runHistory: [
        {
          id: "run_active",
          sessionId: session.id,
          status: "running",
          createdAt: "2026-06-13T00:00:00.000Z",
          updatedAt: "2026-06-13T00:00:00.000Z"
        }
      ],
      runningSessionsById: { [session.id]: true },
      runningRunSessionById: { run_active: session.id },
      queuedRunsBySession: {
        [session.id]: [queuedRun("queue_1", "第二句话"), queuedRun("queue_2", "第三句话")]
      },
      pausedRunQueuesBySession: {}
    });

    useAppStore.getState().handleRunEvent({
      type: "run_end",
      runId: "run_active",
      status: "completed"
    });

    await waitFor(() => expect(streamRun).toHaveBeenCalledTimes(1));
    expect(streamRun.mock.calls[0]?.[0]).toMatchObject({
      sessionId: session.id,
      prompt: "第二句话",
      providerId: deepseek.id,
      model: deepseek.model
    });
    expect(useAppStore.getState().queuedRunsBySession[session.id]?.map((item) => item.content))
      .toEqual(["第三句话"]);
    expect(useAppStore.getState().isRunning).toBe(true);
  });

  it("pauses the queue after a failed run without starting queued work", async () => {
    const streamRun = vi.fn(async () => {});
    await useAppStore.getState().initClient(createClient({ streamRun: streamRun as never }));
    useAppStore.setState({
      view: "chat",
      activeSessionId: session.id,
      activeRunId: "run_active",
      isRunning: true,
      sessions: [session],
      providers: [deepseek],
      providerId: deepseek.id,
      runningSessionsById: { [session.id]: true },
      runningRunSessionById: { run_active: session.id },
      queuedRunsBySession: { [session.id]: [queuedRun("queue_1", "失败后保留")] },
      pausedRunQueuesBySession: {}
    });

    useAppStore.getState().handleRunEvent({
      type: "run_end",
      runId: "run_active",
      status: "failed",
      error: "模型失败"
    });

    await Promise.resolve();
    expect(streamRun).not.toHaveBeenCalled();
    expect(useAppStore.getState().pausedRunQueuesBySession[session.id]).toBe(true);
    expect(useAppStore.getState().queuedRunsBySession[session.id]?.[0]?.content).toBe(
      "失败后保留"
    );
  });
});
