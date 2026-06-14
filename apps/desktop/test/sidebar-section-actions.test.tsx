// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/renderer/App";
import type { ApiClient } from "../src/renderer/lib/api";
import { resetAppStore, useAppStore } from "../src/renderer/store";
import type { Project, ProviderConfig, Session } from "@chengxiaobang/shared";

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

function projectFixture(input: Partial<Project> & { id: string; name: string }): Project {
  return {
    id: input.id,
    name: input.name,
    path: input.path ?? `/tmp/${input.id}`,
    ...(input.pinnedAt ? { pinnedAt: input.pinnedAt } : {}),
    createdAt: input.createdAt ?? "2026-06-08T00:00:00.000Z",
    updatedAt: input.updatedAt ?? input.createdAt ?? "2026-06-08T00:00:00.000Z"
  };
}

const project: Project = projectFixture({
  id: "project_1",
  name: "demo",
  path: "/tmp/demo"
});

function session(
  id: string,
  title: string,
  projectId: string | null = null,
  updatedAt = "2026-06-08T00:00:00.000Z"
): Session {
  return {
    id,
    projectId,
    title,
    providerId: "deepseek",
    accessMode: "approval",
    createdAt: "2026-06-08T00:00:00.000Z",
    updatedAt
  };
}

function createClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    listProjects: vi.fn(async () => [project]),
    createProject: vi.fn() as never,
    renameProject: vi.fn() as never,
    setProjectPinned: vi.fn() as never,
    deleteProject: vi.fn(async () => true),
    listSessions: vi.fn(async () => [
      session("s1", "独立对话A"),
      session("p0", "项目会话0", "project_1")
    ]),
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

