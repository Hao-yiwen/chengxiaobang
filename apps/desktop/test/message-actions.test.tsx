// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/renderer/App";
import type { ApiClient } from "../src/renderer/lib/api";
import { resetAppStore, useAppStore } from "../src/renderer/store";
import type { Message, ProviderConfig, Session } from "@chengxiaobang/shared";

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
    updateSession: vi.fn() as never,
    deleteSession: vi.fn() as never,
    listMessages: vi.fn(async () => [userMessage, assistantMessage]),
    rewindSession: vi.fn(async () => [] as Message[]),
    listSessionRuns: vi.fn(async () => ({ runs: [], toolCalls: [] })),
    listSlashCommands: vi.fn(async () => ({ commands: [], diagnostics: [] })),
    listProviders: vi.fn(async () => [provider]),
    saveProvider: vi.fn() as never,
    deleteProvider: vi.fn(async () => true),
    testProvider: vi.fn() as never,
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

  it("hides regenerate and edit while a run is active", async () => {
    render(<App client={createClient()} />);
    await screen.findByText("答案是 42");

    act(() => {
      useAppStore.setState({ isRunning: true });
    });

    expect(screen.queryByRole("button", { name: "重新生成" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "编辑" })).not.toBeInTheDocument();
    // Copy stays available — it doesn't mutate the session.
    expect(screen.getAllByRole("button", { name: "复制" })).toHaveLength(2);
  });
});
