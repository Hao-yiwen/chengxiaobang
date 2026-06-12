// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/renderer/App";
import type { ApiClient } from "../src/renderer/lib/api";
import { resetAppStore, useAppStore } from "../src/renderer/store";
import type { Message, ProviderConfig, Session, ToolCall } from "@chengxiaobang/shared";

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

const session: Session = {
  id: "session_1",
  projectId: null,
  title: "历史对话",
  providerId: "deepseek",
  accessMode: "approval",
  createdAt: "2026-06-08T00:00:00.000Z",
  updatedAt: "2026-06-08T00:00:02.000Z"
};

const userMessage: Message = {
  id: "u1",
  sessionId: session.id,
  role: "user",
  content: "你好",
  createdAt: "2026-06-08T00:00:00.000Z"
};

const assistantMessage: Message = {
  id: "a1",
  sessionId: session.id,
  role: "assistant",
  content: "答案是 42",
  createdAt: "2026-06-08T00:00:01.000Z"
};

function createClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    listProjects: vi.fn(async () => []),
    createProject: vi.fn() as never,
    listSessions: vi.fn(async () => [session]),
    listProjectFiles: vi.fn(async () => []),
    updateSession: vi.fn() as never,
    deleteSession: vi.fn() as never,
    getGitChanges: vi.fn(async () => ({ isRepo: false, files: [] })),
    listMessages: vi.fn(async () => [userMessage, assistantMessage]),
    rewindSession: vi.fn(async () => [] as Message[]),
    forkSession: vi.fn() as never,
    listSessionRuns: vi.fn(async () => ({ runs: [], toolCalls: [] })),
    listSlashCommands: vi.fn(async () => ({ commands: [], diagnostics: [] })),
    listProviders: vi.fn(async () => [provider]),
    saveProvider: vi.fn() as never,
    deleteProvider: vi.fn(async () => true),
    testProvider: vi.fn() as never,
    getFeishuConfig: vi.fn(async () => ({ enabled: false, appId: "", domain: "feishu" as const, fullAccess: false })),
    saveFeishuConfig: vi.fn() as never,
    getFeishuStatus: vi.fn(async () => ({ status: "disconnected" as const })),
    approve: vi.fn() as never,
    abort: vi.fn() as never,
    terminalExec: vi.fn() as never,
    streamRun: vi.fn(async () => {}),
    ...overrides
  };
}

beforeEach(() => {
  window.localStorage.clear();
  resetAppStore();
  // 这些用例都在操作一个已打开的对话，模拟用户停在对话视图（刷新会保留该视图）。
  useAppStore.setState({ view: "chat" });
});

