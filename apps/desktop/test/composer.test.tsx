// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/renderer/App";
import type { ApiClient } from "../src/renderer/lib/api";
import { resetAppStore, useAppStore } from "../src/renderer/store";
import type {
  ProviderConfig,
  ProviderModelOption,
  SlashCommand,
  ToolCall
} from "@chengxiaobang/shared";

const deepseek: ProviderConfig = {
  id: "deepseek",
  kind: "deepseek",
  name: "DeepSeek",
  baseURL: "https://api.deepseek.com",
  model: "deepseek-v4-flash",
  apiKeyRef: "test:deepseek",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

const kimiUnconfigured: ProviderConfig = {
  id: "kimi",
  kind: "kimi",
  name: "Kimi",
  baseURL: "https://api.moonshot.ai/v1",
  model: "kimi-k2.6",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

const skillCommand: SlashCommand = {
  id: "global:skill:excel",
  name: "/excel",
  kind: "skill",
  description: "处理 Excel 表格",
  source: "global",
  insertText: "/excel "
};

const deepseekModelOptions: ProviderModelOption[] = [
  {
    id: "deepseek-v4-flash",
    label: "DeepSeek V4 Flash",
    providerKind: "deepseek",
    reasoningModes: ["off", "high", "xhigh"],
    source: "catalog"
  },
  {
    id: "deepseek-chat",
    providerKind: "deepseek",
    reasoningModes: [],
    source: "live"
  }
];

function createClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    listProjects: vi.fn(async () => []),
    createProject: vi.fn() as never,
    renameProject: vi.fn() as never,
    deleteProject: vi.fn(async () => true),
    listSessions: vi.fn(async () => []),
    listProjectFiles: vi.fn(async () => []),
    getGitChanges: vi.fn(async () => ({ isRepo: false, files: [] })),
    updateSession: vi.fn() as never,
    deleteSession: vi.fn() as never,
    listMessages: vi.fn(async () => []),
    rewindSession: vi.fn(async () => []),
    forkSession: vi.fn() as never,
    listSessionRuns: vi.fn(async () => ({ runs: [], toolCalls: [] })),
    listSlashCommands: vi.fn(async () => ({ commands: [], diagnostics: [] })),
    listProviders: vi.fn(async () => [deepseek]),
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
    streamRun: vi.fn(async () => {}),
    ...overrides
  };
}

