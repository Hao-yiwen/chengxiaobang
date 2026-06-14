// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Message,
  ProviderConfig,
  Session,
  SessionDebugContext,
  ToolCall
} from "@chengxiaobang/shared";
import { App } from "../src/renderer/App";
import type { ApiClient } from "../src/renderer/lib/api";
import { resetAppStore, useAppStore } from "../src/renderer/store";

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

const session: Session = {
  id: "session_1",
  projectId: null,
  title: "调试会话",
  providerId: provider.id,
  accessMode: "approval",
  createdAt: "2026-06-13T00:00:00.000Z",
  updatedAt: "2026-06-13T00:00:00.000Z"
};

const message: Message = {
  id: "msg_1",
  sessionId: session.id,
  role: "user",
  content: "你好",
  createdAt: "2026-06-13T00:00:00.000Z"
};

const assistantMessage: Message = {
  id: "msg_2",
  sessionId: session.id,
  role: "assistant",
  content: "我来读取 README。",
  reasoning: "需要先确认项目说明。",
  reasoningMs: 1200,
  createdAt: "2026-06-13T00:00:00.500Z"
};

const toolResultMessage: Message = {
  id: "msg_3",
  sessionId: session.id,
  role: "tool",
  content: "README 第一段内容\nREADME 第二段内容",
  createdAt: "2026-06-13T00:00:01.500Z"
};

const toolCall: ToolCall = {
  id: "tool_1",
  runId: "run_1",
  name: "read_file",
  args: { path: "README.md" },
  status: "completed",
  result: "ok",
  createdAt: "2026-06-13T00:00:01.000Z",
  updatedAt: "2026-06-13T00:00:01.000Z"
};

function createDebugContext(): SessionDebugContext {
  return {
    session,
    project: null,
    workspacePath: "/tmp/chengxiaobang/session_1",
    accessMode: "approval",
    planMode: false,
    viaFeishu: false,
    systemPrompt: "SYSTEM PROMPT\n工作目录: /tmp/chengxiaobang/session_1",
    modelMessages: [{ role: "user", content: "你好", timestamp: 1 }],
    messages: [message, assistantMessage, toolResultMessage],
    runs: [
      {
        id: "run_1",
        sessionId: session.id,
        status: "completed",
        createdAt: "2026-06-13T00:00:01.000Z",
        updatedAt: "2026-06-13T00:00:02.000Z"
      }
    ],
    toolCalls: [toolCall],
    skills: [],
    availableTools: [
      {
        name: "read_file",
        label: "读取文件",
        description: "读取工作目录中的文件",
        requiresApproval: false
      },
      {
        name: "write_file",
        label: "写入文件",
        description: "写入或覆盖工作目录中的文件",
        requiresApproval: true
      }
    ],
    generatedAt: "2026-06-13T00:00:03.000Z"
  };
}

function createClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    listProjects: vi.fn(async () => []),
    createProject: vi.fn() as never,
    renameProject: vi.fn() as never,
    setProjectPinned: vi.fn() as never,
    deleteProject: vi.fn(async () => true),
    listSessions: vi.fn(async () => [session]),
    listProjectFiles: vi.fn(async () => []),
    listProjectDirectory: vi.fn(async () => []),
    getGitChanges: vi.fn(async () => ({ isRepo: false, files: [] })),
    updateSession: vi.fn() as never,
    deleteSession: vi.fn() as never,
    listMessages: vi.fn(async () => [message, assistantMessage]),
    rewindSession: vi.fn(async () => []),
    forkSession: vi.fn() as never,
    listSessionRuns: vi.fn(async () => ({ runs: [], toolCalls: [] })),
    getSessionDebugContext: vi.fn(async () => createDebugContext()),
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
    streamRun: vi.fn(async () => {}),
    ...overrides
  };
}