describe("MessageActions", () => {
  it("copies a whole message to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true
    });
    render(<App client={createClient()} />);
    await screen.findByText("答案是 42");

    const copyButtons = screen.getAllByRole("button", { name: "复制" });
    expect(copyButtons).toHaveLength(2);
    // Timeline order: the user bubble's copy button first, then the assistant's.
    fireEvent.click(copyButtons[1]);

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("答案是 42"));
  });

  it("regenerates the last answer by rewinding to the last user message", async () => {
    const rewindSession = vi.fn(async () => [] as Message[]);
    const streamRun = vi.fn(async () => {});
    const client = createClient({ rewindSession, streamRun: streamRun as never });

    render(<App client={client} />);
    await screen.findByText("答案是 42");

    fireEvent.click(screen.getByRole("button", { name: "重新生成" }));

    await waitFor(() => expect(rewindSession).toHaveBeenCalledWith("session_1", "u1"));
    await waitFor(() => expect(streamRun).toHaveBeenCalled());
    expect(streamRun.mock.calls[0]?.[0]).toMatchObject({
      sessionId: "session_1",
      prompt: "你好"
    });
  });

  it("edits a user message and resends the edited content", async () => {
    const rewindSession = vi.fn(async () => [] as Message[]);
    const streamRun = vi.fn(async () => {});
    const client = createClient({ rewindSession, streamRun: streamRun as never });

    render(<App client={client} />);
    await screen.findByText("答案是 42");

    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    const editor = screen.getByRole("textbox", { name: "编辑" });
    expect(editor).toHaveValue("你好");
    fireEvent.change(editor, { target: { value: "改过的问题" } });
    // The composer's own send button is disabled (empty input); the enabled
    // one belongs to the inline editor.
    const send = screen
      .getAllByRole("button", { name: "发送" })
      .find((button) => !button.hasAttribute("disabled"));
    fireEvent.click(send!);

    await waitFor(() => expect(rewindSession).toHaveBeenCalledWith("session_1", "u1"));
    await waitFor(() => expect(streamRun).toHaveBeenCalled());
    expect(streamRun.mock.calls[0]?.[0]).toMatchObject({ prompt: "改过的问题" });
  });

  it("forks the session from a message and switches to the branch", async () => {
    const branch: Session = {
      ...session,
      id: "session_2",
      title: "历史对话（分支）",
      parentSessionId: session.id,
      forkMessageId: "u1"
    };
    const forkSession = vi.fn(async () => branch);
    const listMessages = vi.fn(async (id: string) =>
      id === "session_2" ? [userMessage] : [userMessage, assistantMessage]
    );
    const client = createClient({ forkSession: forkSession as never, listMessages });

    render(<App client={client} />);
    await screen.findByText("答案是 42");

    // One fork button per message; the first belongs to the user message.
    fireEvent.click(screen.getAllByRole("button", { name: "从这条消息创建分支" })[0]);

    await waitFor(() => expect(forkSession).toHaveBeenCalledWith("session_1", "u1"));
    // The branch becomes the active session and shows up in the sidebar (and
    // chat header) with a branch indicator pointing at its parent.
    expect((await screen.findAllByText("历史对话（分支）")).length).toBeGreaterThanOrEqual(1);
    expect(await screen.findByTitle("从「历史对话」分支")).toBeInTheDocument();
    await waitFor(() => expect(listMessages).toHaveBeenCalledWith("session_2"));
  });

  it("hides regenerate, edit and fork while a run is active", async () => {
    render(<App client={createClient()} />);
    await screen.findByText("答案是 42");

    act(() => {
      useAppStore.setState({ isRunning: true });
    });

    expect(screen.queryByRole("button", { name: "重新生成" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "编辑" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "从这条消息创建分支" })
    ).not.toBeInTheDocument();
    // 复制不会改动会话，历史消息在运行中也可以复制。
    expect(screen.getAllByRole("button", { name: "复制" })).toHaveLength(2);
  });

  it("hides actions for assistant messages produced by the active run", async () => {
    render(<App client={createClient()} />);
    await screen.findByText("答案是 42");

    act(() => {
      useAppStore.setState({
        isRunning: true,
        activeRunId: "run_1",
        events: [{ type: "message", runId: "run_1", message: assistantMessage }]
      });
    });

    // 运行中的本轮 assistant 回复可能只是中间过程，先只保留用户消息复制。
    expect(screen.getAllByRole("button", { name: "复制" })).toHaveLength(1);
  });

  it("hides actions for interim assistant messages followed by a tool call", async () => {
    const interimMessage: Message = {
      id: "a_interim",
      sessionId: session.id,
      role: "assistant",
      content: "好的，我先创建 HTML 文件。",
      createdAt: "2026-06-08T00:00:01.000Z"
    };
    const finalMessage: Message = {
      id: "a_final",
      sessionId: session.id,
      role: "assistant",
      content: "HTML 已经生成。",
      createdAt: "2026-06-08T00:00:03.000Z"
    };
    const htmlToolCall: ToolCall = {
      id: "tool_1",
      runId: "run_1",
      name: "write_file",
      args: { path: "beautiful-page.html", content: "<!doctype html>" },
      status: "completed",
      result: "已写入 beautiful-page.html",
      createdAt: "2026-06-08T00:00:02.000Z",
      updatedAt: "2026-06-08T00:00:02.000Z"
    };
    const client = createClient({
      listMessages: vi.fn(async () => [userMessage, interimMessage, finalMessage]),
      listSessionRuns: vi.fn(async () => ({ runs: [], toolCalls: [htmlToolCall] }))
    });

    render(<App client={client} />);

    expect(await screen.findByText("好的，我先创建 HTML 文件。")).toBeInTheDocument();
    expect(await screen.findByText("HTML 已经生成。")).toBeInTheDocument();
    expect(screen.getByText("beautiful-page.html")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "复制" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "从这条消息创建分支" })).toHaveLength(2);
  });
});
