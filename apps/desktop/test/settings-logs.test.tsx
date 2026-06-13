// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderConfig } from "@chengxiaobang/shared";
import { App } from "../src/renderer/App";
import type { ApiClient } from "../src/renderer/lib/api";
import { resetAppStore } from "../src/renderer/store";

const provider: ProviderConfig = {
  id: "deepseek",
  kind: "deepseek",
  name: "DeepSeek",
  baseURL: "https://api.deepseek.com",
  model: "deepseek-v4-flash",
  apiKeyRef: "test:deepseek",
  createdAt: "2026-06-13T00:00:00.000Z",
  updatedAt: "2026-06-13T00:00:00.000Z"
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
    listProjectDirectory: vi.fn(async () => []),
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
    listTasks: vi.fn(async () => []),
    updateTask: vi.fn() as never,
    deleteTask: vi.fn(async () => true),
    runTaskNow: vi.fn(async () => {}),
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
  resetAppStore();
});

afterEach(() => {
  delete (window as { chengxiaobang?: unknown }).chengxiaobang;
});

describe("settings developer logs", () => {
  it("opens the desktop log folder from development settings", async () => {
    const openLogDir = vi.fn(async () => ({ ok: true, path: "/tmp/cxb-logs" }));
    window.chengxiaobang = {
      getBackendInfo: vi.fn(async () => undefined),
      pickDirectory: vi.fn(async () => undefined),
      pickFiles: vi.fn(async () => []),
      readFileText: vi.fn() as never,
      openLogDir
    };

    render(<App client={createClient()} />);

    fireEvent.click(await screen.findByText("设置"));
    fireEvent.click(await screen.findByText("常规"));
    fireEvent.click(await screen.findByRole("button", { name: "查看日志" }));

    await waitFor(() => expect(openLogDir).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("已打开日志目录：/tmp/cxb-logs")).toBeInTheDocument();
  });
});
