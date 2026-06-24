// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from "vitest";
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
  createdAt: "2026-06-08T00:00:00.000Z",
  updatedAt: "2026-06-08T00:00:00.000Z"
};

function makeProject(id: string, name: string): Project {
  return {
    id,
    name,
    path: `/tmp/${name}`,
    createdAt: "2026-06-08T00:00:00.000Z",
    updatedAt: "2026-06-08T00:00:00.000Z"
  };
}

const alpha = makeProject("project_alpha", "alpha-app");
const beta = makeProject("project_beta", "beta-tools");

function makeSession(id: string, title: string, projectId: string | null): Session {
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

function createClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    listProjects: vi.fn(async () => [alpha, beta]),
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
    listTasks: vi.fn(async () => []),
    updateTask: vi.fn() as never,
    deleteTask: vi.fn(async () => true),
    runTaskNow: vi.fn(async () => {}),
    approve: vi.fn() as never,
    abort: vi.fn() as never,
    terminalExec: vi.fn() as never,
    streamRun: vi.fn(async () => {}),
    ...overrides
  } as unknown as ApiClient;
}

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn(() => false) as never;
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
  window.HTMLElement.prototype.setPointerCapture = vi.fn();
  if (!("ResizeObserver" in window)) {
    (window as never as Record<string, unknown>).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

beforeEach(() => {
  window.localStorage.clear();
  resetAppStore();
  useAppStore.setState({ onboardingOpen: false, onboardingCompleted: true });
});

afterEach(() => {
  delete (window as { chengxiaobang?: unknown }).chengxiaobang;
});

/** 首页项目触发按钮统一放在 composer 下方环境栏内。 */
async function openProjectMenu(triggerName = "对话"): Promise<HTMLElement> {
  const scope = within(await screen.findByTestId("home-composer-environment"));
  const trigger = await scope.findByRole("button", { name: triggerName });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
  await screen.findByPlaceholderText("搜索项目…");
  return screen.getByRole("menu");
}

async function openAddProjectSubmenu(): Promise<void> {
  const subTrigger = await screen.findByText("添加新项目");
  fireEvent.pointerDown(subTrigger, { button: 0 });
  fireEvent.click(subTrigger);
  await screen.findByText("新建空白项目");
}

describe("项目选择器下拉", () => {
  it("按名搜索过滤项目列表", async () => {
    render(<App client={createClient()} />);
    await screen.findByTestId("composer-shell");
    expect(
      within(screen.getByTestId("composer-shell")).queryByRole("button", { name: "对话" })
    ).not.toBeInTheDocument();
    expect(
      within(await screen.findByTestId("home-composer-environment")).getByRole("button", {
        name: "对话"
      })
    ).toBeInTheDocument();
    const menu = await openProjectMenu();

    // 两个项目都先出现在菜单里。
    expect(await within(menu).findByText("alpha-app")).toBeInTheDocument();
    expect(within(menu).getByText("beta-tools")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("搜索项目…"), { target: { value: "beta" } });

    await waitFor(() => expect(within(menu).queryByText("alpha-app")).not.toBeInTheDocument());
    expect(within(menu).getByText("beta-tools")).toBeInTheDocument();

    // 无匹配时显示占位。
    fireEvent.change(screen.getByPlaceholderText("搜索项目…"), { target: { value: "zzz" } });
    expect(await within(menu).findByText("无匹配项目")).toBeInTheDocument();
  });

  it("点「不使用项目」清空当前项目选择", async () => {
    useAppStore.setState({ activeProjectId: alpha.id });
    render(<App client={createClient()} />);
    await screen.findByTestId("home-composer-environment");

    const menu = await openProjectMenu("alpha-app");
    fireEvent.click(within(menu).getByText("不使用项目"));
    await waitFor(() => expect(useAppStore.getState().activeProjectId).toBeUndefined());
    await waitFor(() =>
      expect(
        within(screen.getByTestId("home-composer-environment")).getByRole("button", {
          name: "对话"
        })
      ).toBeInTheDocument()
    );
  });

  it("选中项目后在下方环境栏展示项目，composer 工具栏不再展示项目名", async () => {
    useAppStore.setState({ activeProjectId: alpha.id });
    render(<App client={createClient()} />);

    const composerShell = await screen.findByTestId("composer-shell");
    const environmentNode = await screen.findByTestId("home-composer-environment");
    const shell = within(composerShell);
    const environment = within(environmentNode);

    expect(shell.queryByRole("button", { name: "alpha-app" })).not.toBeInTheDocument();
    expect(shell.queryByRole("button", { name: "对话" })).not.toBeInTheDocument();
    expect(composerShell).toHaveClass("rounded-t-[18px]", "!rounded-bl-none", "!rounded-br-none");
    expect(environmentNode).toHaveClass("rounded-b-[18px]");
    expect(environment.getByRole("button", { name: "alpha-app" })).toBeInTheDocument();
    expect(environment.queryByRole("button", { name: "本地模式" })).not.toBeInTheDocument();

    const menu = await openProjectMenu("alpha-app");
    expect(await within(menu).findByText("beta-tools")).toBeInTheDocument();
  });

  it("子菜单展开后可见「新建空白项目」「使用现有文件夹」", async () => {
    render(<App client={createClient()} />);
    await screen.findByTestId("composer-shell");
    await openProjectMenu();

    await openAddProjectSubmenu();

    expect(await screen.findByText("新建空白项目")).toBeInTheDocument();
    expect(screen.getByText("使用现有文件夹")).toBeInTheDocument();
  });

  it("从首页项目菜单新建空白项目后恢复页面点击和输入", async () => {
    const created = makeProject("project_new", "未命名项目");
    const createProject = vi.fn(async () => created);
    const createProjectFolder = vi.fn(async () => ({
      ok: true,
      path: "/Users/me/Documents/未命名项目",
      name: "未命名项目"
    }));
    (window as { chengxiaobang?: unknown }).chengxiaobang = { createProjectFolder };
    const client = createClient({
      createProject: createProject as never,
      listProjects: vi.fn(async () => [alpha, beta, created])
    });

    render(<App client={client} />);
    await screen.findByTestId("composer-shell");
    await openProjectMenu();
    await openAddProjectSubmenu();

    fireEvent.click(screen.getByText("新建空白项目"));
    const dialog = await screen.findByRole("dialog");
    const nameInput = within(dialog).getByPlaceholderText("项目名称");
    fireEvent.change(nameInput, { target: { value: "未命名项目" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "创建" }));

    await waitFor(() => expect(useAppStore.getState().activeProjectId).toBe(created.id));
    expect(createProjectFolder).toHaveBeenCalledWith("未命名项目");
    expect(createProject).toHaveBeenCalledWith({
      path: "/Users/me/Documents/未命名项目",
      name: "未命名项目"
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(document.body.style.pointerEvents).not.toBe("none");

    const composer = within(screen.getByTestId("composer-shell"));
    const input = composer.getByLabelText("输入消息");
    fireEvent.change(input, { target: { value: "继续输入" } });
    expect(input).toHaveValue("继续输入");
  });

  it("从首页项目菜单使用现有文件夹后不残留菜单 pointer lock", async () => {
    const created = makeProject("project_folder", "repo");
    const createProject = vi.fn(async () => created);
    const pickDirectory = vi.fn(async () => "/Users/me/Documents/repo");
    (window as { chengxiaobang?: unknown }).chengxiaobang = { pickDirectory };
    const client = createClient({
      createProject: createProject as never,
      listProjects: vi.fn(async () => [alpha, beta, created])
    });

    render(<App client={client} />);
    await screen.findByTestId("composer-shell");
    await openProjectMenu();
    await openAddProjectSubmenu();

    fireEvent.click(screen.getByText("使用现有文件夹"));

    await waitFor(() => expect(useAppStore.getState().activeProjectId).toBe(created.id));
    expect(pickDirectory).toHaveBeenCalled();
    expect(createProject).toHaveBeenCalledWith({
      path: "/Users/me/Documents/repo",
      name: "repo"
    });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(document.body.style.pointerEvents).not.toBe("none");

    const composer = within(screen.getByTestId("composer-shell"));
    const input = composer.getByLabelText("输入消息");
    fireEvent.change(input, { target: { value: "继续输入" } });
    expect(input).toHaveValue("继续输入");
  });

  it("进入会话页后不再展示项目选择器", async () => {
    const session = makeSession("session_alpha", "alpha 会话", alpha.id);
    const client = createClient({
      listSessions: vi.fn(async () => [session])
    });
    useAppStore.setState({ view: "chat", activeSessionId: session.id });

    render(<App client={client} />);
    await screen.findByTestId("chat-scroll");

    const composer = within(screen.getByTestId("composer-shell"));
    expect(composer.getByLabelText("输入消息")).toBeInTheDocument();
    expect(composer.queryByRole("button", { name: "alpha-app" })).not.toBeInTheDocument();
    expect(composer.queryByRole("button", { name: "对话" })).not.toBeInTheDocument();
  });
});

describe("store.createBlankProject", () => {
  it("在 Documents 下建文件夹并以返回路径创建项目，随后选中", async () => {
    const created = makeProject("project_new", "未命名项目");
    const createProject = vi.fn(async () => created);
    const createProjectFolder = vi.fn(async () => ({
      ok: true,
      path: "/Users/me/Documents/未命名项目",
      name: "未命名项目"
    }));
    (window as { chengxiaobang?: unknown }).chengxiaobang = { createProjectFolder };

    const client = createClient({
      createProject: createProject as never,
      // 创建后 refresh 会重新拉取项目列表，把新项目纳入。
      listProjects: vi.fn(async () => [alpha, beta, created])
    });
    await useAppStore.getState().initClient(client);

    await useAppStore.getState().createBlankProject("未命名项目");

    expect(createProjectFolder).toHaveBeenCalledWith("未命名项目");
    expect(createProject).toHaveBeenCalledWith({
      path: "/Users/me/Documents/未命名项目",
      name: "未命名项目"
    });
    expect(useAppStore.getState().activeProjectId).toBe(created.id);
  });

  it("建文件夹失败时给出提示且不创建项目", async () => {
    const createProject = vi.fn() as never;
    const createProjectFolder = vi.fn(async () => ({ ok: false, error: "EACCES" }));
    (window as { chengxiaobang?: unknown }).chengxiaobang = { createProjectFolder };

    const client = createClient({ createProject });
    await useAppStore.getState().initClient(client);

    await useAppStore.getState().createBlankProject("被拒绝");

    expect(createProjectFolder).toHaveBeenCalledWith("被拒绝");
    expect(client.createProject).not.toHaveBeenCalled();
    expect(useAppStore.getState().notice).toBe("新建空白项目失败，请重试");
  });
});
