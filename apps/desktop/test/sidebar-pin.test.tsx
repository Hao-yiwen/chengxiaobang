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

function project(pinnedAt?: string): Project {
  return {
    id: "project_1",
    name: "demo",
    path: "/tmp/demo",
    ...(pinnedAt ? { pinnedAt } : {}),
    createdAt: "2026-06-08T00:00:00.000Z",
    updatedAt: "2026-06-08T00:00:00.000Z"
  };
}

function session(
  id: string,
  title: string,
  projectId: string | null = null,
  pinnedAt?: string
): Session {
  return {
    id,
    projectId,
    title,
    providerId: "deepseek",
    accessMode: "approval",
    ...(pinnedAt ? { pinnedAt } : {}),
    createdAt: "2026-06-08T00:00:00.000Z",
    updatedAt: "2026-06-08T00:00:00.000Z"
  };
}

// 9 个项目会话：普通项目区截断为 8 条，第 9 条「唯一目标」只在置顶组（不截断）可见。
function projectSessions(): Session[] {
  return Array.from({ length: 8 }, (_, index) =>
    session(`p${index}`, `项目会话${index}`, "project_1")
  ).concat([session("p-target", "唯一目标", "project_1")]);
}

function createClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    listProjects: vi.fn(async () => [project()]),
    createProject: vi.fn() as never,
    renameProject: vi.fn() as never,
    setProjectPinned: vi.fn() as never,
    deleteProject: vi.fn(async () => true),
    listSessions: vi.fn(async () => [
      session("s1", "旧标题A"),
      session("s2", "另一个B"),
      ...projectSessions()
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

describe("sidebar pinning", () => {
  it("无置顶项时不渲染置顶区", async () => {
    render(<App client={createClient()} />);
    const sidebar = within(await screen.findByTestId("app-sidebar"));
    await sidebar.findByText("旧标题A");

    expect(sidebar.queryByText("置顶")).not.toBeInTheDocument();
  });

  it("渲染置顶区：置顶项目组不截断、置顶项不在原区域重复", async () => {
    const client = createClient({
      listProjects: vi.fn(async () => [project("2026-06-10T00:00:00.000Z")]),
      listSessions: vi.fn(async () => [
        session("s1", "旧标题A", null, "2026-06-11T00:00:00.000Z"),
        session("s2", "另一个B"),
        ...projectSessions()
      ])
    });

    render(<App client={client} />);
    const sidebar = within(await screen.findByTestId("app-sidebar"));
    await sidebar.findByText("置顶");

    // 置顶项目组展示全部 9 条会话（不截断），第 9 条「唯一目标」可见。
    expect(sidebar.getAllByText("唯一目标")).toHaveLength(1);
    // 置顶项只在置顶区展示：项目区不再出现该项目，会话也只有置顶组内一份。
    expect(sidebar.getAllByText("demo")).toHaveLength(1);
    expect(sidebar.getAllByText("项目会话0")).toHaveLength(1);
    // 置顶的独立会话只在置顶区单行展示，对话区不再重复。
    expect(sidebar.getAllByText("旧标题A")).toHaveLength(1);
    // 置顶项渲染在「项目」区块标签之前（即位于置顶区内）。
    expect(
      sidebar.getByText("旧标题A").compareDocumentPosition(sidebar.getByText("项目")) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    // 未置顶会话保持在对话区单份。
    expect(sidebar.getAllByText("另一个B")).toHaveLength(1);
  });

  it("从右键菜单置顶会话", async () => {
    const pinned = session("s2", "另一个B", null, "2026-06-12T00:00:00.000Z");
    const updateSession = vi.fn(async () => pinned);
    const client = createClient({ updateSession });

    render(<App client={client} />);
    const sidebar = within(await screen.findByTestId("app-sidebar"));
    fireEvent.contextMenu(await sidebar.findByText("另一个B"));

    // 初始无置顶区，「置顶」此时只存在于菜单项中。
    fireEvent.click(await screen.findByText("置顶"));

    await waitFor(() => expect(updateSession).toHaveBeenCalledWith("s2", { pinned: true }));
    // 置顶区出现，该会话移入置顶区（原对话区不再展示，保持单份）。
    await sidebar.findByText("置顶");
    expect(sidebar.getAllByText("另一个B")).toHaveLength(1);
    expect(
      sidebar.getByText("另一个B").compareDocumentPosition(sidebar.getByText("项目")) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("会话行右侧悬浮按钮置顶独立会话", async () => {
    const pinned = session("s2", "另一个B", null, "2026-06-12T00:00:00.000Z");
    const updateSession = vi.fn(async () => pinned);
    const client = createClient({ updateSession });

    render(<App client={client} />);
    const sidebar = within(await screen.findByTestId("app-sidebar"));
    const row = (await sidebar.findByText("另一个B")).closest("div") as HTMLElement;

    expect(within(row).queryByTitle("删除会话")).not.toBeInTheDocument();
    fireEvent.click(within(row).getByTitle("置顶"));

    await waitFor(() => expect(updateSession).toHaveBeenCalledWith("s2", { pinned: true }));
  });

  it("会话行右侧悬浮按钮置顶项目内会话", async () => {
    const pinned = session("p0", "项目会话0", "project_1", "2026-06-12T00:00:00.000Z");
    const updateSession = vi.fn(async () => pinned);
    const client = createClient({ updateSession });

    render(<App client={client} />);
    const sidebar = within(await screen.findByTestId("app-sidebar"));
    const row = (await sidebar.findByText("项目会话0")).closest("div") as HTMLElement;

    expect(within(row).queryByTitle("删除会话")).not.toBeInTheDocument();
    fireEvent.click(within(row).getByTitle("置顶"));

    await waitFor(() => expect(updateSession).toHaveBeenCalledWith("p0", { pinned: true }));
  });

  it("会话删除只从右键菜单触发", async () => {
    const deleteSession = vi.fn(async () => true);
    const client = createClient({ deleteSession });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<App client={client} />);
    const sidebar = within(await screen.findByTestId("app-sidebar"));
    const row = (await sidebar.findByText("另一个B")).closest("div") as HTMLElement;

    expect(within(row).queryByTitle("删除会话")).not.toBeInTheDocument();
    fireEvent.contextMenu(row);
    fireEvent.click(await screen.findByText("删除会话"));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("确定删除该对话？")).toBeInTheDocument();
    expect(confirmSpy).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "删除" }));

    await waitFor(() => expect(deleteSession).toHaveBeenCalledWith("s2"));
  });

  it("从右键菜单取消置顶项目", async () => {
    const setProjectPinned = vi.fn(async () => project());
    const client = createClient({
      listProjects: vi.fn(async () => [project("2026-06-10T00:00:00.000Z")]),
      setProjectPinned
    });

    render(<App client={client} />);
    const sidebar = within(await screen.findByTestId("app-sidebar"));
    await sidebar.findByText("置顶");

    fireEvent.contextMenu(sidebar.getAllByText("demo")[0]);
    fireEvent.click(await screen.findByText("取消置顶"));

    await waitFor(() => expect(setProjectPinned).toHaveBeenCalledWith("project_1", false));
    // 置顶区消失，项目名只剩项目区一份。
    await waitFor(() => expect(sidebar.queryByText("置顶")).not.toBeInTheDocument());
    expect(sidebar.getAllByText("demo")).toHaveLength(1);
  });
});