beforeEach(() => {
  window.localStorage.clear();
  resetAppStore();
  useAppStore.setState({
    view: "chat",
    activeSessionId: session.id,
    notice: "测试 Toast",
    onboardingOpen: false,
    onboardingCompleted: true
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SessionDebugButton", () => {
  it("shows a concise readable transcript with model, prompt, messages, and tool summary", async () => {
    const getSessionDebugContext = vi.fn(async () => createDebugContext());
    render(<App client={createClient({ getSessionDebugContext })} />);

    expect(await screen.findByText("你好")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Debug" }));

    await waitFor(() =>
      expect(getSessionDebugContext).toHaveBeenCalledWith("session_1", { planMode: false })
    );
    expect(await screen.findByText("会话 Debug")).toBeInTheDocument();
    expect(screen.getByText(/工具调用默认展开，工具结果默认折叠/)).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /完整流程/ })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    const report = within(screen.getByTestId("debug-report"));
    expect(report.getByText("会话 Debug 精简记录")).toBeInTheDocument();
    expect(report.getByText("模型: DeepSeek (deepseek)")).toBeInTheDocument();
    expect(report.getByText("模型名称: deepseek-v4-flash")).toBeInTheDocument();
    expect(report.getByText(/SYSTEM PROMPT/)).toBeInTheDocument();
    expect(report.getAllByText(/用户输入/).length).toBeGreaterThanOrEqual(1);
    expect(report.getByText("你好")).toBeInTheDocument();
    expect(report.getByText(/助手思考/)).toBeInTheDocument();
    expect(report.getByText(/需要先确认项目说明/)).toBeInTheDocument();
    expect(report.getByText(/助手回复/)).toBeInTheDocument();
    expect(report.getByText(/我来读取 README。/)).toBeInTheDocument();
    expect(report.getByText(/工具调用: read_file/)).toBeInTheDocument();
    expect(report.getAllByText(/参数: path=README.md/).length).toBeGreaterThanOrEqual(1);
    const toolDetails = report.getByTestId("debug-tool-tool_1");
    expect(toolDetails).toHaveAttribute("open");
    fireEvent.click(report.getByText(/工具调用: read_file/));
    expect(toolDetails).not.toHaveAttribute("open");
    expect(toolDetails).not.toHaveTextContent("结果: ok");
    const resultMessage = report.getByTestId("debug-tool-result-message-msg_3");
    expect(resultMessage).not.toHaveAttribute("open");
    fireEvent.click(report.getByText(/工具结果消息/));
    expect(resultMessage).toHaveAttribute("open");
    expect(report.queryByText("测试 Toast")).not.toBeInTheDocument();
    expect(report.queryByText("模型上下文")).not.toBeInTheDocument();
    expect(report.queryByText("Run 记录")).not.toBeInTheDocument();
    expect(report.queryByText("timestamp")).not.toBeInTheDocument();
    expect(screen.queryByText("工具与运行")).not.toBeInTheDocument();
    expect(screen.queryByText("Toast 与事件")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /可用工具/ }));
    expect(screen.getByRole("tab", { name: /可用工具/ })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    expect(screen.getByText(/展示当前会话会交给模型的 2 个工具/)).toBeInTheDocument();
    const tools = within(screen.getByTestId("debug-tools"));
    expect(tools.getByText("当前可用工具")).toBeInTheDocument();
    expect(tools.getByText("工具数量: 2")).toBeInTheDocument();
    expect(tools.getByText("访问模式: 需要审批")).toBeInTheDocument();
    expect(tools.getByText("read_file")).toBeInTheDocument();
    expect(tools.getByText("读取文件")).toBeInTheDocument();
    expect(tools.getByText("读取工作目录中的文件")).toBeInTheDocument();
    expect(tools.getByText("自动可用")).toBeInTheDocument();
    expect(tools.getByText("write_file")).toBeInTheDocument();
    expect(tools.getByText("写入文件")).toBeInTheDocument();
    expect(tools.getByText("写入或覆盖工作目录中的文件")).toBeInTheDocument();
    expect(tools.getByText("需要审批")).toBeInTheDocument();
  });
});
