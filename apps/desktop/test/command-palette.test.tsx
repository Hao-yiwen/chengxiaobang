// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/renderer/App";
import type { ApiClient } from "../src/renderer/lib/api";
import { resetAppStore } from "../src/renderer/store";
import type { Message, ProviderConfig, Session } from "@chengxiaobang/shared";

const provider: ProviderConfig = {
  id: "deepseek",
  kind: "deepseek",
  name: "DeepSeek",
  baseURL: "https://api.deepseek.com",
  model: "deepseek-v4-flash",
  apiKeyRef: "test:deepseek",
  createdAt: "2026-06-08T00:00:00.000Z",
  updatedAt: "2026-06-08T00:00:00.000Z"
};

const plainSession: Session = {
  id: "session_plain",
  projectId: null,
  title: "普通标题",
  providerId: "deepseek",
  accessMode: "approval",
  createdAt: "2026-06-08T00:00:00.000Z",
  updatedAt: "2026-06-08T00:00:00.000Z"
};

const selectedMessage: Message = {
  id: "msg_selected",
  sessionId: plainSession.id,
  role: "assistant",
  content: "选中的会话正文",
  createdAt: "2026-06-08T00:00:01.000Z"
};

function createClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    listProjects: vi.fn(async () => []),
    createProject: vi.fn() as never,
    renameProject: vi.fn() as never,
    setProjectPinned: vi.fn() as never,
    deleteProject: vi.fn(async () => true),
    listSessions: vi.fn(async () => [plainSession]),
    listProjectFiles: vi.fn(async () => []),
    listProjectDirectory: vi.fn(async () => []),
    getGitChanges: vi.fn(async () => ({ isRepo: false, files: [] })),
    updateSession: vi.fn() as never,
    deleteSession: vi.fn(async () => true),
    searchSessions: vi.fn(async () => []),
    listMessages: vi.fn(async () => [selectedMessage]),
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

beforeEach(() => {
  window.localStorage.clear();
  resetAppStore();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  Element.prototype.scrollIntoView = vi.fn();
});

describe("CommandPalette", () => {
  it("shows and opens a session matched only by message content", async () => {
    const searchSessions = vi.fn(async () => [
      {
        session: plainSession,
        matchType: "content" as const,
        messageId: "msg_hit",
        role: "assistant" as const,
        snippet: "这里有隐秘关键字，只存在于正文里。"
      }
    ]);
    const client = createClient({ searchSessions });

    render(<App client={client} />);
    fireEvent.click(await screen.findByText("搜索"));
    const dialog = await screen.findByRole("dialog", { name: "搜索对话" });
    const input = await within(dialog).findByPlaceholderText("搜索标题或内容…");
    fireEvent.change(input, { target: { value: "隐秘关键字" } });

    await waitFor(() => expect(searchSessions).toHaveBeenCalledWith("隐秘关键字"));
    expect(await within(dialog).findByText("普通标题")).toBeInTheDocument();
    expect(within(dialog).getByText("这里有隐秘关键字，只存在于正文里。")).toBeInTheDocument();

    fireEvent.click(within(dialog).getByText("普通标题"));

    await waitFor(() => expect(client.listMessages).toHaveBeenCalledWith(plainSession.id));
    expect(await screen.findByText("选中的会话正文")).toBeInTheDocument();
  });
});