describe("sidebar section actions", () => {
  it("「对话」区块标题的加号新建普通对话并清掉项目上下文", async () => {
    render(<App client={createClient()} />);
    const sidebar = within(await screen.findByTestId("app-sidebar"));
    await sidebar.findByText("独立对话A");

    // 先进入项目内会话，确认加号走的是 newChat（清空项目上下文）而非项目内新建。
    fireEvent.click(sidebar.getByText("项目会话0"));
    await waitFor(() => expect(useAppStore.getState().activeSessionId).toBe("p0"));
    expect(useAppStore.getState().activeProjectId).toBe("project_1");

    fireEvent.click(sidebar.getByTitle("新对话"));

    const state = useAppStore.getState();
    expect(state.view).toBe("home");
    expect(state.activeSessionId).toBeUndefined();
    expect(state.activeProjectId).toBeUndefined();
  });

  it("「项目」区块标题的加号触发打开文件夹", async () => {
    render(<App client={createClient()} />);
    const sidebar = within(await screen.findByTestId("app-sidebar"));
    await sidebar.findByText("独立对话A");

    // jsdom 没有桌面端目录选择桥，openFolder 走降级提示分支，借此验证接线正确。
    fireEvent.click(sidebar.getByLabelText("打开文件夹"));

    expect(
      await screen.findByText("打开文件夹需要在桌面端里使用，浏览器预览没有系统文件选择权限。")
    ).toBeInTheDocument();
  });

  it("「置顶」区块标题不渲染加号", async () => {
    const pinned = { ...session("s1", "独立对话A"), pinnedAt: "2026-06-10T00:00:00.000Z" };
    const client = createClient({
      listSessions: vi.fn(async () => [pinned, session("p0", "项目会话0", "project_1")])
    });
    render(<App client={client} />);
    const sidebar = within(await screen.findByTestId("app-sidebar"));
    await sidebar.findByText("置顶");

    // 「对话」「项目」各一个加号，置顶区没有创建语义，不应出现第三个。
    expect(sidebar.getByTitle("新对话")).toBeInTheDocument();
    expect(sidebar.getByLabelText("打开文件夹")).toBeInTheDocument();
  });

  it("项目区默认按创建时间从新到旧排序", async () => {
    const oldProject = projectFixture({
      id: "project_old",
      name: "旧项目",
      createdAt: "2026-06-01T00:00:00.000Z"
    });
    const newProject = projectFixture({
      id: "project_new",
      name: "新项目",
      createdAt: "2026-06-11T00:00:00.000Z"
    });
    const middleProject = projectFixture({
      id: "project_middle",
      name: "中间项目",
      createdAt: "2026-06-05T00:00:00.000Z"
    });
    const client = createClient({
      listProjects: vi.fn(async () => [oldProject, newProject, middleProject]),
      listSessions: vi.fn(async () => [])
    });

    render(<App client={client} />);
    const sidebar = within(await screen.findByTestId("app-sidebar"));
    await sidebar.findByText("新项目");

    expect(
      sidebar.getByText("新项目").compareDocumentPosition(sidebar.getByText("中间项目")) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      sidebar.getByText("中间项目").compareDocumentPosition(sidebar.getByText("旧项目")) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("项目区可切换为按项目内最后消息时间排序并持久化偏好", async () => {
    const quietProject = projectFixture({
      id: "project_quiet",
      name: "创建较新的安静项目",
      createdAt: "2026-06-11T00:00:00.000Z"
    });
    const activeProject = projectFixture({
      id: "project_active",
      name: "最近活跃项目",
      createdAt: "2026-06-01T00:00:00.000Z"
    });
    const client = createClient({
      listProjects: vi.fn(async () => [quietProject, activeProject]),
      listSessions: vi.fn(async () => [
        session("quiet_s", "安静会话", "project_quiet", "2026-06-09T00:00:00.000Z"),
        session("active_s", "活跃会话", "project_active", "2026-06-12T00:00:00.000Z")
      ])
    });

    render(<App client={client} />);
    const sidebar = within(await screen.findByTestId("app-sidebar"));
    await sidebar.findByText("创建较新的安静项目");
    expect(
      sidebar
        .getByText("创建较新的安静项目")
        .compareDocumentPosition(sidebar.getByText("最近活跃项目")) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();

    fireEvent.pointerDown(sidebar.getByLabelText("项目排序"), { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByText("按最近使用"));

    await waitFor(() => expect(useAppStore.getState().projectSortMode).toBe("recent"));
    expect(
      sidebar
        .getByText("最近活跃项目")
        .compareDocumentPosition(sidebar.getByText("创建较新的安静项目")) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      JSON.parse(window.localStorage.getItem("chengxiaobang.app") ?? "{}").state.projectSortMode
    ).toBe("recent");
  });

  it("初始化时读取已持久化的项目排序偏好", async () => {
    window.localStorage.setItem(
      "chengxiaobang.app",
      JSON.stringify({
        state: { projectSortMode: "recent" },
        version: 4
      })
    );
    await useAppStore.persist.rehydrate();
    const quietProject = projectFixture({
      id: "project_quiet",
      name: "创建较新的安静项目",
      createdAt: "2026-06-11T00:00:00.000Z"
    });
    const activeProject = projectFixture({
      id: "project_active",
      name: "最近活跃项目",
      createdAt: "2026-06-01T00:00:00.000Z"
    });
    const client = createClient({
      listProjects: vi.fn(async () => [quietProject, activeProject]),
      listSessions: vi.fn(async () => [
        session("quiet_s", "安静会话", "project_quiet", "2026-06-09T00:00:00.000Z"),
        session("active_s", "活跃会话", "project_active", "2026-06-12T00:00:00.000Z")
      ])
    });

    render(<App client={client} />);
    const sidebar = within(await screen.findByTestId("app-sidebar"));
    await sidebar.findByText("最近活跃项目");

    expect(useAppStore.getState().projectSortMode).toBe("recent");
    expect(
      sidebar
        .getByText("最近活跃项目")
        .compareDocumentPosition(sidebar.getByText("创建较新的安静项目")) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("项目区标题按钮可折叠并展开全部置顶和普通项目组", async () => {
    const pinnedProject = projectFixture({
      id: "project_pinned",
      name: "置顶项目",
      pinnedAt: "2026-06-12T00:00:00.000Z"
    });
    const normalProject = projectFixture({
      id: "project_normal",
      name: "普通项目"
    });
    const client = createClient({
      listProjects: vi.fn(async () => [pinnedProject, normalProject]),
      listSessions: vi.fn(async () => [
        session("pinned_s", "置顶项目会话", "project_pinned"),
        session("normal_s", "普通项目会话", "project_normal")
      ])
    });

    render(<App client={client} />);
    const sidebar = within(await screen.findByTestId("app-sidebar"));
    await sidebar.findByText("置顶项目会话");
    expect(sidebar.getByText("普通项目会话")).toBeInTheDocument();

    fireEvent.click(sidebar.getByLabelText("收起所有项目"));

    await waitFor(() => {
      expect(sidebar.queryByText("置顶项目会话")).not.toBeInTheDocument();
      expect(sidebar.queryByText("普通项目会话")).not.toBeInTheDocument();
    });

    fireEvent.click(sidebar.getByLabelText("展开所有项目"));

    expect(await sidebar.findByText("置顶项目会话")).toBeInTheDocument();
    expect(sidebar.getByText("普通项目会话")).toBeInTheDocument();
  });
});
