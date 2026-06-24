// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { GitEnvironment, Project, ProviderConfig, Session } from "@chengxiaobang/shared";
import { App } from "../src/renderer/App";
import { setupI18n } from "../src/renderer/i18n";
import type { ApiClient } from "../src/renderer/lib/api";
import { resetAppStore, useAppStore } from "../src/renderer/store";

vi.mock("@pierre/diffs/react", () => ({
  FileDiff: () => null,
  MultiFileDiff: () => null
}));

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
  id: "project_git",
  name: "demo",
  path: "/tmp/demo",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

const session: Session = {
  id: "session_git",
  projectId: project.id,
  title: "Git 对话",
  providerId: provider.id,
  accessMode: "approval",
  createdAt: "2026-06-24T00:00:00.000Z",
  updatedAt: "2026-06-24T00:00:02.000Z"
};

const gitEnvironment: GitEnvironment = {
  isRepo: true,
  branchName: "main",
  upstream: "origin/main",
  ahead: 1,
  behind: 0,
  changedFileCount: 1,
  stagedFileCount: 0,
  unstagedFileCount: 1,
  additions: 53,
  deletions: 28,
  branches: [
    { name: "main", type: "local", current: true, upstream: "origin/main" },
    { name: "origin/feature", type: "remote", current: false }
  ]
};

function nonRepoEnvironment(): GitEnvironment {
  return {
    isRepo: false,
    ahead: 0,
    behind: 0,
    changedFileCount: 0,
    stagedFileCount: 0,
    unstagedFileCount: 0,
    additions: 0,
    deletions: 0,
    branches: []
  };
}

function createClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    listProjects: vi.fn(async () => ({ items: [project], total: 1, hasMore: false })),
    getProject: vi.fn(async () => project),
    createProject: vi.fn() as never,
    renameProject: vi.fn() as never,
    setProjectPinned: vi.fn() as never,
    deleteProject: vi.fn(async () => true),
    listSessions: vi.fn(async () => ({ items: [session], total: 1, hasMore: false })),
    getSession: vi.fn(async () => session),
    listProjectFiles: vi.fn(async () => []),
    listProjectDirectory: vi.fn(async () => []),
    getGitInfo: vi.fn(async () => ({ isRepo: true, branchName: "main" })),
    getGitEnvironment: vi.fn(async () => gitEnvironment),
    checkoutGitBranch: vi.fn(async () => ({ environment: gitEnvironment })),
    createGitBranch: vi.fn(async () => ({ environment: gitEnvironment })),
    commitGitChanges: vi.fn(async () => ({
      environment: gitEnvironment,
      commitHash: "abc1234",
      message: "fix: update git card"
    })),
    pushGitBranch: vi.fn(async () => ({ environment: gitEnvironment })),
    getGitChanges: vi.fn(async () => ({ isRepo: true, files: [] })),
    getGitChangeDiff: vi.fn() as never,
    updateSession: vi.fn() as never,
    deleteSession: vi.fn() as never,
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
    streamRun: vi.fn() as never,
    ...overrides
  };
}

beforeAll(() => {
  setupI18n("zh");
});

beforeEach(() => {
  window.localStorage.clear();
  resetAppStore();
  useAppStore.setState({ view: "chat", onboardingOpen: false, onboardingCompleted: true });
});

