// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/renderer/App";
import type { ApiClient } from "../src/renderer/lib/api";
import { resetAppStore, useAppStore } from "../src/renderer/store";
import type {
  Message,
  Project,
  ProviderConfig,
  ProviderInput,
  Session,
  ToolCall
} from "@chengxiaobang/shared";

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

function createClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    listProjects: vi.fn(async () => []),
    createProject: vi.fn() as never,
    deleteProject: vi.fn(async () => true),
    listSessions: vi.fn(async () => []),
    updateSession: vi.fn() as never,
    deleteSession: vi.fn() as never,
    listMessages: vi.fn(async () => []),
    listSessionRuns: vi.fn(async () => ({ runs: [], toolCalls: [] })),
    listSlashCommands: vi.fn(async () => ({
      commands: [
        {
          id: "builtin:/ls",
          name: "/ls",
          kind: "builtin_tool" as const,
          description: "列出当前项目目录内容",
          source: "builtin" as const,
          insertText: "/ls "
        }
      ],
      diagnostics: []
    })),
    listProviders: vi.fn(async () => [provider]),
    saveProvider: vi.fn() as never,
    testProvider: vi.fn() as never,
    approve: vi.fn() as never,
    abort: vi.fn() as never,
    streamRun: vi.fn() as never,
    ...overrides
  };
}

