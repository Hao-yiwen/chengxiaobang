// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import type { ScheduledTaskEvent, Session, StreamEvent, ToolCall } from "@chengxiaobang/shared";
import { resetAppStore, useAppStore } from "../src/renderer/store";

const session: Session = {
  id: "session_1",
  projectId: null,
  title: "AI 日报",
  providerId: "deepseek",
  accessMode: "approval",
  createdAt: "2026-06-13T00:00:00.000Z",
  updatedAt: "2026-06-13T00:00:00.000Z"
};

beforeEach(() => {
  window.localStorage.clear();
  resetAppStore();
  useAppStore.setState({ sessions: [session] });
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
      name: "write_file",
      args: { path: "active.txt", content: "ok" },
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
});
