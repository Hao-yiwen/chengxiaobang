// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/renderer/App";
import type { ApiClient } from "../src/renderer/lib/api";
import { resetAppStore } from "../src/renderer/store";
import type { Project, ProviderConfig, Session, ToolCall } from "@chengxiaobang/shared";

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
    listSessions: vi.fn(async () => [session]),
    updateSession: vi.fn() as never,
    deleteSession: vi.fn() as never,
    listMessages: vi.fn(async () => []),
    listSessionRuns: vi.fn(async () => ({ runs: [], toolCalls: [] })),
    listSlashCommands: vi.fn(async () => ({ commands: [], diagnostics: [] })),
    listProviders: vi.fn(async () => [provider]),
    saveProvider: vi.fn() as never,
    deleteProvider: vi.fn(async () => true),
    testProvider: vi.fn() as never,
    getFeishuConfig: vi.fn(async () => ({ enabled: false, appId: "", domain: "feishu" as const, fullAccess: false })),
    saveFeishuConfig: vi.fn() as never,
    getFeishuStatus: vi.fn(async () => ({ status: "disconnected" as const })),
    approve: vi.fn() as never,
    abort: vi.fn() as never,
    terminalExec: vi.fn() as never,
    streamRun: vi.fn() as never,
    ...overrides
  };
}

beforeEach(() => {
  window.localStorage.clear();
  resetAppStore();
});

afterEach(() => {
  delete (window as { chengxiaobang?: unknown }).chengxiaobang;
});

describe("right panel", () => {
  it("runs terminal commands in the active project and shows output and exit codes", async () => {
    const terminalExec = vi
      .fn()
      .mockResolvedValueOnce({ output: "hello.txt", exitCode: 0 })
      .mockResolvedValueOnce({ output: "boom", exitCode: 2 });
    const client = createClient({ terminalExec: terminalExec as never });

    render(<App client={client} />);
    await screen.findByText("项目对话");

    fireEvent.click(screen.getByTitle("终端"));
    const input = await screen.findByLabelText("输入命令，回车执行");

    fireEvent.change(input, { target: { value: "ls" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(await screen.findByText("hello.txt")).toBeInTheDocument();
    expect(terminalExec).toHaveBeenCalledWith({ projectId: "project_1", command: "ls" });

    fireEvent.change(input, { target: { value: "false" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(await screen.findByText("boom")).toBeInTheDocument();
    expect(await screen.findByText("退出码 2")).toBeInTheDocument();
  });

  it("asks for a project before offering the terminal", async () => {
    const client = createClient({
      listProjects: vi.fn(async () => []),
      listSessions: vi.fn(async () => [])
    });

    render(<App client={client} />);
    await screen.findByText("今天想做点什么？");

    fireEvent.click(screen.getByTitle("终端"));

    expect(
      await screen.findByText("请先打开一个项目文件夹，终端会在项目目录中执行命令。")
    ).toBeInTheDocument();
  });

  it("opens the file preview from a tool call's path chip", async () => {
    const readFileText = vi.fn(async (path: string) => ({
      path,
      name: "a.ts",
      ok: true as const,
      text: "line one\nline two",
      size: 17
    }));
    window.chengxiaobang = {
      getBackendInfo: vi.fn(async () => undefined),
      pickDirectory: vi.fn(async () => undefined),
      pickFiles: vi.fn(async () => []),
      readFileText
    };
    const toolCall: ToolCall = {
      id: "tool_1",
      runId: "run_1",
      name: "read_file",
      args: { path: "src/a.ts" },
      status: "completed",
      result: "line one\nline two",
      createdAt: "2026-06-08T00:00:01.000Z",
      updatedAt: "2026-06-08T00:00:01.000Z"
    };
    const client = createClient({
      listSessionRuns: vi.fn(async () => ({
        runs: [
          {
            id: "run_1",
            sessionId: session.id,
            status: "completed" as const,
            createdAt: "2026-06-08T00:00:00.000Z",
            updatedAt: "2026-06-08T00:00:02.000Z"
          }
        ],
        toolCalls: [toolCall]
      }))
    });

    render(<App client={client} />);
    await screen.findByText("read_file");

    fireEvent.click(screen.getByTitle("预览文件"));

    expect(await screen.findByText("a.ts")).toBeInTheDocument();
    expect(await screen.findByText("line two")).toBeInTheDocument();
    expect(readFileText).toHaveBeenCalledWith("/tmp/demo/src/a.ts");
  });

  it("browses to a normalized URL via the iframe fallback", async () => {
    const client = createClient();

    const { container } = render(<App client={client} />);
    await screen.findByText("项目对话");

    fireEvent.click(screen.getByTitle("浏览器"));
    const input = await screen.findByLabelText("输入网址，回车访问");

    fireEvent.change(input, { target: { value: "example.com" } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);

    const frame = container.querySelector("iframe");
    expect(frame).not.toBeNull();
    expect(frame?.getAttribute("src")).toBe("https://example.com/");
  });
});