beforeEach(() => {
  window.localStorage.clear();
  resetAppStore();
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

describe("App", () => {
  it("renders home composer and model presets", async () => {
    const client = createClient();

    render(<App client={client} />);

    expect(await screen.findByText("今天想做点什么？")).toBeInTheDocument();
    expect(screen.getByLabelText("输入消息")).toBeInTheDocument();
    // The model picker shows just the model name, without the provider prefix.
    expect(await screen.findByText("deepseek-v4-flash")).toBeInTheDocument();
    expect(screen.queryByText("DeepSeek · deepseek-v4-flash")).not.toBeInTheDocument();
  });

  it("stays on home and opens the setup dialog when no provider has an API key", async () => {
    const client = createClient({
      listProviders: vi.fn(async () => [
        {
          ...provider,
          apiKeyRef: undefined
        }
      ])
    });

    render(<App client={client} />);

    // The home screen stays visible; setup happens in a lightweight dialog.
    expect(await screen.findByText("今天想做点什么？")).toBeInTheDocument();
    expect(await screen.findByText("配置模型")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("粘贴你的 API Key")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "供应商" })).not.toBeInTheDocument();
  });

  it("saves a provider from the setup dialog", async () => {
    const saved = { ...provider, id: "p_new" };
    const saveProvider = vi.fn(async (_input: ProviderInput) => saved);
    const listProviders = vi
      .fn()
      .mockResolvedValueOnce([{ ...provider, apiKeyRef: undefined }])
      .mockResolvedValue([saved]);
    const client = createClient({ listProviders, saveProvider: saveProvider as never });

    render(<App client={client} />);
    await screen.findByText("配置模型");

    fireEvent.change(screen.getByPlaceholderText("粘贴你的 API Key"), {
      target: { value: "sk-test" }
    });
    fireEvent.click(screen.getByRole("button", { name: "保存并开始" }));

    await waitFor(() => expect(saveProvider).toHaveBeenCalled());
    expect(saveProvider.mock.calls[0]?.[0]).toMatchObject({
      kind: "deepseek",
      apiKey: "sk-test"
    });
    await waitFor(() =>
      expect(screen.queryByText("配置模型")).not.toBeInTheDocument()
    );
  });

  it("switches UI language to English when the locale changes", async () => {
    const client = createClient();

    render(<App client={client} />);
    await screen.findByText("今天想做点什么？");

    await act(async () => {
      useAppStore.getState().setLocale("en");
    });

    expect(
      await screen.findByText("What should we work on today?")
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Message input")).toBeInTheDocument();

    // restore for subsequent tests
    await act(async () => {
      useAppStore.getState().setLocale("zh");
    });
  });

  it("restores the latest persisted session and messages", async () => {
    const session: Session = {
      id: "session_1",
      projectId: null,
      title: "昨天的对话",
      providerId: "deepseek",
      accessMode: "full_access",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const message: Message = {
      id: "msg_1",
      sessionId: session.id,
      role: "user",
      content: "继续昨天的问题",
      createdAt: new Date().toISOString()
    };
    const client = createClient({
      createProject: vi.fn() as never,
      listSessions: vi.fn(async () => [session]),
      listMessages: vi.fn(async () => [message]),
      streamRun: vi.fn() as never
    });

    render(<App client={client} />);

    expect(await screen.findByText("继续昨天的问题")).toBeInTheDocument();
    expect(screen.getByText("独立对话")).toBeInTheDocument();
  });

  it("restores persisted tool call history for the active session", async () => {
    const session: Session = {
      id: "session_1",
      projectId: null,
      title: "工具历史",
      providerId: "deepseek",
      accessMode: "approval",
      createdAt: "2026-06-08T00:00:00.000Z",
      updatedAt: "2026-06-08T00:00:02.000Z"
    };
    const message: Message = {
      id: "msg_1",
      sessionId: session.id,
      role: "user",
      content: "/ls",
      createdAt: "2026-06-08T00:00:00.000Z"
    };
    const toolCall: ToolCall = {
      id: "tool_1",
      runId: "run_1",
      name: "list_directory",
      args: { path: "." },
      status: "completed",
      result: "file package.json",
      createdAt: "2026-06-08T00:00:01.000Z",
      updatedAt: "2026-06-08T00:00:01.000Z"
    };
    const listSessionRuns = vi.fn(async () => ({
      runs: [
        {
          id: "run_1",
          sessionId: session.id,
          status: "completed" as const,
          createdAt: "2026-06-08T00:00:00.000Z",
          updatedAt: "2026-06-08T00:00:02.000Z"
        }
      ],
      toolCalls: [toolCall]
    }));
    const client = createClient({
      listSessions: vi.fn(async () => [session]),
      listMessages: vi.fn(async () => [message]),
      listSessionRuns
    });

    render(<App client={client} />);

    expect(await screen.findByText("file package.json")).toBeInTheDocument();
    expect(screen.getByText("list_directory")).toBeInTheDocument();
    expect(listSessionRuns).toHaveBeenCalledWith("session_1");
  });

  it("can abort a running stream from the composer", async () => {
    let emit: ((event: Parameters<ApiClient["streamRun"]>[1] extends (event: infer E) => void ? E : never) => void) | undefined;
    let resolveStream: (() => void) | undefined;
    const abort = vi.fn(async () => {
      emit?.({ type: "run_aborted", runId: "run_1" });
      resolveStream?.();
    });
    const client = createClient({
      abort,
      streamRun: vi.fn(async (_input, onEvent) => {
        emit = onEvent;
        onEvent({ type: "run_started", runId: "run_1", sessionId: "session_1" });
        return new Promise<void>((resolve) => {
          resolveStream = resolve;
        });
      })
    });

    render(<App client={client} />);

    fireEvent.change(await screen.findByLabelText("输入消息"), {
      target: { value: "停一下" }
    });
    fireEvent.click(screen.getByTitle("发送"));
    fireEvent.click(await screen.findByTitle("停止"));

    await waitFor(() => expect(abort).toHaveBeenCalledWith("run_1"));
  });

  it("sends with Enter and keeps Shift+Enter for newlines", async () => {
    const streamRun = vi.fn(async (..._args: Parameters<ApiClient["streamRun"]>) => {});
    const client = createClient({ streamRun: streamRun as never });

    render(<App client={client} />);
    const input = await screen.findByLabelText("输入消息");

    fireEvent.change(input, { target: { value: "你好" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(streamRun).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(streamRun).toHaveBeenCalled());
  });

  it("shows slash commands and inserts the selected command into the composer", async () => {
    const client = createClient({
      listSlashCommands: vi.fn(async () => ({
        commands: [
          {
            id: "builtin:/ls",
            name: "/ls",
            kind: "builtin_tool" as const,
            description: "列出当前项目目录内容",
            source: "builtin" as const,
            insertText: "/ls "
          },
          {
            id: "project:prompt_template:review",
            name: "/review",
            kind: "prompt_template" as const,
            description: "Review code",
            source: "project" as const,
            insertText: "/review "
          }
        ],
        diagnostics: []
      }))
    });

    render(<App client={client} />);
    const input = await screen.findByLabelText("输入消息");

    fireEvent.change(input, { target: { value: "/" } });

    expect(await screen.findByText("/ls")).toBeInTheDocument();
    expect(await screen.findByText("/review")).toBeInTheDocument();

    fireEvent.click(screen.getByText("/review"));

    expect(input).toHaveValue("/review ");
  });

  it("does not show slash commands for normal text", async () => {
    const client = createClient();

    render(<App client={client} />);
    const input = await screen.findByLabelText("输入消息");

    fireEvent.change(input, { target: { value: "hello" } });

    expect(screen.queryByText("/ls")).not.toBeInTheDocument();
  });

  it("explains why opening a folder is unavailable outside desktop", async () => {
    const client = createClient();

    render(<App client={client} />);
    await screen.findByText("今天想做点什么？");

    // The entry point lives in the composer's project dropdown now; trigger the
    // same store action it invokes.
    await act(async () => {
      await useAppStore.getState().openFolder();
    });

    expect(
      await screen.findByText("打开文件夹需要在桌面端里使用，浏览器预览没有系统文件选择权限。")
    ).toBeInTheDocument();
  });

  it("keeps new chats in conversation mode until a project is selected", async () => {
    const project: Project = {
      id: "project_1",
      name: "demo",
      path: "/tmp/demo",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const streamRun = vi.fn(async (..._args: Parameters<ApiClient["streamRun"]>) => {});
    const client = createClient({
      listProjects: vi.fn(async () => [project]),
      streamRun: streamRun as never
    });

    render(<App client={client} />);
    await screen.findByText("今天想做点什么？");

    fireEvent.change(screen.getByLabelText("输入消息"), {
      target: { value: "独立对话" }
    });
    fireEvent.click(screen.getByTitle("发送"));

    await waitFor(() => expect(streamRun).toHaveBeenCalled());
    expect(streamRun.mock.calls[0]?.[0]).toMatchObject({ projectId: null });
  });

  it("deletes a project (and its chats) from the sidebar", async () => {
    const project: Project = {
      id: "project_1",
      name: "demo",
      path: "/tmp/demo",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const session: Session = {
      id: "session_p1",
      projectId: project.id,
      title: "项目里的对话",
      providerId: "deepseek",
      accessMode: "approval",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const deleteProject = vi.fn(async () => true);
    const client = createClient({
      listProjects: vi.fn(async () => [project]),
      listSessions: vi.fn(async () => [session]),
      deleteProject
    });

    render(<App client={client} />);
    expect(await screen.findByText("项目里的对话")).toBeInTheDocument();

    fireEvent.click(screen.getByTitle("删除项目"));
    await waitFor(() => expect(deleteProject).toHaveBeenCalledWith("project_1"));
    expect(screen.queryByText("项目里的对话")).not.toBeInTheDocument();
    expect(screen.queryByText("demo")).not.toBeInTheDocument();
  });

  it("renames and deletes persisted sessions from the sidebar", async () => {
    const session: Session = {
      id: "session_1",
      projectId: null,
      title: "旧标题",
      providerId: "deepseek",
      accessMode: "approval",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const updateSession = vi.fn(async () => ({ ...session, title: "新标题" }));
    const deleteSession = vi.fn(async () => true);
    const client = createClient({
      listSessions: vi.fn(async () => [session]),
      updateSession,
      deleteSession
    });

    render(<App client={client} />);

    expect(await screen.findByText("旧标题")).toBeInTheDocument();
    fireEvent.click(screen.getByTitle("重命名"));
    fireEvent.change(screen.getByLabelText("会话标题"), {
      target: { value: "新标题" }
    });
    fireEvent.click(screen.getByTitle("保存标题"));
    expect(await screen.findByText("新标题")).toBeInTheDocument();
    expect(updateSession).toHaveBeenCalledWith("session_1", { title: "新标题" });

    fireEvent.click(screen.getByTitle("删除会话"));
    await waitFor(() => expect(deleteSession).toHaveBeenCalledWith("session_1"));
    expect(screen.queryByText("新标题")).not.toBeInTheDocument();
  });
});
