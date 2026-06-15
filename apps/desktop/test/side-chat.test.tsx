// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Message,
  Project,
  ProviderConfig,
  RunRequest,
  Session,
  StreamEvent,
  ToolCall
} from "@chengxiaobang/shared";
import { App } from "../src/renderer/App";
import type { ApiClient } from "../src/renderer/lib/api";
import {
  initialSideChatState,
  sideChatReducer,
  type SideChatState
} from "../src/renderer/lib/side-chat";
import { resetAppStore, useAppStore } from "../src/renderer/store";

const provider: ProviderConfig = {
  id: "deepseek",
  kind: "deepseek",
  name: "DeepSeek",
  baseURL: "https://api.deepseek.com",
  model: "deepseek-v4-flash",
  apiKeyRef: "test:deepseek",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

const project: Project = {
  id: "project_1",
  name: "demo",
  path: "/tmp/demo",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

const session: Session = {
  id: "session_1",
  projectId: project.id,
  title: "项目对话",
  providerId: provider.id,
  accessMode: "approval",
  createdAt: "2026-06-08T00:00:00.000Z",
  updatedAt: "2026-06-08T00:00:02.000Z"
};

function message(id: string, role: Message["role"], content: string): Message {
  return { id, sessionId: "session_side", role, content, createdAt: "2026-06-08T00:00:01.000Z" };
}

function toolCall(status: ToolCall["status"]): ToolCall {
  return {
    id: "tool_1",
    runId: "run_1",
    name: "Bash",
    args: { command: "ls" },
    status,
    createdAt: "2026-06-08T00:00:01.000Z",
    updatedAt: "2026-06-08T00:00:01.000Z"
  };
}

function event(partial: StreamEvent): StreamEvent {
  return partial;
}

function createClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    listProjects: vi.fn(async () => [project]),
    createProject: vi.fn() as never,
    deleteProject: vi.fn(async () => true),
    listSessions: vi.fn(async () => [session]),
    listProjectFiles: vi.fn(async () => []),
    getGitChanges: vi.fn(async () => ({ isRepo: false, files: [] })),
    updateSession: vi.fn() as never,
    deleteSession: vi.fn() as never,
    listMessages: vi.fn(async () => []),
    rewindSession: vi.fn(async () => []),
    forkSession: vi.fn() as never,
    listSessionRuns: vi.fn(async () => ({ runs: [], toolCalls: [] })),
    listSlashCommands: vi.fn(async () => ({ commands: [], diagnostics: [] })),
    listProviders: vi.fn(async () => [provider]),
    saveProvider: vi.fn() as never,
    deleteProvider: vi.fn(async () => true),
    testProvider: vi.fn() as never,
    listProviderModels: vi.fn(async () => []),
    listProviderModelOptions: vi.fn(async () => []),
    getFeishuConfig: vi.fn(async () => ({
      enabled: false,
      appId: "",
      domain: "feishu" as const,
      fullAccess: false
    })),
    saveFeishuConfig: vi.fn() as never,
    getFeishuStatus: vi.fn(async () => ({ status: "disconnected" as const })),
    approve: vi.fn(async () => {}),
    abort: vi.fn() as never,
    terminalExec: vi.fn() as never,
    streamRun: vi.fn() as never,
    ...overrides
  };
}

async function openSideChat(): Promise<void> {
  const sidebar = within(await screen.findByTestId("app-sidebar"));
  fireEvent.click(await sidebar.findByText("项目对话"));
  fireEvent.click(await screen.findByTitle("打开侧边面板"));
  fireEvent.click(await screen.findByRole("button", { name: "侧边会话" }));
}

beforeEach(() => {
  window.localStorage.clear();
  resetAppStore();
  useAppStore.setState({ onboardingOpen: false, onboardingCompleted: true });
});

