// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { GitGraphResult, Project } from "@chengxiaobang/shared";
import { GitGraphDialog } from "../src/renderer/components/git-environment/GitGraphDialog";
import { setupI18n } from "../src/renderer/i18n";
import type { ApiClient } from "../src/renderer/lib/api";
import { setApiClient } from "../src/renderer/store/client";
import { resetAppStore, useAppStore } from "../src/renderer/store";

const project: Project = {
  id: "project_git_graph",
  name: "demo",
  path: "/tmp/demo",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

const graph: GitGraphResult = {
  isRepo: true,
  head: "main",
  commits: [
    {
      hash: "abc123456789",
      shortHash: "abc1234",
      parents: ["def123456789", "fed123456789"],
      subject: "merge feature",
      authorName: "Ada",
      date: "2026-06-24T12:30:00+08:00",
      refs: [
        { name: "HEAD", type: "head" },
        { name: "main", type: "local" },
        { name: "origin/main", type: "remote" },
        { name: "v1", type: "tag" }
      ]
    },
    {
      hash: "def123456789",
      shortHash: "def1234",
      parents: [],
      subject: "chore: base",
      authorName: "Lin",
      date: "2026-06-23T09:00:00+08:00",
      refs: []
    }
  ]
};

function installClient(getGitGraph: ApiClient["getGitGraph"]): void {
  setApiClient({ getGitGraph } as unknown as ApiClient);
}

beforeAll(() => {
  setupI18n("zh");
});

beforeEach(() => {
  resetAppStore();
  useAppStore.setState({
    projects: [project],
    activeProjectId: project.id,
    onboardingOpen: false,
    onboardingCompleted: true
  });
});

describe("GitGraphDialog", () => {
  it("renders commit rows, refs and svg graph", async () => {
    const getGitGraph = vi.fn(async () => graph);
    installClient(getGitGraph);
    render(<GitGraphDialog open onOpenChange={vi.fn()} />);

    expect(await screen.findByText("merge feature")).toBeInTheDocument();
    expect(screen.getByTestId("git-graph-dialog")).toBeInTheDocument();
    expect(screen.getByText("main")).toBeInTheDocument();
    expect(screen.getByText("origin/main")).toBeInTheDocument();
    expect(screen.getByText("v1")).toBeInTheDocument();
    expect(screen.getByText("abc1234")).toBeInTheDocument();
    expect(
      screen.getByTestId("git-graph-svg").querySelectorAll("circle")
    ).toHaveLength(2);
  });

  it("shows commit details after selecting a row", async () => {
    installClient(vi.fn(async () => graph));
    render(<GitGraphDialog open onOpenChange={vi.fn()} />);

    fireEvent.click(await screen.findByText("merge feature"));

    expect(screen.getByText("主题")).toBeInTheDocument();
    expect(screen.getByText("abc123456789")).toBeInTheDocument();
    expect(screen.getAllByText("Ada")).toHaveLength(2);
    expect(screen.getByText("def1234, fed1234")).toBeInTheDocument();
  });

  it("closes from the toolbar", async () => {
    const onOpenChange = vi.fn();
    installClient(vi.fn(async () => graph));
    render(<GitGraphDialog open onOpenChange={onOpenChange} />);

    expect(await screen.findByTestId("git-graph-dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "关闭面板" }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("refreshes from the toolbar", async () => {
    const getGitGraph = vi
      .fn()
      .mockResolvedValueOnce(graph)
      .mockResolvedValueOnce({
        ...graph,
        commits: [{ ...graph.commits[0], hash: "9999999", shortHash: "9999999", subject: "fix: refreshed" }]
      });
    installClient(getGitGraph);
    render(<GitGraphDialog open onOpenChange={vi.fn()} />);

    expect(await screen.findByText("merge feature")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "刷新" }));

    expect(await screen.findByText("fix: refreshed")).toBeInTheDocument();
    expect(getGitGraph).toHaveBeenCalledTimes(2);
  });

  it("reloads when git changes are notified", async () => {
    const getGitGraph = vi.fn(async () => graph);
    installClient(getGitGraph);
    render(<GitGraphDialog open onOpenChange={vi.fn()} />);

    await waitFor(() => expect(getGitGraph).toHaveBeenCalledTimes(1));
    act(() => {
      useAppStore.getState().notifyGitChanged(project.id);
    });

    await waitFor(() => expect(getGitGraph).toHaveBeenCalledTimes(2));
  });

  it("shows non-repo empty state", async () => {
    installClient(vi.fn(async () => ({ isRepo: false, commits: [] })));
    render(<GitGraphDialog open onOpenChange={vi.fn()} />);

    expect(await screen.findByText("当前项目不是 Git 仓库。")).toBeInTheDocument();
  });
});