beforeAll(() => {
  // radix Select 在 jsdom 下需要的最小桩（popper 测量 + 滚动 + pointer capture）。
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn(() => false) as never;
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
  window.HTMLElement.prototype.setPointerCapture = vi.fn();
  if (!("ResizeObserver" in window)) {
    (window as never as Record<string, unknown>).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

beforeEach(() => {
  window.localStorage.clear();
  resetAppStore();
});

async function openModelSelect(): Promise<HTMLElement> {
  const trigger = await screen.findByLabelText("选择模型");
  fireEvent.keyDown(trigger, { key: "Enter" });
  return trigger;
}

describe("Composer 模型两级下拉（ARCH-SPEC §6.4）", () => {
  it("selects a model: setProviderId + setModel, and the run request carries providerId + model", async () => {
    const listProviderModelOptions = vi.fn(async () => deepseekModelOptions);
    const streamRun = vi.fn(async (..._args: Parameters<ApiClient["streamRun"]>) => {});
    const client = createClient({
      listProviders: vi.fn(async () => [deepseek, kimiUnconfigured]),
      listProviderModelOptions,
      streamRun: streamRun as never
    });

    render(<App client={client} />);
    await screen.findByTestId("composer-shell");
    await openModelSelect();

    // 模型选项只拉取已配置 API Key 的 provider。
    await waitFor(() => expect(listProviderModelOptions).toHaveBeenCalledWith("deepseek"));
    expect(listProviderModelOptions).not.toHaveBeenCalledWith("kimi");
    expect(await screen.findByText("DeepSeek")).toBeInTheDocument();

    fireEvent.click(await screen.findByText("deepseek-chat"));

    await waitFor(() => {
      expect(useAppStore.getState().providerId).toBe("deepseek");
      expect(useAppStore.getState().model).toBe("deepseek-chat");
    });

    const input = screen.getByLabelText("输入消息");
    fireEvent.change(input, { target: { value: "换个模型跑" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(streamRun).toHaveBeenCalled());
    expect(streamRun.mock.calls[0]?.[0]).toMatchObject({
      providerId: "deepseek",
      model: "deepseek-chat"
    });
  });

  it("falls back to the provider's single default model when the model list fetch fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const listProviderModelOptions = vi.fn(async () => {
      throw new Error("拉取失败");
    });
    const client = createClient({ listProviderModelOptions });

    render(<App client={client} />);
    await screen.findByTestId("composer-shell");
    await openModelSelect();

    await waitFor(() => expect(listProviderModelOptions).toHaveBeenCalledWith("deepseek"));
    // 回退到静态目录：DeepSeek 供应商下默认展示 Flash / Pro。
    expect((await screen.findAllByText("DeepSeek V4 Flash")).length).toBeGreaterThan(0);
    expect(screen.getByText("DeepSeek V4 Pro")).toBeInTheDocument();
    warn.mockRestore();
  });
});

describe("Composer 计划模式（＋下拉 Switch + 标记）", () => {
  it("toggles planMode from the + menu switch, shows the marker, and sends planMode in the run request", async () => {
    const streamRun = vi.fn(async (..._args: Parameters<ApiClient["streamRun"]>) => {});
    const client = createClient({ streamRun: streamRun as never });

    render(<App client={client} />);
    await screen.findByTestId("composer-shell");

    // 打开「＋」下拉，点击「计划模式」开关项。
    const plusTrigger = screen.getByTitle("添加上下文");
    fireEvent.pointerDown(plusTrigger, { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByText("计划模式"));

    expect(useAppStore.getState().planMode).toBe(true);
    // 开启后，「对话」右侧出现蓝色「计划模式」标记（点击可关闭）。
    expect(await screen.findByTitle("关闭计划模式")).toBeInTheDocument();

    const input = screen.getByLabelText("输入消息");
    fireEvent.change(input, { target: { value: "先做个计划" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(streamRun).toHaveBeenCalled());
    expect(streamRun.mock.calls[0]?.[0]).toMatchObject({ planMode: true });
  });

  it("toggles planMode with Shift+Tab in the textarea", async () => {
    const client = createClient();

    render(<App client={client} />);
    await screen.findByTestId("composer-shell");
    const input = screen.getByLabelText("输入消息");

    expect(useAppStore.getState().planMode).toBe(false);
    fireEvent.keyDown(input, { key: "Tab", shiftKey: true });
    expect(useAppStore.getState().planMode).toBe(true);
    fireEvent.keyDown(input, { key: "Tab", shiftKey: true });
    expect(useAppStore.getState().planMode).toBe(false);
  });
});

describe("Composer ask-user 等待期（UI-SPEC §8）", () => {
  it("relaxes the Enter gate and routes composer text as the custom answer", async () => {
    const approve = vi.fn(async () => {});
    const ask: ToolCall = {
      id: "tool_q1",
      runId: "run_1",
      name: "ask_user",
      args: { question: "选哪个方案？", options: ["A", "B"] },
      status: "pending_approval",
      createdAt: "2026-06-11T00:00:01.000Z",
      updatedAt: "2026-06-11T00:00:01.000Z"
    };
    let resolveStream: (() => void) | undefined;
    const streamRun = vi.fn(async (..._args: Parameters<ApiClient["streamRun"]>) => {
      const onEvent = _args[1];
      onEvent({ type: "run_started", runId: "run_1", sessionId: "session_1" });
      onEvent({ type: "tool_call", runId: "run_1", toolCall: ask });
      return new Promise<void>((resolve) => {
        resolveStream = resolve;
      });
    });
    const client = createClient({ approve: approve as never, streamRun: streamRun as never });

    render(<App client={client} />);
    let input = await screen.findByLabelText("输入消息");
    fireEvent.change(input, { target: { value: "开始" } });
    fireEvent.keyDown(input, { key: "Enter" });

    // 等待期 placeholder 切换（运行中会重挂 composer，重新取实例）。
    input = await screen.findByPlaceholderText("程小帮在等你的回答…");

    // 运行中本应拦截 Enter，唯 ask_user 等待期放行并路由为 custom 答案。
    fireEvent.change(input, { target: { value: "都不要，用 C 方案" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(approve).toHaveBeenCalledWith("tool_q1", {
        approved: true,
        answer: { text: "都不要，用 C 方案" }
      })
    );
    expect(streamRun).toHaveBeenCalledTimes(1);
    resolveStream?.();
  });
});

describe("Composer slash 菜单技能标（ARCH-SPEC §5.5）", () => {
  it("marks skill entries with a 「技」 StampBadge", async () => {
    const client = createClient({
      listSlashCommands: vi.fn(async () => ({
        commands: [
          {
            id: "builtin:/ls",
            name: "/ls",
            kind: "builtin_tool" as const,
            description: "列出当前项目目录内容",
            source: "builtin" as const,
            insertText: "/ls "
          },
          skillCommand
        ],
        diagnostics: []
      }))
    });

    render(<App client={client} />);
    const input = await screen.findByLabelText("输入消息");
    fireEvent.change(input, { target: { value: "/" } });

    const menu = await screen.findByLabelText("斜杠命令建议");
    expect(menu).toHaveTextContent("/excel");
    // skill 行带印章标（title/aria-label = 技能），builtin 行不带。
    const badges = within(menu).getAllByTitle("技能");
    expect(badges).toHaveLength(1);
    expect(badges[0]).toHaveTextContent("技");

    fireEvent.click(within(menu).getByText("/excel"));
    expect(input).toHaveValue("/excel ");
  });
});

describe("HomeStarters 目录式启动区（UI-SPEC §3.1 / ARCH-SPEC §5.5）", () => {
  it("submits a complete starter task and runs it on click", async () => {
    const streamRun = vi.fn(async (..._args: Parameters<ApiClient["streamRun"]>) => {});
    const client = createClient({ streamRun: streamRun as never });

    render(<App client={client} />);
    await screen.findByTestId("composer-shell");

    fireEvent.click(screen.getByText("做一份 PPT"));

    // 点击即提交：发起运行，且任务文案已自包含（无需用户再编辑）。
    await waitFor(() => expect(streamRun).toHaveBeenCalled());
    expect(streamRun.mock.calls[0]?.[0]?.prompt).toContain("演示文稿");
  });
});