describe("sideChatReducer", () => {
  it("walks a full run: session id, stream text, messages, run end", () => {
    let state: SideChatState = { ...initialSideChatState, running: true };
    state = sideChatReducer(state, {
      type: "event",
      event: event({ type: "run_started", runId: "run_1", sessionId: "session_side" })
    });
    expect(state.sessionId).toBe("session_side");

    state = sideChatReducer(state, {
      type: "event",
      event: event({ type: "delta", runId: "run_1", channel: "thinking", delta: "思考" })
    });
    expect(state.streamText).toBe("");

    state = sideChatReducer(state, {
      type: "event",
      event: event({ type: "delta", runId: "run_1", channel: "text", delta: "你" })
    });
    state = sideChatReducer(state, {
      type: "event",
      event: event({ type: "delta", runId: "run_1", channel: "text", delta: "好" })
    });
    expect(state.streamText).toBe("你好");

    state = sideChatReducer(state, {
      type: "event",
      event: event({ type: "message", runId: "run_1", message: message("m1", "assistant", "你好") })
    });
    expect(state.streamText).toBe("");
    expect(state.items).toHaveLength(1);

    state = sideChatReducer(state, {
      type: "event",
      event: event({ type: "run_end", runId: "run_1", status: "completed" })
    });
    state = sideChatReducer(state, { type: "finish" });
    expect(state.running).toBe(false);
    expect(state.error).toBeUndefined();
  });

  it("tracks tool approval state and upserts the tool item in place", () => {
    let state: SideChatState = { ...initialSideChatState, running: true };
    state = sideChatReducer(state, {
      type: "event",
      event: event({ type: "tool_call", runId: "run_1", toolCall: toolCall("pending_approval") })
    });
    expect(state.pendingTool?.id).toBe("tool_1");
    expect(state.items).toHaveLength(1);

    state = sideChatReducer(state, {
      type: "event",
      event: event({ type: "tool_call", runId: "run_1", toolCall: toolCall("completed") })
    });
    expect(state.pendingTool).toBeUndefined();
    expect(state.items).toHaveLength(1);
    expect(state.items[0]).toMatchObject({ kind: "tool", toolCall: { status: "completed" } });
  });

  it("captures a failed run's error and resets to the initial state", () => {
    let state: SideChatState = { ...initialSideChatState, running: true };
    state = sideChatReducer(state, {
      type: "event",
      event: event({ type: "run_end", runId: "run_1", status: "failed", error: "模型超时" })
    });
    expect(state.error).toBe("模型超时");

    state = sideChatReducer(state, { type: "reset" });
    expect(state).toEqual(initialSideChatState);
  });
});

