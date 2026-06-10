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

// 9 project sessions so the match sits past the per-group cap of 8, plus
// two standalone conversations for the basic filter case.
const projectSessions = Array.from({ length: 8 }, (_, index) =>
  session(`p${index}`, `项目会话${index}`, project.id)
).concat([session("p-target", "唯一目标", project.id)]);

const sessions = [session("s1", "旧标题A"), session("s2", "另一个B"), ...projectSessions];

function createClient(): ApiClient {
  return {
    listProjects: vi.fn(async () => [project]),
    createProject: vi.fn() as never,
    listSessions: vi.fn(async () => sessions),
    updateSession: vi.fn() as never,
    deleteSession: vi.fn() as never,
    listMessages: vi.fn(async () => []),
    rewindSession: vi.fn(async () => []),
    listSessionRuns: vi.fn(async () => ({ runs: [], toolCalls: [] })),
    listSlashCommands: vi.fn(async () => ({ commands: [], diagnostics: [] })),
    listProviders: vi.fn(async () => [provider]),
    saveProvider: vi.fn() as never,
    deleteProvider: vi.fn(async () => true),
    testProvider: vi.fn() as never,
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

describe("sidebar session filter", () => {
  it("filters sessions by title and reveals matches past the group cap", async () => {
    render(<App client={createClient()} />);
    await screen.findByText("旧标题A");

    // The 9th project session is hidden by the per-group display cap.
    expect(screen.queryByText("唯一目标")).not.toBeInTheDocument();

    const input = screen.getByLabelText("搜索对话");
    fireEvent.change(input, { target: { value: "唯一" } });

    expect(await screen.findByText("唯一目标")).toBeInTheDocument();
    expect(screen.queryByText("旧标题A")).not.toBeInTheDocument();
    expect(screen.queryByText("另一个B")).not.toBeInTheDocument();

    // Clearing restores the full list (and re-hides the capped session).
    fireEvent.click(screen.getByTitle("清除搜索"));
    expect(await screen.findByText("旧标题A")).toBeInTheDocument();
    expect(screen.getByText("另一个B")).toBeInTheDocument();
    expect(screen.queryByText("唯一目标")).not.toBeInTheDocument();
  });

  it("exports a non-active session as markdown from its hover action", async () => {
    const createObjectURL = vi.fn(() => "blob:mock");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL, revokeObjectURL }));
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);

    const client = createClient();
    render(<App client={client} />);
    const row = (await screen.findByText("另一个B")).closest("div");

    fireEvent.click(within(row as HTMLElement).getByTitle("导出为 Markdown"));

    await waitFor(() => expect(client.listMessages).toHaveBeenCalledWith("s2"));
    expect(client.listSessionRuns).toHaveBeenCalledWith("s2");
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
    expect(createObjectURL).toHaveBeenCalledTimes(1);

    click.mockRestore();
    vi.unstubAllGlobals();
  });

  it("shows a no-matches hint and clears with Escape", async () => {
    render(<App client={createClient()} />);
    await screen.findByText("旧标题A");

    const input = screen.getByLabelText("搜索对话");
    fireEvent.change(input, { target: { value: "zzz不存在" } });

    expect(await screen.findByText("没有匹配的对话")).toBeInTheDocument();

    fireEvent.keyDown(input, { key: "Escape" });
    await waitFor(() => expect(screen.getByText("旧标题A")).toBeInTheDocument());
    expect(input).toHaveValue("");
  });
});
