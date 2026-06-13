// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/renderer/App";
import type { ApiClient } from "../src/renderer/lib/api";
import { resetAppStore, useAppStore } from "../src/renderer/store";
import type {
  ActiveRunSnapshot,
  AppEvent,
  Message,
  Project,
  ProviderConfig,
  ProviderInput,
  RunRecord,
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
    renameProject: vi.fn() as never,
    setProjectPinned: vi.fn() as never,
    deleteProject: vi.fn(async () => true),
    listSessions: vi.fn(async () => []),
    listProjectFiles: vi.fn(async () => []),
    listProjectDirectory: vi.fn(async () => []),
    updateSession: vi.fn() as never,
    deleteSession: vi.fn() as never,
    getGitChanges: vi.fn(async () => ({ isRepo: false, files: [] })),
    listMessages: vi.fn(async () => []),
    rewindSession: vi.fn(async () => []),
    forkSession: vi.fn() as never,
    listSessionRuns: vi.fn(async () => ({ runs: [], toolCalls: [] })),
    listActiveRuns: vi.fn(async () => []),
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
    listSkills: vi.fn(async () => []),
    setMarketSkillEnabled: vi.fn(async () => []),
    importSkillFromUrl: vi.fn() as never,
    createCustomSkill: vi.fn() as never,
    deleteCustomSkill: vi.fn(async () => true),
    listProviders: vi.fn(async () => [provider]),
    saveProvider: vi.fn() as never,
    deleteProvider: vi.fn(async () => true),
    testProvider: vi.fn() as never,
    listProviderModels: vi.fn(async () => []),
    listProviderModelOptions: vi.fn(async () => []),
    getFeishuConfig: vi.fn(async () => ({ enabled: false, appId: "", domain: "feishu" as const, fullAccess: false })),
    saveFeishuConfig: vi.fn() as never,
    getFeishuStatus: vi.fn(async () => ({ status: "disconnected" as const })),
    listTasks: vi.fn(async () => []),
    updateTask: vi.fn() as never,
    deleteTask: vi.fn(async () => true),
    runTaskNow: vi.fn(async () => {}),
    approve: vi.fn() as never,
    abort: vi.fn() as never,
    terminalExec: vi.fn() as never,
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

    expect(await screen.findByAltText("程小帮人物")).toHaveClass(
      "home-mascot",
      "object-contain",
      "md:size-48"
    );
    expect(screen.getByTestId("home-hero-phrase")).toBeInTheDocument();
    expect(screen.queryByText("程小帮 · AI 工作台")).not.toBeInTheDocument();
    expect(await screen.findByText("做一份 PPT")).toBeInTheDocument();
    expect(screen.getByLabelText("输入消息")).toBeInTheDocument();
    expect(screen.getByTestId("composer-shell")).toHaveClass("rounded-xl");
    expect(screen.getByTestId("composer-shell")).not.toHaveClass("rounded-pill");
    // 模型选择器展示可读名称，不重复露出原始模型 id。
    expect(await screen.findByText("DeepSeek V4 Flash")).toBeInTheDocument();
    expect(screen.queryByText("DeepSeek · deepseek-v4-flash")).not.toBeInTheDocument();
  });

  it("uses rule-driven settings panels instead of nested cards", async () => {
    const client = createClient();

    render(<App client={client} />);

    fireEvent.click(await screen.findByText("设置"));
    fireEvent.click(await screen.findByText("供应商"));

    expect(await screen.findByTestId("settings-provider-list")).toHaveClass(
      "rounded-sm",
      "border"
    );
    expect(screen.getByTestId("settings-provider-form")).toHaveClass("rounded-sm", "border");
    expect(screen.getByTestId("settings-provider-list")).not.toHaveClass("rounded-md");
    expect(screen.getByTestId("settings-provider-form")).not.toHaveClass("rounded-md");
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
    expect(await screen.findByText("做一份 PPT")).toBeInTheDocument();
    expect(await screen.findByText("配置模型")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("粘贴你的 API Key")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "供应商" })).not.toBeInTheDocument();
  });

  it("saves one provider enabling all catalog models from the setup dialog", async () => {
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

    // 一个 API Key 只生成一条供应商配置，目录模型全部进入 models。
    await waitFor(() => expect(saveProvider).toHaveBeenCalledTimes(1));
    expect(saveProvider.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        kind: "deepseek",
        model: "deepseek-v4-flash",
        models: ["deepseek-v4-flash", "deepseek-v4-pro"],
        apiKey: "sk-test"
      })
    );
    await waitFor(() =>
      expect(screen.queryByText("配置模型")).not.toBeInTheDocument()
    );
  });

  it("switches UI language to English when the locale changes", async () => {
    const client = createClient();

    render(<App client={client} />);
    await screen.findByText("做一份 PPT");

    await act(async () => {
      useAppStore.getState().setLocale("en");
    });

    expect(await screen.findByText("Make a deck")).toBeInTheDocument();
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

    // 模拟用户上次停在对话视图后刷新：恢复时应回到被持久化的会话并带出历史消息。
    useAppStore.setState({ view: "chat", activeSessionId: session.id });
    render(<App client={client} />);

    expect(await screen.findByText("继续昨天的问题")).toBeInTheDocument();
    // 恢复的未分组会话平铺出现在侧边栏的"对话"区块下。
    expect(within(screen.getByTestId("app-sidebar")).getByText("昨天的对话")).toBeInTheDocument();
  });

  it("stays on home after refresh instead of forcing the last session into chat", async () => {
    const session: Session = {
      id: "session_1",
      projectId: null,
      title: "昨天的对话",
      providerId: "deepseek",
      accessMode: "approval",
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
    const listSessionRuns = vi.fn(async () => ({ runs: [], toolCalls: [] }));
    const client = createClient({
      listSessions: vi.fn(async () => [session]),
      listMessages: vi.fn(async () => [message]),
      listSessionRuns
    });

    // 首页没有被持久化选中的会话，刷新后也不应拿列表第一条当作当前会话。
    render(<App client={client} />);

    expect(await screen.findByText("做一份 PPT")).toBeInTheDocument();
    await waitFor(() => expect(client.listSlashCommands).toHaveBeenCalled());
    await act(async () => {
      await Promise.resolve();
    });

    // 首页保持原位，也不会在后台选中列表第一条会话。
    expect(screen.getByText("做一份 PPT")).toBeInTheDocument();
    expect(screen.queryByText("继续昨天的问题")).not.toBeInTheDocument();
    expect(useAppStore.getState().activeSessionId).toBeUndefined();
    expect(listSessionRuns).not.toHaveBeenCalled();
    // 会话仍显示在侧边栏，随时可从侧边栏进入。
    expect(within(screen.getByTestId("app-sidebar")).getByText("昨天的对话")).toBeInTheDocument();
  });

  it("keeps project home refresh from highlighting the first project session", async () => {
    const project: Project = {
      id: "project_1",
      name: "chengxiaobang",
      path: "/tmp/chengxiaobang",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const session: Session = {
      id: "session_project_1",
      projectId: project.id,
      title: "帮我分析一下这个项目。",
      providerId: "deepseek",
      accessMode: "approval",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const listSessionRuns = vi.fn(async () => ({ runs: [], toolCalls: [] }));
    const listSlashCommands = vi.fn(async () => ({
      commands: [],
      diagnostics: []
    }));
    const client = createClient({
      listProjects: vi.fn(async () => [project]),
      listSessions: vi.fn(async () => [session]),
      listSessionRuns,
      listSlashCommands
    });

    const activeSnapshots: Array<string | undefined> = [];
    const unsubscribe = useAppStore.subscribe((state) => {
      if (state.sessions.length > 0) {
        activeSnapshots.push(state.activeSessionId);
      }
    });
    useAppStore.setState({
      view: "home",
      activeProjectId: project.id,
      activeSessionId: session.id
    });
    render(<App client={client} />);

    const sidebar = within(await screen.findByTestId("app-sidebar"));
    const projectSession = await sidebar.findByText("帮我分析一下这个项目。");
    await waitFor(() => expect(listSlashCommands).toHaveBeenCalledWith(project.id));

    expect(useAppStore.getState().activeSessionId).toBeUndefined();
    expect(activeSnapshots).not.toContain(session.id);
    expect(projectSession.closest("div")).not.toHaveClass("bg-surface-hover");
    expect(listSessionRuns).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("keeps long sidebar project names constrained with ellipsis", async () => {
    const longName = "2022-Machine-Learning-Specialization-Super-Long-Workspace-Name";
    const project: Project = {
      id: "project_long",
      name: longName,
      path: "/tmp/2022-Machine-Learning-Specialization-Super-Long-Workspace-Name",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const client = createClient({
      listProjects: vi.fn(async () => [project])
    });

    render(<App client={client} />);

    const sidebar = within(await screen.findByTestId("app-sidebar"));
    const label = await sidebar.findByText(longName);

    expect(label).toHaveClass("block", "min-w-0", "max-w-[174px]", "truncate");
    expect(label).toHaveAttribute("title", longName);
    expect(label.closest("button")).toHaveClass("w-full", "min-w-0", "max-w-full", "flex-1");
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

    // 模拟用户上次停在对话视图后刷新：工具调用历史应随会话一起恢复。
    useAppStore.setState({ view: "chat", activeSessionId: session.id });
    render(<App client={client} />);

    // The row is a clean one-liner with a human-readable description; the raw
    // result only appears once expanded (no noisy collapsed preview).
    expect(await screen.findByText("浏览目录 .")).toBeInTheDocument();
    expect(screen.queryByText("list_directory")).not.toBeInTheDocument();
    expect(screen.queryByText("completed")).not.toBeInTheDocument();
    expect(screen.queryByText("file package.json")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("浏览目录 ."));
    expect(await screen.findByText("file package.json")).toBeInTheDocument();
    expect(listSessionRuns).toHaveBeenCalledWith("session_1");
  });

  it("restores a pending approval from the backend active run snapshot after refresh", async () => {
    const session: Session = {
      id: "session_1",
      projectId: null,
      title: "审批恢复",
      providerId: "deepseek",
      accessMode: "approval",
      createdAt: "2026-06-13T00:00:00.000Z",
      updatedAt: "2026-06-13T00:00:01.000Z"
    };
    const activeRun: ActiveRunSnapshot["run"] = {
      id: "run_active",
      sessionId: session.id,
      status: "running",
      createdAt: "2026-06-13T00:00:00.000Z",
      updatedAt: "2026-06-13T00:00:01.000Z"
    };
    const pendingTool: ToolCall = {
      id: "tool_pending",
      runId: activeRun.id,
      name: "write_file",
      args: { path: "active.txt", content: "ok" },
      status: "pending_approval",
      createdAt: "2026-06-13T00:00:01.000Z",
      updatedAt: "2026-06-13T00:00:01.000Z"
    };
    const approve = vi.fn(async () => {});
    const client = createClient({
      listSessions: vi.fn(async () => [session]),
      listMessages: vi.fn(async () => []),
      listSessionRuns: vi.fn(async () => ({ runs: [activeRun], toolCalls: [pendingTool] })),
      listActiveRuns: vi.fn(async () => [{ run: activeRun, toolCalls: [pendingTool] }]),
      approve: approve as never
    });

    useAppStore.setState({ view: "chat", activeSessionId: session.id });
    render(<App client={client} />);

    const dock = await screen.findByTestId("approval-dock");
    expect(within(dock).getByText("等待批准")).toBeInTheDocument();
    expect(within(dock).getByText("active.txt")).toBeInTheDocument();
    expect(useAppStore.getState().activeRunId).toBe(activeRun.id);
    expect(useAppStore.getState().pendingTool?.id).toBe(pendingTool.id);
    expect(useAppStore.getState().toolHistory.some((tool) => tool.id === pendingTool.id)).toBe(
      false
    );

    fireEvent.click(within(dock).getByRole("button", { name: /允许/ }));

    await waitFor(() =>
      expect(approve).toHaveBeenCalledWith(pendingTool.id, { approved: true })
    );
  });

  it("settles stale pending approvals when refresh finds no backend active snapshot", async () => {
    const session: Session = {
      id: "session_1",
      projectId: null,
      title: "遗留审批",
      providerId: "deepseek",
      accessMode: "approval",
      createdAt: "2026-06-13T00:00:00.000Z",
      updatedAt: "2026-06-13T00:00:01.000Z"
    };
    const staleRun: ActiveRunSnapshot["run"] = {
      id: "run_stale",
      sessionId: session.id,
      status: "running",
      createdAt: "2026-06-13T00:00:00.000Z",
      updatedAt: "2026-06-13T00:00:01.000Z"
    };
    const pendingTool: ToolCall = {
      id: "tool_stale_pending",
      runId: staleRun.id,
      name: "shell",
      args: { command: "python3 - <<'PY'\nprint('hi')\nPY" },
      status: "pending_approval",
      createdAt: "2026-06-13T00:00:01.000Z",
      updatedAt: "2026-06-13T00:00:01.000Z"
    };
    const listActiveRuns = vi.fn(async () => []);
    const client = createClient({
      listSessions: vi.fn(async () => [session]),
      listMessages: vi.fn(async () => []),
      listSessionRuns: vi.fn(async () => ({ runs: [staleRun], toolCalls: [pendingTool] })),
      listActiveRuns
    });

    useAppStore.setState({
      view: "chat",
      activeSessionId: session.id,
      activeRunId: staleRun.id,
      isRunning: true,
      pendingTool
    });
    render(<App client={client} />);

    await waitFor(() =>
      expect(useAppStore.getState().runHistory[0]?.status).toBe("failed")
    );
    expect(listActiveRuns).toHaveBeenCalledWith(session.id);
    expect(screen.queryByTestId("approval-dock")).not.toBeInTheDocument();
    expect(useAppStore.getState().pendingTool).toBeUndefined();
    expect(useAppStore.getState().activeRunId).toBeUndefined();
    expect(useAppStore.getState().isRunning).toBe(false);
    expect(useAppStore.getState().toolHistory[0]).toMatchObject({
      id: pendingTool.id,
      status: "failed",
      result: expect.stringContaining("运行进程已重启")
    });
  });

  it("offers retry for an interrupted failed run at the conversation tail", async () => {
    const session: Session = {
      id: "session_retry",
      projectId: null,
      title: "可重试会话",
      providerId: "deepseek",
      accessMode: "approval",
      createdAt: "2026-06-13T00:00:00.000Z",
      updatedAt: "2026-06-13T00:00:02.000Z"
    };
    const userMessage: Message = {
      id: "msg_retry",
      sessionId: session.id,
      role: "user",
      content: "把这个页面做得更高级一点",
      createdAt: "2026-06-13T00:00:00.500Z"
    };
    const failedRun: RunRecord = {
      id: "run_interrupted",
      sessionId: session.id,
      status: "failed",
      error: "运行进程已重启，无法继续等待审批或工具结果。请重新发起本次请求。",
      createdAt: "2026-06-13T00:00:00.000Z",
      updatedAt: "2026-06-13T00:00:01.000Z"
    };
    const skillTool: ToolCall = {
      id: "tool_skill_ppt",
      runId: failedRun.id,
      name: "use_skill",
      args: { name: "ppt" },
      status: "completed",
      result: "已加载技能 ppt",
      createdAt: "2026-06-13T00:00:00.700Z",
      updatedAt: "2026-06-13T00:00:00.800Z"
    };
    const listMessages = vi
      .fn()
      .mockResolvedValueOnce([userMessage])
      .mockResolvedValue([]);
    const listSessionRuns = vi
      .fn()
      .mockResolvedValueOnce({ runs: [failedRun], toolCalls: [skillTool] })
      .mockResolvedValue({ runs: [], toolCalls: [] });
    const rewindSession = vi.fn(async () => [] as Message[]);
    const streamRun = vi.fn(async (..._args: Parameters<ApiClient["streamRun"]>) => {});
    const client = createClient({
      listSessions: vi.fn(async () => [session]),
      listMessages,
      listSessionRuns,
      listActiveRuns: vi.fn(async () => []),
      rewindSession,
      streamRun: streamRun as never
    });

    useAppStore.setState({
      view: "chat",
      activeSessionId: session.id,
      events: [
        {
          type: "run_end",
          runId: failedRun.id,
          status: "failed",
          error: failedRun.error
        }
      ]
    });
    render(<App client={client} />);

    expect(await screen.findByText("已加载技能 ppt")).toBeInTheDocument();
    expect(await screen.findByTestId("run-error-notice")).toHaveTextContent(
      "运行进程已重启"
    );
    fireEvent.click(await screen.findByRole("button", { name: "重试本次请求" }));

    await waitFor(() => expect(rewindSession).toHaveBeenCalledWith(session.id, userMessage.id));
    await waitFor(() => expect(screen.queryByTestId("run-error-notice")).not.toBeInTheDocument());
    await waitFor(() => expect(screen.queryByText("已加载技能 ppt")).not.toBeInTheDocument());
    await waitFor(() => expect(streamRun).toHaveBeenCalled());
    expect(streamRun.mock.calls[0]?.[0]).toMatchObject({
      sessionId: session.id,
      prompt: userMessage.content
    });
  });

  it("continues handling global run events after restoring an active run snapshot", async () => {
    let emit: ((event: AppEvent) => void) | undefined;
    const session: Session = {
      id: "session_1",
      projectId: null,
      title: "续流恢复",
      providerId: "deepseek",
      accessMode: "approval",
      createdAt: "2026-06-13T00:00:00.000Z",
      updatedAt: "2026-06-13T00:00:01.000Z"
    };
    const activeRun: ActiveRunSnapshot["run"] = {
      id: "run_active",
      sessionId: session.id,
      status: "running",
      createdAt: "2026-06-13T00:00:00.000Z",
      updatedAt: "2026-06-13T00:00:01.000Z"
    };
    const pendingTool: ToolCall = {
      id: "tool_pending",
      runId: activeRun.id,
      name: "write_file",
      args: { path: "active.txt", content: "ok" },
      status: "pending_approval",
      createdAt: "2026-06-13T00:00:01.000Z",
      updatedAt: "2026-06-13T00:00:01.000Z"
    };
    const runningTool: ToolCall = {
      ...pendingTool,
      status: "running",
      startedAt: "2026-06-13T00:00:02.000Z",
      updatedAt: "2026-06-13T00:00:02.000Z"
    };
    const completedTool: ToolCall = {
      ...runningTool,
      status: "completed",
      result: "写入完成",
      updatedAt: "2026-06-13T00:00:03.000Z"
    };
    const listActiveRuns = vi
      .fn()
      .mockResolvedValueOnce([{ run: activeRun, toolCalls: [pendingTool] }])
      .mockResolvedValue([]);
    const listSessionRuns = vi
      .fn()
      .mockResolvedValueOnce({ runs: [activeRun], toolCalls: [pendingTool] })
      .mockResolvedValue({
        runs: [{ ...activeRun, status: "completed" as const }],
        toolCalls: [completedTool]
      });
    const client = createClient({
      listSessions: vi.fn(async () => [session]),
      listMessages: vi.fn(async () => []),
      listSessionRuns,
      listActiveRuns,
      subscribeAppEvents: vi.fn((listener: (event: AppEvent) => void) => {
        emit = listener;
        return vi.fn();
      })
    });

    useAppStore.setState({ view: "chat", activeSessionId: session.id });
    render(<App client={client} />);
    await screen.findByTestId("approval-dock");

    act(() => {
      emit?.({ type: "tool_call", runId: activeRun.id, toolCall: runningTool });
    });
    await waitFor(() => expect(useAppStore.getState().pendingTool).toBeUndefined());
    expect(useAppStore.getState().runningTool?.id).toBe(runningTool.id);

    act(() => {
      emit?.({ type: "tool_call", runId: activeRun.id, toolCall: completedTool });
      emit?.({ type: "run_end", runId: activeRun.id, status: "completed" });
    });

    await waitFor(() => expect(useAppStore.getState().isRunning).toBe(false));
    expect(useAppStore.getState().activeRunId).toBeUndefined();
    expect(useAppStore.getState().pendingTool).toBeUndefined();
    await waitFor(() => expect(listSessionRuns).toHaveBeenCalledTimes(2));
  });

  it("keeps failed run errors visible after restoring an active session", async () => {
    const session: Session = {
      id: "session_1",
      projectId: null,
      title: "超限会话",
      providerId: "deepseek",
      accessMode: "approval",
      createdAt: "2026-06-08T00:00:00.000Z",
      updatedAt: "2026-06-08T00:00:02.000Z"
    };
    const message: Message = {
      id: "msg_1",
      sessionId: session.id,
      role: "user",
      content: "读取所有文件",
      createdAt: "2026-06-08T00:00:00.000Z"
    };
    const retryMessage: Message = {
      id: "msg_2",
      sessionId: session.id,
      role: "user",
      content: "继续",
      createdAt: "2026-06-08T00:00:03.000Z"
    };
    const client = createClient({
      listSessions: vi.fn(async () => [session]),
      listMessages: vi.fn(async () => [message, retryMessage]),
      listSessionRuns: vi.fn(async () => ({
        runs: [
          {
            id: "run_1",
            sessionId: session.id,
            status: "failed" as const,
            error: "400 Invalid request: token limit",
            createdAt: "2026-06-08T00:00:00.000Z",
            updatedAt: "2026-06-08T00:00:02.000Z"
          }
        ],
        toolCalls: []
      }))
    });

    useAppStore.setState({ view: "chat", activeSessionId: session.id });
    render(<App client={client} />);

    const notice = await screen.findByTestId("run-error-notice");
    expect(notice).toHaveTextContent("400 Invalid request: token limit");
    expect(
      screen.getByText("读取所有文件").compareDocumentPosition(notice) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      notice.compareDocumentPosition(screen.getByText("继续")) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(screen.getByLabelText("输入消息")).toBeInTheDocument();
  });

  it("renders btw tool calls as aside notes and converts one into a composer draft", async () => {
    const session: Session = {
      id: "session_1",
      projectId: null,
      title: "旁注测试",
      providerId: "deepseek",
      accessMode: "approval",
      createdAt: "2026-06-08T00:00:00.000Z",
      updatedAt: "2026-06-08T00:00:05.000Z"
    };
    const message: Message = {
      id: "msg_1",
      sessionId: session.id,
      role: "user",
      content: "检查一下项目",
      createdAt: "2026-06-08T00:00:00.000Z"
    };
    const btw = (id: string, note: string, index: number, suggestion?: string): ToolCall => ({
      id,
      runId: "run_1",
      name: "btw",
      args: suggestion ? { note, suggestion } : { note },
      status: "completed",
      result: "已记录旁注",
      createdAt: `2026-06-08T00:00:0${index}.000Z`,
      updatedAt: `2026-06-08T00:00:0${index}.000Z`
    });
    const toolCalls = [
      btw("tool_btw_1", "测试目录缺少覆盖率配置", 1, "补一个 vitest coverage"),
      btw("tool_btw_2", "旧 util 可以后续清理", 2),
      btw("tool_btw_3", "README 示例有点旧", 3),
      btw("tool_btw_4", "设置页文案可以统一", 4)
    ];
    const client = createClient({
      listSessions: vi.fn(async () => [session]),
      listMessages: vi.fn(async () => [message]),
      listSessionRuns: vi.fn(async () => ({
        runs: [
          {
            id: "run_1",
            sessionId: session.id,
            status: "completed" as const,
            createdAt: "2026-06-08T00:00:00.000Z",
            updatedAt: "2026-06-08T00:00:05.000Z"
          }
        ],
        toolCalls
      }))
    });

    useAppStore.setState({ view: "chat", activeSessionId: session.id });
    render(<App client={client} />);

    expect(await screen.findByText("测试目录缺少覆盖率配置")).toBeInTheDocument();
    Object.defineProperty(screen.getByTestId("chat-scroll"), "clientWidth", {
      configurable: true,
      value: 1200
    });
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });

    await waitFor(() =>
      expect(screen.getByText("测试目录缺少覆盖率配置").closest("aside")).toHaveAttribute(
        "data-layout",
        "gutter-wide"
      )
    );
    const contentColumn = screen.getByTestId("chat-content-column");
    const composerColumn = screen.getByTestId("chat-composer-column");
    expect(contentColumn).toHaveClass("chat-primary-column");
    expect(composerColumn).toHaveClass("chat-primary-column");
    expect(screen.getByTestId("chat-aside-overlay")).toBeInTheDocument();
    const anchors = screen.getAllByTestId("chat-aside-anchor");
    expect(anchors).toHaveLength(3);
    for (const anchor of anchors) {
      expect(anchor).toHaveClass("h-0");
    }
    expect(screen.getByText("建议：补一个 vitest coverage")).toBeInTheDocument();
    expect(screen.getByText("旧 util 可以后续清理")).toBeInTheDocument();
    expect(screen.getByText("旁注 × 2")).toBeInTheDocument();
    expect(screen.queryByText("README 示例有点旧")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("旁注 × 2"));
    expect(await screen.findByText("README 示例有点旧")).toBeInTheDocument();
    expect(screen.getByText("设置页文案可以统一")).toBeInTheDocument();

    fireEvent.click(screen.getAllByText("转为任务")[0]);
    expect(screen.getByLabelText("输入消息")).toHaveValue(
      "接下来：测试目录缺少覆盖率配置（建议：补一个 vitest coverage）"
    );
    expect(screen.getByText("已转")).toHaveAttribute("aria-label", "已转为任务");
  });

  it("renders a reasoning-only turn as a settled panel before the tools it preceded", async () => {
    const session: Session = {
      id: "session_1",
      projectId: null,
      title: "先想后做",
      providerId: "deepseek",
      accessMode: "approval",
      createdAt: "2026-06-08T00:00:00.000Z",
      updatedAt: "2026-06-08T00:00:03.000Z"
    };
    const messages: Message[] = [
      {
        id: "msg_user",
        sessionId: session.id,
        role: "user",
        content: "做个表格",
        createdAt: "2026-06-08T00:00:00.000Z"
      },
      {
        // 思考后直接调工具的轮次：正文为空、只带 reasoning。
        id: "msg_reasoning",
        sessionId: session.id,
        role: "assistant",
        content: "",
        reasoning: "先想清楚要加载哪个技能",
        reasoningMs: 12000,
        createdAt: "2026-06-08T00:00:01.000Z"
      },
      {
        // 工具之间的过渡叙述：带 durationMs 但不应展示「用时」脚注。
        id: "msg_narration",
        sessionId: session.id,
        role: "assistant",
        content: "我先加载 excel 技能。",
        durationMs: 5000,
        createdAt: "2026-06-08T00:00:01.500Z"
      }
    ];
    const toolCall: ToolCall = {
      id: "tool_1",
      runId: "run_1",
      name: "use_skill",
      args: { name: "excel" },
      status: "completed",
      createdAt: "2026-06-08T00:00:02.000Z",
      updatedAt: "2026-06-08T00:00:02.000Z"
    };
    const client = createClient({
      listSessions: vi.fn(async () => [session]),
      listMessages: vi.fn(async () => messages),
      listSessionRuns: vi.fn(async () => ({
        runs: [
          {
            id: "run_1",
            sessionId: session.id,
            status: "completed" as const,
            createdAt: "2026-06-08T00:00:00.000Z",
            updatedAt: "2026-06-08T00:00:03.000Z"
          }
        ],
        toolCalls: [toolCall]
      }))
    });

    useAppStore.setState({ view: "chat", activeSessionId: session.id });
    render(<App client={client} />);

    const panel = await screen.findByText("已深度思考 · 用时 12 秒");
    const skillChip = await screen.findByText("已加载技能 excel");
    // 思考发生在加载技能之前，DOM 顺序必须一致：面板在前、chip 在后。
    expect(
      panel.compareDocumentPosition(skillChip) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    // 纯思考轮不渲染正文气泡的操作按钮。
    expect(screen.queryByTitle("重新生成")).not.toBeInTheDocument();
    // 后面紧跟工具的过渡叙述不显示「用时」脚注。
    expect(screen.getByText("我先加载 excel 技能。")).toBeInTheDocument();
    expect(screen.queryByText("用时 5 秒")).not.toBeInTheDocument();
  });

  it("docks a pending approval above the composer instead of the message stream", async () => {
    let resolveStream: (() => void) | undefined;
    const client = createClient({
      streamRun: vi.fn(async (_input, onEvent) => {
        onEvent({ type: "run_started", runId: "run_1", sessionId: "session_1" });
        onEvent({
          type: "tool_call",
          runId: "run_1",
          toolCall: {
            id: "tool_1",
            runId: "run_1",
            name: "shell",
            args: { command: "rm -rf dist" },
            status: "pending_approval",
            createdAt: "2026-06-13T00:00:00.000Z",
            updatedAt: "2026-06-13T00:00:00.000Z"
          }
        });
        return new Promise<void>((resolve) => {
          resolveStream = resolve;
        });
      })
    });

    render(<App client={client} />);

    fireEvent.change(await screen.findByLabelText("输入消息"), {
      target: { value: "清理构建产物" }
    });
    fireEvent.click(screen.getByTitle("发送"));

    const dock = await screen.findByTestId("approval-dock");
    expect(within(dock).getByText("等待批准")).toBeInTheDocument();
    expect(within(dock).getByText("运行 rm -rf dist")).toBeInTheDocument();
    // 审批卡不再出现在消息流里，待审批工具也不进时间线。
    const stream = screen.getByTestId("chat-scroll");
    expect(within(stream).queryByText("等待批准")).not.toBeInTheDocument();
    expect(within(stream).queryByText("运行 rm -rf dist")).not.toBeInTheDocument();
    resolveStream?.();
  });

  it("shows a single preparing activity and then relies on the timeline tool row", async () => {
    type StreamRunEvent = Parameters<ApiClient["streamRun"]>[1] extends (
      event: infer E
    ) => void
      ? E
      : never;
    let emit: ((event: StreamRunEvent) => void) | undefined;
    let resolveStream: (() => void) | undefined;
    const runningTool: ToolCall = {
      id: "tool_1",
      runId: "run_1",
      name: "write_file",
      args: { path: "out.txt", content: "完整内容不应出现在状态条里" },
      status: "running",
      startedAt: "2026-06-13T00:00:01.000Z",
      createdAt: "2026-06-13T00:00:00.000Z",
      updatedAt: "2026-06-13T00:00:01.000Z"
    };
    const client = createClient({
      streamRun: vi.fn(async (_input, onEvent) => {
        emit = onEvent;
        onEvent({ type: "run_started", runId: "run_1", sessionId: "session_1" });
        onEvent({
          type: "tool_activity",
          runId: "run_1",
          activity: {
            contentIndex: 0,
            toolCallId: "tool_1",
            name: "write_file",
            argsPreview: { path: "out.txt" },
            updatedAt: "2026-06-13T00:00:00.500Z"
          }
        });
        return new Promise<void>((resolve) => {
          resolveStream = resolve;
        });
      })
    });

    render(<App client={client} />);

    fireEvent.change(await screen.findByLabelText("输入消息"), {
      target: { value: "写一个很大的文件" }
    });
    fireEvent.click(screen.getByTitle("发送"));

    await waitFor(() => {
      const statuses = screen.getAllByTestId("tool-activity-status");
      expect(statuses).toHaveLength(1);
      expect(statuses[0]).toHaveTextContent("正在准备工具调用：写入 out.txt");
    });
    expect(screen.queryByText("正在思考…")).not.toBeInTheDocument();

    act(() => {
      emit?.({ type: "tool_call", runId: "run_1", toolCall: runningTool });
    });

    await waitFor(() =>
      expect(screen.queryByTestId("tool-activity-status")).not.toBeInTheDocument()
    );
    expect(screen.queryByText(/正在调用工具/)).not.toBeInTheDocument();
    expect(screen.getByText("写入 out.txt")).toBeInTheDocument();
    expect(screen.queryByText(/完整内容/)).not.toBeInTheDocument();
    resolveStream?.();
  });

  it("can abort a running stream from the composer", async () => {
    let emit: ((event: Parameters<ApiClient["streamRun"]>[1] extends (event: infer E) => void ? E : never) => void) | undefined;
    let resolveStream: (() => void) | undefined;
    const abort = vi.fn(async () => {
      emit?.({ type: "run_end", runId: "run_1", status: "aborted" });
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

  it("updates the sidebar title as soon as session_updated arrives mid-run", async () => {
    let resolveStream: (() => void) | undefined;
    const client = createClient({
      streamRun: vi.fn(async (_input, onEvent) => {
        onEvent({ type: "run_started", runId: "run_1", sessionId: "session_1" });
        onEvent({
          type: "session_updated",
          runId: "run_1",
          session: {
            id: "session_1",
            projectId: null,
            title: "修复登录报错",
            providerId: "deepseek",
            accessMode: "approval",
            createdAt: "2026-06-12T00:00:00.000Z",
            updatedAt: "2026-06-12T00:00:00.000Z"
          }
        });
        return new Promise<void>((resolve) => {
          resolveStream = resolve;
        });
      })
    });

    render(<App client={client} />);

    fireEvent.change(await screen.findByLabelText("输入消息"), {
      target: { value: "登录页面报错了，帮我看看" }
    });
    fireEvent.click(screen.getByTitle("发送"));

    // run_end 尚未到达，AI 标题已经出现在侧边栏（不等收尾后的整表刷新）。
    expect(
      await within(screen.getByTestId("app-sidebar")).findByText("修复登录报错")
    ).toBeInTheDocument();
    resolveStream?.();
  });

  it("shows a loading marker on the running sidebar session", async () => {
    let emit: ((event: AppEvent) => void) | undefined;
    const session: Session = {
      id: "session_1",
      projectId: null,
      title: "AI 日报会话",
      providerId: "deepseek",
      accessMode: "approval",
      createdAt: "2026-06-13T00:00:00.000Z",
      updatedAt: "2026-06-13T00:00:00.000Z"
    };
    const client = createClient({
      listSessions: vi.fn(async () => [session]),
      subscribeAppEvents: vi.fn((listener: (event: AppEvent) => void) => {
        emit = listener;
        return vi.fn();
      })
    });

    render(<App client={client} />);
    const sidebar = within(await screen.findByTestId("app-sidebar"));
    await sidebar.findByText("AI 日报会话");

    act(() => {
      emit?.({
        type: "scheduled_task_started",
        taskId: "task_1",
        sessionId: "session_1",
        name: "AI 日报",
        trigger: "schedule",
        occurredAt: "2026-06-13T01:00:00.000Z"
      });
    });
    expect(sidebar.getByTitle("正在处理")).toBeInTheDocument();

    act(() => {
      emit?.({
        type: "scheduled_task_finished",
        taskId: "task_1",
        sessionId: "session_1",
        name: "AI 日报",
        trigger: "schedule",
        status: "completed",
        occurredAt: "2026-06-13T01:01:00.000Z"
      });
    });
    await waitFor(() => expect(sidebar.queryByTitle("正在处理")).not.toBeInTheDocument());
  });

  it("shows a top-right toast when a scheduled task finishes", async () => {
    let emit: ((event: AppEvent) => void) | undefined;
    const client = createClient({
      subscribeAppEvents: vi.fn((listener: (event: AppEvent) => void) => {
        emit = listener;
        return vi.fn();
      })
    });

    render(<App client={client} />);
    await waitFor(() => expect(client.listProjects).toHaveBeenCalled());

    act(() => {
      emit?.({
        type: "scheduled_task_finished",
        taskId: "task_1",
        sessionId: "session_1",
        name: "AI 日报",
        trigger: "schedule",
        status: "failed",
        error: "模型超时",
        occurredAt: "2026-06-13T01:01:00.000Z"
      });
    });

    expect(await screen.findByText("定时任务「AI 日报」失败")).toBeInTheDocument();
    expect(screen.getByText("错误：模型超时")).toBeInTheDocument();
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

  it("suggests project files when typing @ in a project session", async () => {
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
      title: "项目会话",
      providerId: "deepseek",
      accessMode: "approval",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const listProjectFiles = vi.fn(async () => ["src/index.ts", "src/main-index.ts"]);
    const client = createClient({
      listProjects: vi.fn(async () => [project]),
      listSessions: vi.fn(async () => [session]),
      listProjectFiles
    });

    // Seed the chat view so the restored project session lands in conversation
    // (a refresh keeps the user wherever they were); the composer remounts there.
    useAppStore.setState({ view: "chat", activeSessionId: session.id });
    render(<App client={client} />);
    // Wait for the chat-only scroll area so we grab the live composer instance.
    await screen.findByTestId("chat-scroll");
    const input = await screen.findByLabelText("输入消息");

    fireEvent.change(input, { target: { value: "看看 @ind" } });

    // The fetch is debounced (150ms); findByText absorbs the wait.
    expect(await screen.findByText("src/index.ts")).toBeInTheDocument();
    expect(listProjectFiles).toHaveBeenCalledWith("project_1", "ind");

    fireEvent.click(screen.getByText("src/index.ts"));
    expect(input).toHaveValue("看看 @src/index.ts ");
  });

  it("does not fetch file suggestions without an active project", async () => {
    const listProjectFiles = vi.fn(async () => ["src/index.ts"]);
    const client = createClient({ listProjectFiles });

    render(<App client={client} />);
    const input = await screen.findByLabelText("输入消息");

    fireEvent.change(input, { target: { value: "@ind" } });
    await new Promise((resolve) => setTimeout(resolve, 250));

    expect(listProjectFiles).not.toHaveBeenCalled();
    expect(screen.queryByText("src/index.ts")).not.toBeInTheDocument();
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
    await screen.findByText("做一份 PPT");

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
    await screen.findByText("做一份 PPT");

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

    const projectName = screen.getAllByText("demo")[0];
    fireEvent.contextMenu(projectName);
    fireEvent.click(await screen.findByText("删除项目"));
    const dialog = await screen.findByRole("alertdialog");
    expect(
      within(dialog).getByText("确定删除该项目及其全部对话？项目目录中的文件不会被删除。")
    ).toBeInTheDocument();
    expect(window.confirm).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "删除" }));
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
    fireEvent.contextMenu(screen.getByText("旧标题"));
    fireEvent.click(await screen.findByText("重命名"));
    fireEvent.change(screen.getByLabelText("会话标题"), {
      target: { value: "新标题" }
    });
    fireEvent.click(screen.getByTitle("保存标题"));
    expect(await screen.findByText("新标题")).toBeInTheDocument();
    expect(updateSession).toHaveBeenCalledWith("session_1", { title: "新标题" });

    fireEvent.contextMenu(screen.getByText("新标题"));
    fireEvent.click(await screen.findByText("删除会话"));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("确定删除该对话？")).toBeInTheDocument();
    expect(window.confirm).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "删除" }));
    await waitFor(() => expect(deleteSession).toHaveBeenCalledWith("session_1"));
    expect(screen.queryByText("新标题")).not.toBeInTheDocument();
  });

  it("renders a compaction summary as a collapsible system card", async () => {
    const session: Session = {
      id: "session_1",
      projectId: null,
      title: "压缩过的会话",
      providerId: "deepseek",
      accessMode: "approval",
      createdAt: "2026-06-08T00:00:00.000Z",
      updatedAt: "2026-06-08T00:00:02.000Z"
    };
    const summary: Message = {
      id: "m_summary",
      sessionId: session.id,
      role: "assistant",
      kind: "compaction_summary",
      content: "此前讨论了登录模块重构",
      createdAt: "2026-06-08T00:00:01.000Z"
    };
    const client = createClient({
      listSessions: vi.fn(async () => [session]),
      listMessages: vi.fn(async () => [summary])
    });

    // 模拟用户上次停在对话视图后刷新：压缩摘要随会话历史一起恢复。
    useAppStore.setState({ view: "chat", activeSessionId: session.id });
    render(<App client={client} />);

    // The card header replaces the plain assistant bubble...
    expect(await screen.findByText("上下文已压缩")).toBeInTheDocument();
    expect(screen.queryByText("此前讨论了登录模块重构")).not.toBeInTheDocument();
    // ...and the summary body expands on demand.
    fireEvent.click(screen.getByText("上下文已压缩"));
    expect(await screen.findByText("此前讨论了登录模块重构")).toBeInTheDocument();
  });

  it("captures streamed reasoning and renders the answer as plain content", async () => {
    const userMessage: Message = {
      id: "u1",
      sessionId: "session_1",
      role: "user",
      content: "你好",
      createdAt: "2026-06-08T00:00:00.000Z"
    };
    const assistantMessage: Message = {
      id: "a1",
      sessionId: "session_1",
      role: "assistant",
      content: "答案是 42",
      reasoning: "先拆解问题",
      reasoningMs: 1200,
      durationMs: 3400,
      createdAt: "2026-06-08T00:00:01.000Z"
    };
    const client = createClient({
      // Returned by the post-run reload so the captured reasoning stays attached.
      listMessages: vi.fn(async () => [userMessage, assistantMessage]),
      streamRun: vi.fn(async (_input, onEvent) => {
        onEvent({ type: "run_started", runId: "run_1", sessionId: "session_1" });
        onEvent({ type: "message", runId: "run_1", message: userMessage });
        onEvent({ type: "delta", channel: "thinking", runId: "run_1", delta: "先拆解" });
        onEvent({ type: "delta", channel: "thinking", runId: "run_1", delta: "问题" });
        onEvent({ type: "delta", channel: "text", runId: "run_1", delta: "答案是 42" });
        onEvent({ type: "message", runId: "run_1", message: assistantMessage });
        onEvent({ type: "run_end", runId: "run_1", status: "completed" });
      }) as never
    });

    render(<App client={client} />);
    fireEvent.change(await screen.findByLabelText("输入消息"), { target: { value: "你好" } });
    fireEvent.click(screen.getByTitle("发送"));

    // The answer renders as plain content (no assistant avatar/name label)...
    expect(await screen.findByText("答案是 42")).toBeInTheDocument();
    // ...and the streamed reasoning is captured into a collapsible panel.
    expect(await screen.findByText(/已深度思考/)).toBeInTheDocument();
    expect(screen.getByText("先拆解问题")).toBeInTheDocument();
    // 单轮耗时仍可持久化，但聊天正文下方不再展示耗时脚注。
    expect(screen.queryByText("用时 3 秒")).not.toBeInTheDocument();
  });
});