describe("side chat panel", () => {
  it("uses startRun and filters global events by clientRequestId/runId", async () => {
    let emit: ((event: StreamEvent) => void) | undefined;
    const subscribeRunEvents = vi.fn((listener: (event: StreamEvent) => void) => {
      emit = listener;
      return vi.fn();
    });
    const startRun = vi.fn(async (input: Parameters<NonNullable<ApiClient["startRun"]>>[0]) => ({
      runId: "run_side",
      sessionId: "session_side",
      clientRequestId: input.clientRequestId,
      providerId: provider.id,
      model: provider.model
    }));
    const streamRun = vi.fn(async () => {});
    const client = createClient({
      startRun,
      subscribeRunEvents,
      streamRun: streamRun as never
    });

    render(<App client={client} />);
    await screen.findByText("项目对话");
    await openSideChat();

    const input = await screen.findByLabelText("问点什么，回车发送");
    fireEvent.change(input, { target: { value: "走全局流" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(startRun).toHaveBeenCalled());
    expect(streamRun).not.toHaveBeenCalled();
    const clientRequestId = startRun.mock.calls[0]?.[0].clientRequestId;
    expect(clientRequestId).toEqual(expect.any(String));

    emit?.({
      type: "message",
      runId: "other_run",
      message: message("m_other", "assistant", "不该显示")
    });
    emit?.({
      type: "run_started",
      runId: "run_side",
      sessionId: "session_side",
      clientRequestId
    });
    emit?.({
      type: "message",
      runId: "run_side",
      message: message("m_side", "assistant", "侧边全局事件")
    });
    expect(await screen.findByText("侧边全局事件")).toBeInTheDocument();
    expect(screen.queryByText("不该显示")).not.toBeInTheDocument();
    emit?.({ type: "run_end", runId: "run_side", status: "completed" });
  });

  it("recovers a completed side run after the global stream reconnects", async () => {
    let reconnect: (() => void) | undefined;
    const subscribeRunEvents = vi.fn(
      (
        _listener: (event: StreamEvent) => void,
        options?: Parameters<NonNullable<ApiClient["subscribeRunEvents"]>>[1]
      ) => {
        reconnect = options?.onReconnect;
        return vi.fn();
      }
    );
    const startRun = vi.fn(async (input: Parameters<NonNullable<ApiClient["startRun"]>>[0]) => ({
      runId: "run_side",
      sessionId: "session_side",
      clientRequestId: input.clientRequestId,
      providerId: provider.id,
      model: provider.model
    }));
    const listMessages = vi.fn(async () => [
      message("m_recovered_user", "user", "走全局流"),
      message("m_recovered_assistant", "assistant", "恢复后的回答")
    ]);
    const listSessionRuns = vi.fn(async () => ({
      runs: [
        {
          id: "run_side",
          sessionId: "session_side",
          status: "completed" as const,
          createdAt: "2026-06-08T00:00:00.000Z",
          updatedAt: "2026-06-08T00:00:02.000Z"
        }
      ],
      toolCalls: []
    }));
    const client = createClient({
      startRun,
      subscribeRunEvents,
      listMessages,
      listSessionRuns
    });

    render(<App client={client} />);
    await screen.findByText("项目对话");
    await openSideChat();

    const input = await screen.findByLabelText("问点什么，回车发送");
    fireEvent.change(input, { target: { value: "走全局流" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(startRun).toHaveBeenCalled());
    reconnect?.();

    expect(await screen.findByText("恢复后的回答")).toBeInTheDocument();
    expect(listMessages).toHaveBeenCalledWith("session_side");
    expect(listSessionRuns).toHaveBeenCalledWith("session_side");
    expect(screen.getAllByRole("button", { name: /新对话/ }).some((button) => !button.disabled)).toBe(
      true
    );
  });

  it("streams a reply into the panel and reuses the session on the next send", async () => {
    const streamRun = vi.fn(
      async (input: RunRequest, onEvent: (event: StreamEvent) => void) => {
        const call = streamRun.mock.calls.length;
        onEvent({ type: "run_started", runId: "run_1", sessionId: "session_side" });
        onEvent({
          type: "message",
          runId: "run_1",
          message: message(`m_user_${call}`, "user", input.prompt)
        });
        onEvent({ type: "delta", runId: "run_1", channel: "text", delta: "回答" });
        onEvent({
          type: "message",
          runId: "run_1",
          message: message(`m_assistant_${call}`, "assistant", "回答")
        });
        onEvent({ type: "run_end", runId: "run_1", status: "completed" });
      }
    );
    const client = createClient({ streamRun: streamRun as never });

    render(<App client={client} />);
    await screen.findByText("项目对话");
    await openSideChat();

    const input = await screen.findByLabelText("问点什么，回车发送");
    fireEvent.change(input, { target: { value: "你好" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(await screen.findByText("回答")).toBeInTheDocument();
    expect(streamRun).toHaveBeenCalledTimes(1);
    expect(streamRun.mock.calls[0][0]).toMatchObject({
      sessionId: undefined,
      projectId: project.id,
      prompt: "你好",
      providerId: provider.id
    });

    fireEvent.change(input, { target: { value: "继续" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(await screen.findByText("继续")).toBeInTheDocument();
    expect(streamRun.mock.calls[1][0]).toMatchObject({ sessionId: "session_side" });
  });

  it("shows the approval bar for a pending tool and sends the decision", async () => {
    const streamRun = vi.fn((_input: RunRequest, onEvent: (event: StreamEvent) => void) => {
      onEvent({ type: "run_started", runId: "run_1", sessionId: "session_side" });
      onEvent({ type: "tool_call", runId: "run_1", toolCall: toolCall("pending_approval") });
      // The run blocks on the approval; the test ends before it resolves.
      return new Promise<void>(() => {});
    });
    const approve = vi.fn(async () => {});
    const client = createClient({ streamRun: streamRun as never, approve });

    render(<App client={client} />);
    await screen.findByText("项目对话");
    await openSideChat();

    const input = await screen.findByLabelText("问点什么，回车发送");
    fireEvent.change(input, { target: { value: "跑一下 ls" } });
    fireEvent.keyDown(input, { key: "Enter" });

    fireEvent.click(await screen.findByRole("button", { name: "执行" }));
    expect(approve).toHaveBeenCalledWith("tool_1", { approved: true });
  });

  it("starts a fresh session after 新对话", async () => {
    const streamRun = vi.fn(
      async (_input: RunRequest, onEvent: (event: StreamEvent) => void) => {
        onEvent({ type: "run_started", runId: "run_1", sessionId: "session_side" });
        onEvent({
          type: "message",
          runId: "run_1",
          message: message("m_assistant", "assistant", "回答")
        });
        onEvent({ type: "run_end", runId: "run_1", status: "completed" });
      }
    );
    const client = createClient({ streamRun: streamRun as never });

    render(<App client={client} />);
    await screen.findByText("项目对话");
    await openSideChat();

    const input = await screen.findByLabelText("问点什么，回车发送");
    fireEvent.change(input, { target: { value: "你好" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await screen.findByText("回答");

    // The right panel is the last <aside>; the first one is the left sidebar.
    const asides = document.querySelectorAll("aside");
    const panel = asides[asides.length - 1];
    expect(panel).toBeDefined();
    fireEvent.click(within(panel as HTMLElement).getByRole("button", { name: "新对话" }));
    expect(screen.queryByText("回答")).not.toBeInTheDocument();

    fireEvent.change(input, { target: { value: "再来" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await screen.findByText("回答");
    expect(streamRun.mock.calls[1][0]).toMatchObject({ sessionId: undefined });
  });
});
