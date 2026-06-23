// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/renderer/App";
import type { ApiClient } from "../src/renderer/lib/api";
import { resetAppStore } from "../src/renderer/store";
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

const project: Project = {
  id: "project_1",
  name: "demo",
  path: "/tmp/demo",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

function session(id: string, title: string, projectId: string | null = null): Session {
  return {
    id,
    projectId,
    title,
    providerId: "deepseek",
    accessMode: "approval",
    createdAt: "2026-06-08T00:00:00.000Z",
    updatedAt: "2026-06-08T00:00:00.000Z"
  };
}

// 9 个项目会话用于验证分组默认只展示前 6 个，再加两个独立对话覆盖基础侧边栏渲染。
const projectSessions = Array.from({ length: 8 }, (_, index) =>
  session(`p${index}`, `项目会话${index}`, project.id)
).concat([session("p-target", "唯一目标", project.id)]);

const sessions = [session("s1", "旧标题A"), session("s2", "另一个B"), ...projectSessions];

function createClient(): ApiClient {
  return {
    listProjects: vi.fn(async () => [project]),
    createProject: vi.fn() as never,
    listSessions: vi.fn(async () => sessions),
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
    getFeishuConfig: vi.fn(async () => ({ enabled: false, appId: "", domain: "feishu" as const, fullAccess: false })),
    saveFeishuConfig: vi.fn() as never,
    getFeishuStatus: vi.fn(async () => ({ status: "disconnected" as const })),
    approve: vi.fn() as never,
    abort: vi.fn() as never,
    terminalExec: vi.fn() as never,
    streamRun: vi.fn(async () => {})
  };
}

function paginate<T>(items: T[], input?: { limit: number; offset: number }) {
  const limit = input?.limit ?? items.length;
  const offset = input?.offset ?? 0;
  const pageItems = items.slice(offset, offset + limit);
  return {
    items: pageItems,
    total: items.length,
    hasMore: offset + pageItems.length < items.length
  };
}

function projectFixture(index: number): Project {
  return {
    id: `project_${index}`,
    name: `项目${index}`,
    path: `/tmp/project-${index}`,
    createdAt: `2026-06-08T00:00:0${index}.000Z`,
    updatedAt: `2026-06-08T00:00:0${index}.000Z`
  };
}

function createPagedClient(): ApiClient {
  const pagedProjects = Array.from({ length: 5 }, (_, index) => projectFixture(index));
  const firstProjectSessions = Array.from({ length: 7 }, (_, index) =>
    session(`project_0_session_${index}`, `项目0 会话${index}`, "project_0")
  );
  const plainSessions = Array.from({ length: 7 }, (_, index) =>
    session(`plain_${index}`, `普通会话${index}`)
  );
  return {
    listProjects: vi.fn(async (input) =>
      input?.pinned ? paginate([], input) : paginate(pagedProjects, input)
    ),
    createProject: vi.fn() as never,
    listSessions: vi.fn(async (input) => {
      if (input?.pinned) return paginate([], input);
      if (input?.projectId === "project_0") return paginate(firstProjectSessions, input);
      if (input?.projectId === null) return paginate(plainSessions, input);
      return paginate([], input);
    }),
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
    getFeishuConfig: vi.fn(async () => ({ enabled: false, appId: "", domain: "feishu" as const, fullAccess: false })),
    saveFeishuConfig: vi.fn() as never,
    getFeishuStatus: vi.fn(async () => ({ status: "disconnected" as const })),
    approve: vi.fn() as never,
    abort: vi.fn() as never,
    terminalExec: vi.fn() as never,
    streamRun: vi.fn(async () => {})
  };
}

beforeEach(() => {
  window.localStorage.clear();
  resetAppStore();
});

describe("sidebar sessions", () => {
  it("renders sessions without the brand mark or sidebar filter input", async () => {
    render(<App client={createClient()} />);
    // 当前会话标题也会出现在聊天头部，侧边栏断言需要限制在 sidebar 内部。
    const sidebar = within(await screen.findByTestId("app-sidebar"));
    const sessionTitle = await sidebar.findByText("旧标题A");

    expect(sidebar.queryByText("程小帮")).not.toBeInTheDocument();
    expect(sidebar.queryByLabelText("搜索对话")).not.toBeInTheDocument();
    expect(sidebar.queryByPlaceholderText("搜索对话")).not.toBeInTheDocument();
    expect(sidebar.getByText("另一个B")).toBeInTheDocument();
    const sessionRow = sessionTitle.closest("div");
    expect(sessionRow).toHaveClass("mx-1", "min-w-0");
    expect(sessionRow).not.toHaveClass("mr-1");
    expect(sessionTitle).toHaveClass("min-w-0", "flex-1", "truncate");
    expect(sessionTitle.closest("button")).toHaveClass("overflow-hidden", "pr-7");
    expect(sessionRow?.querySelector('button[title="置顶"]')?.parentElement).toHaveClass(
      "absolute",
      "right-1"
    );
    // 未分组会话不再包一层"独立对话"分组，直接平铺在"对话"区块下。
    expect(sidebar.queryByText("独立对话")).not.toBeInTheDocument();
    expect(sidebar.getByText("demo").closest("button")?.querySelector("svg")).toBeTruthy();
    // 项目区块固定在对话区块上方。
    expect(
      sidebar.getByText("项目").compareDocumentPosition(sidebar.getByText("对话")) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(sidebar.getByText("对话")).not.toHaveClass("border-t");
    expect(
      screen.getByTestId("app-sidebar").querySelector('[data-scrollbar-hidden="true"]')
    ).toBeInTheDocument();
    expect(screen.getByTestId("app-sidebar").querySelector('[data-sidebar-bottom-fade="true"]')).toHaveClass(
      "pointer-events-none",
      "bg-gradient-to-b"
    );
    // 第 9 个项目会话仍受每组默认展示 6 条的限制。
    expect(sidebar.queryByText("唯一目标")).not.toBeInTheDocument();
  });

  it("shows project path and git branch only on sessions under projects", async () => {
    const client = {
      ...createClient(),
      getGitInfo: vi.fn(async () => ({ isRepo: true, branchName: "feature/sidebar-tooltip" }))
    };
    render(<App client={client} />);
    const sidebar = within(await screen.findByTestId("app-sidebar"));

    expect(await sidebar.findByText("项目会话0")).toBeInTheDocument();
    await waitFor(() => expect(client.getGitInfo).toHaveBeenCalledWith(project.id));
    const projectSessionRow = sidebar.getByText("项目会话0").closest("div");
    expect(projectSessionRow).toBeTruthy();

    fireEvent.pointerMove(projectSessionRow!, { pointerType: "mouse" });
    fireEvent.mouseEnter(projectSessionRow!);

    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent("项目路径");
    expect(tooltip).toHaveTextContent(project.path);
    expect(tooltip).toHaveTextContent("分支");
    expect(tooltip).toHaveTextContent("feature/sidebar-tooltip");

    fireEvent.pointerLeave(projectSessionRow!);
    fireEvent.mouseLeave(projectSessionRow!);

    const plainSessionRow = sidebar.getByText("旧标题A").closest("div");
    expect(plainSessionRow).toBeTruthy();
    fireEvent.pointerMove(plainSessionRow!, { pointerType: "mouse" });
    fireEvent.mouseEnter(plainSessionRow!);
    expect(plainSessionRow).not.toHaveAttribute("aria-describedby");
  });

  it("defaults to 4 projects and 6 sessions, then expands and collapses on demand", async () => {
    render(<App client={createPagedClient()} />);
    const sidebar = within(await screen.findByTestId("app-sidebar"));

    expect(await sidebar.findByText("项目0")).toBeInTheDocument();
    expect(sidebar.getByText("项目3")).toBeInTheDocument();
    expect(sidebar.queryByText("项目4")).not.toBeInTheDocument();
    expect(sidebar.getByText("项目0 会话5")).toBeInTheDocument();
    expect(sidebar.queryByText("项目0 会话6")).not.toBeInTheDocument();
    expect(sidebar.getByText("普通会话5")).toBeInTheDocument();
    expect(sidebar.queryByText("普通会话6")).not.toBeInTheDocument();

    fireEvent.click(sidebar.getAllByText("... 展开")[0]!);
    expect(await sidebar.findByText("项目0 会话6")).toBeInTheDocument();
    fireEvent.click(sidebar.getAllByText("折叠")[0]!);
    await waitFor(() => expect(sidebar.queryByText("项目0 会话6")).not.toBeInTheDocument());

    fireEvent.click(sidebar.getAllByText("... 展开")[1]!);
    expect(await sidebar.findByText("项目4")).toBeInTheDocument();

    fireEvent.click(sidebar.getAllByText("... 展开")[1]!);
    expect(await sidebar.findByText("普通会话6")).toBeInTheDocument();
    const collapseButtons = sidebar.getAllByText("折叠");
    fireEvent.click(collapseButtons[collapseButtons.length - 1]!);
    await waitFor(() => expect(sidebar.queryByText("普通会话6")).not.toBeInTheDocument());
  });

  it("exports a non-active session as markdown from its context menu", async () => {
    const createObjectURL = vi.fn(() => "blob:mock");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL, revokeObjectURL }));
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);

    const client = createClient();
    render(<App client={client} />);
    const row = (await screen.findByText("另一个B")).closest("div");

    fireEvent.contextMenu(row as HTMLElement);
    fireEvent.click(await screen.findByText("导出为 Markdown"));

    await waitFor(() => expect(client.listMessages).toHaveBeenCalledWith("s2"));
    expect(client.listSessionRuns).toHaveBeenCalledWith("s2");
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(document.body.style.pointerEvents).not.toBe("none");

    click.mockRestore();
    vi.unstubAllGlobals();
  });
});
