// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Project, ProviderConfig, Session } from "@chengxiaobang/shared";
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

const standaloneSession: Session = {
  ...session,
  id: "session_standalone",
  projectId: null,
  title: "独立对话"
};

const detectedOpeners = [
  {
    id: "vscode",
    name: "VS Code",
    appPath: "/Applications/Visual Studio Code.app",
    iconDataUrl: "data:image/png;base64,code"
  },
  {
    id: "cursor",
    name: "Cursor",
    appPath: "/Applications/Cursor.app",
    iconDataUrl: "data:image/png;base64,cursor"
  }
];

function createClient(options: { sessions?: Session[]; projects?: Project[] } = {}): ApiClient {
  return {
    listProjects: vi.fn(async () => options.projects ?? [project]),
    createProject: vi.fn() as never,
    deleteProject: vi.fn(async () => true),
    listSessions: vi.fn(async () => options.sessions ?? [session]),
    listProjectFiles: vi.fn(async () => []),
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
    streamRun: vi.fn() as never
  };
}

function installBridge(openers = detectedOpeners): {
  detectProjectOpeners: ReturnType<typeof vi.fn>;
  openProjectInApp: ReturnType<typeof vi.fn>;
} {
  const detectProjectOpeners = vi.fn(async () => openers);
  const openProjectInApp = vi.fn(async () => ({ ok: true }));
  window.chengxiaobang = {
    getBackendInfo: vi.fn(async () => undefined),
    pickDirectory: vi.fn(async () => undefined),
    pickFiles: vi.fn(async () => []),
    readFileText: vi.fn() as never,
    detectProjectOpeners,
    openProjectInApp
  };
  return { detectProjectOpeners, openProjectInApp };
}

function installBridgeWithoutProjectOpeners(): void {
  window.chengxiaobang = {
    getBackendInfo: vi.fn(async () => undefined),
    pickDirectory: vi.fn(async () => undefined),
    pickFiles: vi.fn(async () => []),
    readFileText: vi.fn() as never
  };
}

beforeEach(() => {
  window.localStorage.clear();
  resetAppStore();
});

afterEach(() => {
  delete (window as { chengxiaobang?: unknown }).chengxiaobang;
});

describe("project opener menu", () => {
  it("shows the menu trigger when the active session belongs to a project", async () => {
    const { detectProjectOpeners } = installBridge();
    render(<App client={createClient()} />);
    fireEvent.click(await screen.findByText("项目对话"));

    const trigger = await screen.findByTitle("用本机应用打开项目");
    expect(trigger).toHaveClass("bg-canvas-soft", "border-border/60", "px-2.5");
    expect(trigger).not.toHaveClass("shadow-hairline");
    expect(trigger).not.toHaveClass("bg-canvas");
    await waitFor(() => expect(detectProjectOpeners).toHaveBeenCalled());
  });

  it("hides the menu trigger for standalone sessions", async () => {
    installBridge();
    render(<App client={createClient({ sessions: [standaloneSession] })} />);
    fireEvent.click(await screen.findByText("独立对话"));

    await waitFor(() =>
      expect(screen.queryByTitle("用本机应用打开项目")).not.toBeInTheDocument()
    );
  });

  it("keeps the project opener visible when the desktop bridge is unavailable", async () => {
    installBridgeWithoutProjectOpeners();
    render(<App client={createClient()} />);
    fireEvent.click(await screen.findByText("项目对话"));
    const trigger = await screen.findByTitle("用本机应用打开项目");

    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });

    expect(await screen.findByText("请在桌面端使用本机应用打开项目")).toBeInTheDocument();
  });

  it("renders detected apps with icons and opens the project through the selected app", async () => {
    const { openProjectInApp } = installBridge();
    const { container } = render(<App client={createClient()} />);
    fireEvent.click(await screen.findByText("项目对话"));
    const trigger = await screen.findByTitle("用本机应用打开项目");

    await waitFor(() =>
      expect(
        container.querySelector('button img[src="data:image/png;base64,code"]')
      ).toBeInTheDocument()
    );

    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });

    expect(await screen.findByText("VS Code")).toBeInTheDocument();
    expect(screen.getByText("Cursor")).toBeInTheDocument();
    expect(screen.queryByText("Finder")).not.toBeInTheDocument();
    expect(
      document.body.querySelector('img[src="data:image/png;base64,cursor"]')
    ).toBeInTheDocument();

    fireEvent.click(screen.getByText("Cursor"));

    await waitFor(() =>
      expect(openProjectInApp).toHaveBeenCalledWith("/Applications/Cursor.app", project.path)
    );
  });
});
