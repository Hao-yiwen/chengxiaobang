// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  GitChangesResult,
  Project,
  ProjectFileEntry,
  ProviderConfig,
  Session
} from "@chengxiaobang/shared";
import { App } from "../src/renderer/App";
import { setupI18n } from "../src/renderer/i18n";
import type { ApiClient } from "../src/renderer/lib/api";
import { resetAppStore, useAppStore } from "../src/renderer/store";

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

const session: Session = {
  id: "session_1",
  projectId: project.id,
  title: "项目对话",
  providerId: provider.id,
  accessMode: "approval",
  createdAt: "2026-06-08T00:00:00.000Z",
  updatedAt: "2026-06-08T00:00:02.000Z"
};

function createClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    listProjects: vi.fn(async () => [project]),
    createProject: vi.fn() as never,
    deleteProject: vi.fn(async () => true),
    listSessions: vi.fn(async () => [session]),
    listProjectFiles: vi.fn(async () => []),
    listProjectDirectory: vi.fn(async () => []),
    getGitInfo: vi.fn(async () => ({ isRepo: true })),
    getGitChanges: vi.fn(async () => ({ isRepo: false, files: [] })),
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

async function openChangesPane(): Promise<void> {
  fireEvent.click(screen.getByTitle("打开侧边面板"));
  fireEvent.click(await screen.findByRole("button", { name: "审查" }));
}

beforeAll(() => {
  setupI18n("zh");
});

beforeEach(() => {
  window.localStorage.clear();
  resetAppStore();
  // 变更面板是对话视图里的右侧工具，模拟已完成首启后停在对话（刷新会保留该视图）。
  useAppStore.setState({ view: "chat", onboardingOpen: false, onboardingCompleted: true });
});

describe("changes panel", () => {
  it("lists changed files with status labels and expands a diff", async () => {
    const changes: GitChangesResult = {
      isRepo: true,
      files: [
        { path: "src/a.ts", status: " M", diff: "@@ -1 +1 @@\n-old line\n+new line" },
        { path: "fresh.txt", status: "??", diff: "+alpha" },
        { path: "blob.bin", status: "??", diff: "" }
      ]
    };
    const getGitChanges = vi.fn(async () => changes);
    const listProjectDirectory = vi.fn(async (_projectId: string, directory = ".") => {
      if (directory === ".") {
        return [
          { name: "src", path: "src", type: "directory" },
          { name: "fresh.txt", path: "fresh.txt", type: "file" },
          { name: "blob.bin", path: "blob.bin", type: "file" }
        ] satisfies ProjectFileEntry[];
      }
      if (directory === "src") {
        return [
          { name: "a.ts", path: "src/a.ts", type: "file" }
        ] satisfies ProjectFileEntry[];
      }
      return [] satisfies ProjectFileEntry[];
    });
    const client = createClient({ getGitChanges, listProjectDirectory });

    render(<App client={client} />);
    await screen.findByText("项目对话");
    await openChangesPane();

    expect(await screen.findByText("3 个文件有变更")).toBeInTheDocument();
    const modifiedFile = await screen.findByText("src/a.ts");
    expect(modifiedFile).toBeInTheDocument();
    expect(screen.getByText("修改")).toBeInTheDocument();
    expect(await screen.findByText("fresh.txt")).toBeInTheDocument();
    expect(await screen.findByText("blob.bin")).toBeInTheDocument();
    expect(getGitChanges).toHaveBeenCalledWith(project.id);

    fireEvent.click(modifiedFile);
    expect(await screen.findByText("new line")).toBeInTheDocument();
    expect(screen.getByText("old line")).toBeInTheDocument();

    fireEvent.click(screen.getByText("blob.bin"));
    expect(await screen.findByText("二进制或过大文件，不展示内容")).toBeInTheDocument();
  });

  it("reloads on refresh", async () => {
    const getGitChanges = vi
      .fn<() => Promise<GitChangesResult>>()
      .mockResolvedValueOnce({ isRepo: true, files: [] })
      .mockResolvedValueOnce({
        isRepo: true,
        files: [{ path: "new.ts", status: "A ", diff: "+x" }]
      });
    const client = createClient({ getGitChanges: getGitChanges as never });

    render(<App client={client} />);
    await screen.findByText("项目对话");
    await openChangesPane();

    expect(await screen.findByText("没有未提交的变更。")).toBeInTheDocument();

    fireEvent.click(screen.getByTitle("刷新"));
    expect(await screen.findByText("new.ts")).toBeInTheDocument();
    expect(getGitChanges).toHaveBeenCalledTimes(2);
  });

  it("hides the changes entry for non-repo projects", async () => {
    const getGitInfo = vi.fn(async () => ({ isRepo: false }));
    const client = createClient({ getGitInfo });

    render(<App client={client} />);
    await screen.findByText("项目对话");
    await waitFor(() => expect(getGitInfo).toHaveBeenCalledWith(project.id));
    fireEvent.click(screen.getByTitle("打开侧边面板"));

    expect(screen.queryByRole("button", { name: "审查" })).not.toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "终端" })).toBeInTheDocument();
  });
});
