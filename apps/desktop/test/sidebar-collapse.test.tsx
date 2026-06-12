// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/renderer/App";
import type { ApiClient } from "../src/renderer/lib/api";
import { resetAppStore, useAppStore } from "../src/renderer/store";
import type { ProviderConfig, Session } from "@chengxiaobang/shared";

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

const session: Session = {
  id: "session_1",
  projectId: null,
  title: "对齐测试",
  providerId: provider.id,
  accessMode: "approval",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

function createClient(): ApiClient {
  return {
    listProjects: vi.fn(async () => []),
    createProject: vi.fn() as never,
    renameProject: vi.fn() as never,
    setProjectPinned: vi.fn() as never,
    deleteProject: vi.fn(async () => true),
    listSessions: vi.fn(async () => []),
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
    streamRun: vi.fn(async () => {})
  };
}

beforeEach(() => {
  window.localStorage.clear();
  delete (window as { chengxiaobang?: unknown }).chengxiaobang;
  resetAppStore();
});

describe("sidebar collapse", () => {
  it("点击折叠按钮隐藏侧边栏，再点展开恢复", async () => {
    render(<App client={createClient()} />);
    await screen.findByTestId("app-sidebar");

    fireEvent.click(screen.getByTitle("收起侧边栏"));

    expect(screen.getByTestId("app-sidebar")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByTestId("app-sidebar")).toHaveAttribute("inert");
    expect(screen.getByTestId("app-sidebar")).toHaveClass("w-0");
    expect(useAppStore.getState().sidebarOpen).toBe(false);

    // 折叠状态持久化到 localStorage，重启后保持。
    await waitFor(() => {
      const raw = window.localStorage.getItem("chengxiaobang.app");
      expect(raw).toBeTruthy();
      expect(JSON.parse(raw!).state.sidebarOpen).toBe(false);
    });

    fireEvent.click(screen.getByTitle("展开侧边栏"));

    expect(await screen.findByTestId("app-sidebar")).toHaveAttribute("aria-hidden", "false");
    expect(screen.getByTestId("app-sidebar")).not.toHaveAttribute("inert");
    expect(screen.getByTestId("app-sidebar")).toHaveClass("w-[272px]");
    expect(useAppStore.getState().sidebarOpen).toBe(true);
  });

  it("在 Electron 窗口中让折叠按钮避开红绿灯并对齐标题让位", async () => {
    window.chengxiaobang = {
      getBackendInfo: vi.fn(async () => undefined),
      pickDirectory: vi.fn(async () => undefined),
      pickFiles: vi.fn(async () => []),
      readFileText: vi.fn() as never
    };

    const client = createClient();
    client.listSessions = vi.fn(async () => [session]);
    useAppStore.setState({ view: "chat", activeSessionId: session.id, sessions: [session] });

    const { container } = render(<App client={client} />);

    const toggle = await screen.findByTitle("收起侧边栏");
    expect(toggle).toHaveClass("left-[84px]", "top-[12px]");

    fireEvent.click(toggle);

    expect(container.querySelector("main header")).toHaveClass("pl-[124px]");
  });
});
