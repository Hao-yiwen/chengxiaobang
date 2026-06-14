// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/renderer/App";
import type { ApiClient } from "../src/renderer/lib/api";
import { resetAppStore, useAppStore } from "../src/renderer/store";
import type { Project, ProviderConfig, ScheduledTask, Session } from "@chengxiaobang/shared";

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

const task: ScheduledTask = {
  id: "task_1",
  sessionId: "session_1",
  name: "AI 日报",
  prompt: "生成今天的 AI 日报",
  kind: "recurring",
  cron: "0 9 * * *",
  fullAccess: false,
  enabled: true,
  nextRunAt: "2026-06-14T01:00:00.000Z",
  lastRunAt: "2026-06-13T01:00:00.000Z",
  lastStatus: "completed",
  createdAt: "2026-06-12T00:00:00.000Z",
  updatedAt: "2026-06-13T01:00:00.000Z"
};

const expiredTask: ScheduledTask = {
  id: "task_expired",
  sessionId: "session_1",
  name: "一次性提醒",
  prompt: "提醒我整理周报",
  kind: "once",
  runAt: "2026-06-13T10:00:00.000Z",
  fullAccess: false,
  enabled: false,
  lastRunAt: "2026-06-13T10:00:00.000Z",
  lastStatus: "completed",
  createdAt: "2026-06-12T00:00:00.000Z",
  updatedAt: "2026-06-13T10:00:00.000Z"
};

const project: Project = {
  id: "project_1",
  name: "chengxiaobang",
  path: "/tmp/chengxiaobang",
  createdAt: "2026-06-12T00:00:00.000Z",
  updatedAt: "2026-06-12T00:00:00.000Z"
};

const session: Session = {
  id: "session_1",
  projectId: project.id,
  title: "项目对话",
  providerId: provider.id,
  accessMode: "approval",
  createdAt: "2026-06-12T00:00:00.000Z",
  updatedAt: "2026-06-12T00:00:00.000Z"
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
    updateSession: vi.fn() as never,
    deleteSession: vi.fn() as never,
    getGitChanges: vi.fn(async () => ({ isRepo: false, files: [] })),
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
    listTasks: vi.fn(async () => [task]),
    updateTask: vi.fn(async () => ({ ...task, enabled: false })),
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
  delete (window as { chengxiaobang?: unknown }).chengxiaobang;
  resetAppStore();
  useAppStore.setState({ onboardingCompleted: true });
});

afterEach(() => {
  delete (window as { chengxiaobang?: unknown }).chengxiaobang;
});