describe("GitEnvironmentCard", () => {
  it("shows the selected home project below composer and exposes the branch for git repositories", async () => {
    useAppStore.setState({
      view: "home",
      activeSessionId: undefined,
      activeProjectId: project.id
    });

    render(<App client={createClient()} />);

    const environment = await screen.findByTestId("home-composer-environment");
    expect(within(environment).getByRole("button", { name: project.name })).toBeInTheDocument();
    expect(within(environment).queryByRole("button", { name: "本地模式" })).not.toBeInTheDocument();
    expect(await within(environment).findByTestId("home-git-branch-trigger")).toHaveTextContent(
      "main"
    );
    expect(
      within(screen.getByTestId("composer-toolbar")).queryByRole("button", {
        name: project.name
      })
    ).not.toBeInTheDocument();
  });

  it("only shows the folder entry below composer for non-git home projects", async () => {
    const getGitEnvironment = vi.fn(async () => nonRepoEnvironment());
    useAppStore.setState({
      view: "home",
      activeSessionId: undefined,
      activeProjectId: project.id
    });

    render(<App client={createClient({ getGitEnvironment })} />);

    const environment = await screen.findByTestId("home-composer-environment");
    expect(within(environment).getByRole("button", { name: project.name })).toBeInTheDocument();
    expect(within(environment).queryByRole("button", { name: "本地模式" })).not.toBeInTheDocument();
    await waitFor(() => expect(getGitEnvironment).toHaveBeenCalledWith(project.id));
    expect(within(environment).queryByTestId("home-git-branch-trigger")).not.toBeInTheDocument();
  });

  it("uses the compact home branch picker to checkout a remote branch", async () => {
    const checkoutGitBranch = vi.fn(async () => ({
      environment: { ...gitEnvironment, branchName: "feature" }
    }));
    useAppStore.setState({
      view: "home",
      activeSessionId: undefined,
      activeProjectId: project.id
    });

    render(<App client={createClient({ checkoutGitBranch })} />);

    const environment = await screen.findByTestId("home-composer-environment");
    fireEvent.click(await within(environment).findByTestId("home-git-branch-trigger"));
    const popover = await screen.findByTestId("home-git-branch-popover");

    expect(popover).toHaveClass("w-[320px]");
    expect(screen.getByPlaceholderText("搜索分支").closest("label")).toHaveClass("h-9");
    expect(screen.getByText("分支")).toBeInTheDocument();
    expect(
      screen
        .getAllByRole("button", { name: "main" })
        .some(
          (button) =>
            button.className.includes("bg-surface-hover") &&
            button.className.includes("h-8")
        )
    ).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "origin/feature" }));

    await waitFor(() =>
      expect(checkoutGitBranch).toHaveBeenCalledWith(project.id, {
        branchName: "origin/feature",
        branchType: "remote"
      })
    );
  });

  it("shows a cancel action while creating a branch from the compact home picker", async () => {
    useAppStore.setState({
      view: "home",
      activeSessionId: undefined,
      activeProjectId: project.id
    });

    render(<App client={createClient()} />);

    const environment = await screen.findByTestId("home-composer-environment");
    fireEvent.click(await within(environment).findByTestId("home-git-branch-trigger"));
    const popover = await screen.findByTestId("home-git-branch-popover");
    fireEvent.click(within(popover).getByRole("button", { name: "创建并检出新分支..." }));

    expect(screen.getByPlaceholderText("新分支名")).toHaveClass("h-7");
    const cancelButton = within(popover).getByRole("button", { name: "取消" });
    expect(cancelButton).toHaveClass("h-7");

    fireEvent.click(cancelButton);

    await waitFor(() => expect(screen.queryByPlaceholderText("新分支名")).not.toBeInTheDocument());
    expect(
      within(popover).getByRole("button", { name: "创建并检出新分支..." })
    ).toBeInTheDocument();
  });

  it("opens the git graph from the compact home branch picker", async () => {
    const getGitGraph = vi.fn(async () => ({ isRepo: true as const, commits: [] }));
    useAppStore.setState({
      view: "home",
      activeSessionId: undefined,
      activeProjectId: project.id
    });

    render(<App client={createClient({ getGitGraph })} />);

    const environment = await screen.findByTestId("home-composer-environment");
    fireEvent.click(await within(environment).findByTestId("home-git-branch-trigger"));
    fireEvent.click(screen.getByRole("button", { name: "Git 图谱" }));

    expect(await screen.findByTestId("git-graph-dialog")).toBeInTheDocument();
    await waitFor(() => expect(getGitGraph).toHaveBeenCalledWith(project.id));
  });

  it("shows the git environment card for git repositories and opens changes", async () => {
    const getGitChanges = vi.fn(async () => ({ isRepo: true as const, files: [] }));
    const client = createClient({ getGitChanges });

    render(<App client={client} />);

    const card = await screen.findByTestId("git-environment-card");
    expect(card).toBeInTheDocument();
    expect(card).toHaveClass("pointer-events-auto");
    const stack = screen.getByTestId("chat-floating-stack");
    expect(stack).toContainElement(card);
    expect(stack.firstElementChild).toBe(card);
    expect(card).not.toHaveTextContent("本地");
    expect(screen.getByTitle("打开侧边面板")).toBeInTheDocument();
    expect(screen.getByText("环境信息")).toBeInTheDocument();
    expect(screen.getByText("main")).toBeInTheDocument();

    fireEvent.click(screen.getByText("变更"));

    expect(await screen.findByTestId("right-panel")).toBeInTheDocument();
    await waitFor(() => expect(getGitChanges).toHaveBeenCalledWith(project.id));
  });

  it("opens the git graph from the environment card", async () => {
    const getGitGraph = vi.fn(async () => ({ isRepo: true as const, commits: [] }));
    const client = createClient({ getGitGraph });

    render(<App client={client} />);

    const card = await screen.findByTestId("git-environment-card");
    fireEvent.click(within(card).getByText("Git 图谱"));

    expect(await screen.findByTestId("git-graph-dialog")).toBeInTheDocument();
    expect(screen.queryByTestId("right-panel")).not.toBeInTheDocument();
    await waitFor(() => expect(getGitGraph).toHaveBeenCalledWith(project.id));
  });

  it("opens a terminal tab from the environment card", async () => {
    const client = createClient();

    render(<App client={client} />);

    const card = await screen.findByTestId("git-environment-card");
    fireEvent.click(within(card).getByText("打开终端"));

    expect(await screen.findByTestId("right-panel")).toBeInTheDocument();
    await waitFor(() =>
      expect(useAppStore.getState().rightPanelTabs.some((tab) => tab.kind === "terminal")).toBe(
        true
      )
    );
  });

  it("keeps the original toolbar for non-git projects", async () => {
    const getGitEnvironment = vi.fn(async () => nonRepoEnvironment());
    const client = createClient({ getGitEnvironment });

    render(<App client={client} />);

    await waitFor(() => expect(getGitEnvironment).toHaveBeenCalled());
    expect(screen.queryByTestId("git-environment-card")).not.toBeInTheDocument();
    expect(screen.getByTitle("打开侧边面板")).toBeInTheDocument();
  });

  it("checks out a remote branch from the branch picker", async () => {
    const checkoutGitBranch = vi.fn(async () => ({
      environment: { ...gitEnvironment, branchName: "feature" }
    }));
    const client = createClient({ checkoutGitBranch });

    render(<App client={client} />);

    await screen.findByTestId("git-environment-card");
    fireEvent.click(screen.getByText("main"));
    expect(screen.getByPlaceholderText("搜索分支").closest("label")).toHaveClass("h-9");
    const remoteBranchLabel = (await screen.findAllByText("origin/feature"))[0];
    const remoteBranchButton = remoteBranchLabel.closest("button")!;
    expect(remoteBranchButton).toHaveClass("min-h-9");
    fireEvent.click(remoteBranchButton);

    await waitFor(() =>
      expect(checkoutGitBranch).toHaveBeenCalledWith(project.id, {
        branchName: "origin/feature",
        branchType: "remote"
      })
    );
  });

  it("keeps the create branch button readable while disabled", async () => {
    const client = createClient();

    render(<App client={client} />);

    await screen.findByTestId("git-environment-card");
    fireEvent.click(screen.getByText("main"));
    fireEvent.click(await screen.findByText("创建并检出新分支..."));

    const createButton = screen.getByRole("button", { name: "创建" });
    expect(createButton).toBeDisabled();
    expect(createButton).toHaveClass("disabled:text-muted-foreground");
    expect(createButton).not.toHaveClass("text-on-primary");
  });

  it("uses compact sizing for the commit popover", async () => {
    const client = createClient();

    render(<App client={client} />);

    await screen.findByTestId("git-environment-card");
    fireEvent.click(screen.getByText("提交或推送"));

    expect(screen.getByPlaceholderText("提交信息（留空将自动生成）...")).toHaveClass("h-16");
    expect(await screen.findByRole("button", { name: "提交" })).toHaveClass("h-[30px]");
  });

  it("passes the active session id when committing with an empty message", async () => {
    const commitGitChanges = vi.fn(async () => ({
      environment: gitEnvironment,
      commitHash: "abc1234",
      message: "fix: update git card"
    }));
    const client = createClient({ commitGitChanges });

    render(<App client={client} />);

    await screen.findByTestId("git-environment-card");
    fireEvent.click(screen.getByText("提交或推送"));
    fireEvent.click(await screen.findByRole("button", { name: "提交" }));

    await waitFor(() =>
      expect(commitGitChanges).toHaveBeenCalledWith(project.id, {
        message: "",
        includeUnstaged: true,
        sessionId: session.id
      })
    );
  });
});
