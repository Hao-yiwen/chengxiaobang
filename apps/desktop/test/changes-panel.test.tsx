// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

let scrollIntoView: ReturnType<typeof vi.fn>;

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
    getGitChangeDiff: vi.fn(async (_projectId, input) => ({
      path: input.path,
      scope: input.scope,
      status: " M",
      diff: ""
    })),
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
  scrollIntoView = vi.fn();
  Object.defineProperty(window.HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: scrollIntoView
  });
  // 变更面板是对话视图里的右侧工具，模拟已完成首启后停在对话（刷新会保留该视图）。
  useAppStore.setState({ view: "chat", onboardingOpen: false, onboardingCompleted: true });
});

describe("changes panel", () => {
  it("renders changed files as a tree and expands a diff", async () => {
    const changes: GitChangesResult = {
      isRepo: true,
      files: [
        {
          path: "src/a.ts",
          scope: "staged",
          status: "MM",
          diff: "",
          additions: 1,
          deletions: 1
        },
        {
          path: "src/a.ts",
          scope: "unstaged",
          status: "MM",
          diff: "",
          additions: 1,
          deletions: 1
        },
        {
          path: "src/components/Button.tsx",
          scope: "unstaged",
          status: " M",
          diff: "",
          additions: 1,
          deletions: 1
        },
        {
          path: "README.md",
          scope: "unstaged",
          status: "??",
          diff: ""
        },
        { path: "blob.bin", scope: "unstaged", status: "??", diff: "" }
      ]
    };
    const getGitChanges = vi.fn(async () => changes);
    const diffFiles = new Map<string, GitChangesResult["files"][number]>([
      [
        "staged:src/a.ts",
        {
          path: "src/a.ts",
          scope: "staged",
          status: "MM",
          diff: patchFor("src/a.ts", "-base line", "+staged line"),
          additions: 1,
          deletions: 1
        }
      ],
      [
        "unstaged:src/a.ts",
        {
          path: "src/a.ts",
          scope: "unstaged",
          status: "MM",
          diff: patchFor("src/a.ts", "-staged line", "+unstaged line"),
          additions: 1,
          deletions: 1
        }
      ],
      [
        "unstaged:blob.bin",
        { path: "blob.bin", scope: "unstaged", status: "??", diff: "" }
      ]
    ]);
    const getGitChangeDiff = vi.fn(async (_projectId: string, input: { scope: string; path: string }) => {
      const file = diffFiles.get(`${input.scope}:${input.path}`);
      if (!file) {
        throw new Error("missing fixture");
      }
      return file;
    });
    const client = createClient({ getGitChanges, getGitChangeDiff: getGitChangeDiff as never });

    render(<App client={client} />);
    await screen.findByText("项目对话");
    await openChangesPane();

    expect(await screen.findByText("4 个文件有变更")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "折叠变更分组 暂存的更改" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "折叠变更分组 更改" })).toBeInTheDocument();
    expect(screen.getByText("暂存的更改")).toBeInTheDocument();
    expect(screen.getByText("更改")).toBeInTheDocument();
    expect(
      within(screen.getByRole("button", { name: "折叠变更分组 暂存的更改" })).getByText("1 个文件")
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("button", { name: "折叠变更分组 更改" })).getByText("4 个文件")
    ).toBeInTheDocument();
    expect(screen.getAllByText("src")).toHaveLength(2);
    expect(screen.getByText("components")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "折叠变更目录 更改 src" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "折叠变更目录 更改 src/components" })).toBeInTheDocument();
    const modifiedFiles = await screen.findAllByText("a.ts");
    expect(modifiedFiles).toHaveLength(2);
    expect(await screen.findByText("Button.tsx")).toBeInTheDocument();
    expect(screen.queryByText("src/a.ts")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "展开变更文件 暂存的更改 src/a.ts" })
    ).not.toHaveAttribute("title");
    expect(screen.getAllByText("修改").length).toBeGreaterThanOrEqual(2);
    expect(await screen.findByText("README.md")).toBeInTheDocument();
    expect(await screen.findByText("blob.bin")).toBeInTheDocument();
    const blobButton = screen.getByRole("button", { name: "展开变更文件 更改 blob.bin" });
    expect(within(blobButton).queryByText("+0")).not.toBeInTheDocument();
    expect(within(blobButton).queryByText("-0")).not.toBeInTheDocument();
    expect(getGitChanges).toHaveBeenCalledWith(project.id);
    expect(screen.queryByPlaceholderText("筛选文件…")).not.toBeInTheDocument();
    expect(screen.queryByText("staged line")).not.toBeInTheDocument();
    expect(screen.queryByText("unstaged line")).not.toBeInTheDocument();
    expect(getGitChangeDiff).not.toHaveBeenCalled();

    const changesGroup = screen.getByRole("button", { name: "折叠变更分组 更改" }).closest("section");
    expect(changesGroup).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "折叠变更目录 更改 src" }));
    expect(within(changesGroup as HTMLElement).queryByText("Button.tsx")).not.toBeInTheDocument();
    expect(within(changesGroup as HTMLElement).queryByText("components")).not.toBeInTheDocument();
    expect(screen.queryByText("unstaged line")).not.toBeInTheDocument();
    expect(getGitChangeDiff).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "展开变更目录 更改 src" }));
    expect(await within(changesGroup as HTMLElement).findByText("Button.tsx")).toBeInTheDocument();

    scrollIntoView.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "展开变更文件 暂存的更改 src/a.ts" }));
    await waitFor(() =>
      expect(getGitChangeDiff).toHaveBeenCalledWith(project.id, {
        scope: "staged",
        path: "src/a.ts"
      })
    );
    const diff = await screen.findByLabelText("变更对比");
    expect(diff).toHaveClass("overflow-visible");
    expect(diff).toHaveTextContent("staged line");
    expect(diff).toHaveTextContent("base line");
    expect(diff).not.toHaveTextContent("unstaged line");
    // 展开后文件行头自身吸顶：sticky 只在该文件 diff 滚过顶部时悬浮，而非常驻顶端
    const stagedHeader = screen.getByRole("button", {
      name: "折叠变更文件 暂存的更改 src/a.ts"
    });
    expect(stagedHeader).toHaveClass("sticky", "top-0");
    // 未展开的文件行头不吸顶
    expect(
      screen.getByRole("button", { name: "展开变更文件 更改 src/a.ts" })
    ).not.toHaveClass("sticky");
    await waitFor(() =>
      expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest", inline: "nearest" })
    );

    fireEvent.click(stagedHeader);
    expect(screen.queryByLabelText("变更对比")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "展开变更文件 更改 src/a.ts" }));
    await waitFor(() =>
      expect(getGitChangeDiff).toHaveBeenCalledWith(project.id, {
        scope: "unstaged",
        path: "src/a.ts"
      })
    );
    const unstagedDiff = await screen.findByLabelText("变更对比");
    expect(unstagedDiff).toHaveTextContent("unstaged line");
    expect(unstagedDiff).toHaveTextContent("staged line");
    expect(unstagedDiff).not.toHaveTextContent("base line");

    expect(within(changesGroup as HTMLElement).getByText("README.md")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "展开变更文件 更改 blob.bin" }));
    await waitFor(() =>
      expect(getGitChangeDiff).toHaveBeenCalledWith(project.id, {
        scope: "unstaged",
        path: "blob.bin"
      })
    );
    expect(
      await screen.findByText("没有可展示的文本差异；文件可能是二进制、过大，或只有元数据变更。")
    ).toBeInTheDocument();
  }, 20_000);

  it("shows an inline error when a single file diff fails to load", async () => {
    const changes: GitChangesResult = {
      isRepo: true,
      files: [{ path: "src/fail.ts", scope: "unstaged", status: " M", diff: "" }]
    };
    const getGitChangeDiff = vi.fn(async () => {
      throw new Error("boom");
    });
    const client = createClient({
      getGitChanges: vi.fn(async () => changes),
      getGitChangeDiff: getGitChangeDiff as never
    });

    render(<App client={client} />);
    await screen.findByText("项目对话");
    await openChangesPane();

    fireEvent.click(await screen.findByRole("button", { name: "展开变更文件 更改 src/fail.ts" }));

    expect(await screen.findByText("加载文件差异失败：boom")).toBeInTheDocument();
    expect(getGitChangeDiff).toHaveBeenCalledWith(project.id, {
      scope: "unstaged",
      path: "src/fail.ts"
    });
  });

  it("reloads on refresh", async () => {
    const getGitChanges = vi
      .fn<() => Promise<GitChangesResult>>()
      .mockResolvedValueOnce({ isRepo: true, files: [] })
      .mockResolvedValueOnce({
        isRepo: true,
        files: [
          {
            path: "new.ts",
            scope: "staged",
            status: "A ",
            diff: "",
            additions: 1,
            deletions: 0
          }
        ]
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
