// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  GitChangesResult,
  Project,
  ProviderConfig,
  Session
} from "@chengxiaobang/shared";
import { App } from "../src/renderer/App";
import { setupI18n } from "../src/renderer/i18n";
import type { ApiClient } from "../src/renderer/lib/api";
import { resetAppStore, useAppStore } from "../src/renderer/store";

vi.mock("@pierre/diffs/react", () => ({
  FileDiff: ({ fileDiff }: { fileDiff: { additionLines: string[]; deletionLines: string[] } }) =>
    [...fileDiff.deletionLines, ...fileDiff.additionLines].join("\n"),
  MultiFileDiff: ({
    oldFile,
    newFile
  }: {
    oldFile: { contents: string };
    newFile: { contents: string };
  }) => `${oldFile.contents}\n${newFile.contents}`
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
        { path: "src/a.ts", status: " M", diff: patchFor("src/a.ts", "-old line", "+new line") },
        { path: "fresh.txt", status: "??", diff: untrackedPatchFor("fresh.txt", ["alpha"]) },
        { path: "blob.bin", status: "??", diff: "" }
      ]
    };
    const getGitChanges = vi.fn(async () => changes);
    const client = createClient({ getGitChanges });

    render(<App client={client} />);
    await screen.findByText("项目对话");
    await openChangesPane();

    expect(await screen.findByText("3 个文件有变更")).toBeInTheDocument();
    const modifiedFile = await screen.findByText("a.ts");
    expect(modifiedFile).toBeInTheDocument();
    expect(screen.queryByText("src/a.ts")).not.toBeInTheDocument();
    expect(screen.getByTitle("src/a.ts")).toBeInTheDocument();
    expect(screen.getByText("修改")).toBeInTheDocument();
    expect(await screen.findByText("fresh.txt")).toBeInTheDocument();
    expect(await screen.findByText("blob.bin")).toBeInTheDocument();
    expect(getGitChanges).toHaveBeenCalledWith(project.id);
    expect(screen.queryByPlaceholderText("筛选文件…")).not.toBeInTheDocument();
    expect(screen.queryByText("new line")).not.toBeInTheDocument();

    fireEvent.click(modifiedFile);
    const diff = await screen.findByLabelText("变更对比");
    expect(diff).toHaveTextContent("new line");
    expect(diff).toHaveTextContent("old line");

    fireEvent.click(screen.getByText("blob.bin"));
    expect(await screen.findByText("二进制或过大文件，不展示内容")).toBeInTheDocument();
  });

  it("reloads on refresh", async () => {
    const getGitChanges = vi
      .fn<() => Promise<GitChangesResult>>()
      .mockResolvedValueOnce({ isRepo: true, files: [] })
      .mockResolvedValueOnce({
        isRepo: true,
        files: [{ path: "new.ts", status: "A ", diff: untrackedPatchFor("new.ts", ["x"]) }]
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

function patchFor(path: string, removed: string, added: string): string {
  return [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    "@@ -1 +1 @@",
    removed,
    added
  ].join("\n");
}

function untrackedPatchFor(path: string, lines: string[]): string {
  return [
    `diff --git a/${path} b/${path}`,
    "new file mode 100644",
    "--- /dev/null",
    `+++ b/${path}`,
    `@@ -0,0 +1,${lines.length} @@`,
    ...lines.map((line) => `+${line}`)
  ].join("\n");
}