describe("TasksView", () => {
  it("opens from the sidebar entry and lists scheduled tasks", async () => {
    const client = createClient({ listTasks: vi.fn(async () => [task, expiredTask]) });
    render(<App client={client} />);
    await waitFor(() => expect(client.listProjects).toHaveBeenCalled());

    fireEvent.click(screen.getByText("定时任务"));

    await waitFor(() => expect(client.listTasks).toHaveBeenCalled());
    expect(screen.getByText("正在运行的任务")).toBeInTheDocument();
    const activeGrid = screen.getByTestId("tasks-grid");
    expect(activeGrid).toHaveClass("sm:grid-cols-2");
    expect(await screen.findByText("AI 日报")).toBeInTheDocument();
    expect(within(activeGrid).getByText("生成今天的 AI 日报")).toBeInTheDocument();
    expect(within(activeGrid).getByText("成功")).toBeInTheDocument();
    expect(within(activeGrid).queryByText("一次性提醒")).not.toBeInTheDocument();
    expect(screen.queryByText("cron：0 9 * * *")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "展开 1 个已过期任务" })).toHaveAttribute(
      "aria-expanded",
      "false"
    );
    expect(
      screen.queryByRole("button", { name: "查看「一次性提醒」详情" })
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "查看「AI 日报」详情" }));

    expect(await screen.findByText("任务详情")).toBeInTheDocument();
    expect(screen.getByText("cron")).toBeInTheDocument();
    expect(screen.getByText("0 9 * * *")).toBeInTheDocument();
    expect(screen.getByText("需要审批")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    await waitFor(() => expect(screen.queryByText("0 9 * * *")).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "展开 1 个已过期任务" }));

    const expiredGrid = await screen.findByTestId("expired-tasks-grid");
    expect(within(expiredGrid).queryByRole("switch")).not.toBeInTheDocument();
    expect(within(expiredGrid).getByText(/计划执行/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "查看「一次性提醒」详情" }));

    expect(await screen.findByText("计划执行时间")).toBeInTheDocument();
    expect(screen.queryByText("cron")).not.toBeInTheDocument();
  });

  it("toggles, runs and deletes a task through the api client", async () => {
    const client = createClient();
    render(<App client={client} />);
    await waitFor(() => expect(client.listProjects).toHaveBeenCalled());
    fireEvent.click(screen.getByText("定时任务"));
    await screen.findByText("AI 日报");

    fireEvent.click(screen.getByRole("switch", { name: "启用「AI 日报」" }));
    await waitFor(() =>
      expect(client.updateTask).toHaveBeenCalledWith("task_1", { enabled: false })
    );
    // updateTask 返回的最新任务回写进 store
    expect(useAppStore.getState().tasks[0]?.enabled).toBe(false);

    fireEvent.click(screen.getByTitle("立即运行"));
    await waitFor(() => expect(client.runTaskNow).toHaveBeenCalledWith("task_1"));

    fireEvent.click(screen.getByTitle("删除"));
    await waitFor(() => expect(client.deleteTask).toHaveBeenCalledWith("task_1"));
    await waitFor(() => expect(useAppStore.getState().tasks).toHaveLength(0));
  });

  it("shows the empty-state hint when there are no tasks", async () => {
    const client = createClient({ listTasks: vi.fn(async () => []) });
    render(<App client={client} />);
    await waitFor(() => expect(client.listProjects).toHaveBeenCalled());

    fireEvent.click(screen.getByText("定时任务"));

    expect(
      await screen.findByText(/还没有定时任务/)
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "定时任务" }).closest("header")).toHaveClass(
      "min-h-[76px]",
      "pt-5"
    );
    expect(screen.queryByRole("button", { name: "刷新" })).not.toBeInTheDocument();
  });

  it("keeps chat-only top-right controls off the tasks view", async () => {
    window.chengxiaobang = {
      getBackendInfo: vi.fn(async () => undefined),
      pickDirectory: vi.fn(async () => undefined),
      pickFiles: vi.fn(async () => []),
      readFileText: vi.fn() as never,
      detectProjectOpeners: vi.fn(async () => [
        {
          id: "cursor",
          name: "Cursor",
          appPath: "/Applications/Cursor.app",
          iconDataUrl: "data:image/png;base64,cursor"
        }
      ]),
      openProjectInApp: vi.fn(async () => ({ ok: true }))
    };
    const client = createClient({
      listProjects: vi.fn(async () => [project]),
      listSessions: vi.fn(async () => [session])
    });
    render(<App client={client} />);

    fireEvent.click(await screen.findByText("项目对话"));
    expect(await screen.findByTitle("用本机应用打开项目")).toBeInTheDocument();
    expect(await screen.findByTitle("打开侧边面板")).toBeInTheDocument();

    fireEvent.click(screen.getByText("定时任务"));

    await screen.findByRole("heading", { name: "定时任务" });
    expect(screen.queryByTitle("用本机应用打开项目")).not.toBeInTheDocument();
    expect(screen.queryByTitle("打开侧边面板")).not.toBeInTheDocument();
  });

  it("selects the tasks tab instead of keeping the previous session highlighted", async () => {
    const client = createClient({
      listProjects: vi.fn(async () => [project]),
      listSessions: vi.fn(async () => [session])
    });
    render(<App client={client} />);

    const sessionButton = await screen.findByRole("button", { name: "项目对话" });
    fireEvent.click(sessionButton);
    await waitFor(() => expect(sessionButton).toHaveAttribute("aria-current", "page"));

    fireEvent.click(screen.getByRole("button", { name: "定时任务" }));

    expect(await screen.findByRole("heading", { name: "定时任务" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "定时任务" })).toHaveAttribute(
      "aria-current",
      "page"
    );
    expect(sessionButton).not.toHaveAttribute("aria-current");
  });
});
