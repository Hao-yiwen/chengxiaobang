// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/renderer/App";
import type { ApiClient } from "../src/renderer/lib/api";
import { resetAppStore, useAppStore } from "../src/renderer/store";
import type { ProviderConfig, Session, SessionContextUsage } from "@chengxiaobang/shared";

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

const kimi: ProviderConfig = {
  id: "kimi",
  kind: "kimi",
  name: "Kimi",
  baseURL: "https://api.moonshot.ai/v1",
  model: "kimi-k2.7-code",
  apiKeyRef: "test:kimi",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

const session: Session = {
  id: "session_1",
  projectId: null,
  title: "上下文测试",
  providerId: "deepseek",
  accessMode: "approval",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

const contextUsage: SessionContextUsage = {
  sessionId: session.id,
  providerId: "deepseek",
  model: "deepseek-v4-flash",
  estimatedTokens: 120_000,
  systemPromptTokens: 10_000,
  messageTokens: 90_000,
  toolTokens: 20_000,
  messageCount: 4,
  compacted: false,
  contextWindowTokens: 1_000_000,
  autoCompactThresholdRatio: 0.8,
  autoCompactThresholdTokens: 800_000,
  usedRatio: 0.12,
  remainingTokens: 880_000,
  status: "ok",
  sessionCostCny: 0.16
};

function createClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    listProjects: vi.fn(async () => []),
    createProject: vi.fn() as never,
    renameProject: vi.fn() as never,
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
    listProviders: vi.fn(async () => [deepseek, kimi]),
    saveProvider: vi.fn() as never,
    deleteProvider: vi.fn(async () => true),
    testProvider: vi.fn() as never,
    listProviderModels: vi.fn(async () => []),
    listProviderModelOptions: vi.fn(async () => []),
    getSessionContextUsage: vi.fn(async () => contextUsage),
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
  // radix DropdownMenu 在 jsdom 下需要的最小桩（popper 测量 + 滚动 + pointer capture）。
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

async function openModelMenu(): Promise<HTMLElement> {
  const trigger = await screen.findByLabelText("选择模型");
  fireEvent.keyDown(trigger, { key: "Enter" });
  return screen.findByRole("menu");
}

function clickModel(menu: HTMLElement, modelLabel: string): void {
  const row = within(menu).getByText(modelLabel).closest("[role='menuitem']");
  if (!row) {
    throw new Error(`找不到模型行：${modelLabel}`);
  }
  fireEvent.click(row);
}

describe("Composer 模型选择器", () => {
  it("lists configured providers and their YAML-backed models without reasoning controls", async () => {
    render(<App client={createClient()} />);
    await screen.findByLabelText("输入消息");

    const menu = await openModelMenu();

    expect(within(menu).getByText("DeepSeek")).toBeInTheDocument();
    expect(within(menu).getByText("Kimi")).toBeInTheDocument();
    expect(within(menu).getByText("DeepSeek V4 Flash")).toBeInTheDocument();
    expect(within(menu).getByText("Kimi K2.7 Code")).toBeInTheDocument();
    expect(within(menu).queryByText("默认")).not.toBeInTheDocument();
    expect(within(menu).queryByText("关闭")).not.toBeInTheDocument();
    expect(within(menu).queryByText("High")).not.toBeInTheDocument();
  });

  it("selects a model and clears any stale manual reasoning mode", async () => {
    render(<App client={createClient()} />);
    await screen.findByLabelText("输入消息");
    act(() => {
      useAppStore.getState().setReasoningMode("high");
    });

    const menu = await openModelMenu();
    clickModel(menu, "DeepSeek V4 Pro");

    await waitFor(() => expect(useAppStore.getState().model).toBe("deepseek-v4-pro"));
    expect(useAppStore.getState().providerId).toBe("deepseek");
    expect(useAppStore.getState().reasoningMode).toBeUndefined();
    expect(await screen.findByLabelText("选择模型")).toHaveTextContent("DeepSeek V4 Pro");
  });

  it("only lists the models enabled on the provider config", async () => {
    const client = createClient({
      listProviders: vi.fn(async () => [
        { ...deepseek, models: ["deepseek-v4-flash"] },
        kimi
      ])
    });
    render(<App client={client} />);
    await screen.findByLabelText("输入消息");

    const menu = await openModelMenu();

    expect(within(menu).getByText("DeepSeek V4 Flash")).toBeInTheDocument();
    // 未启用的目录模型不出现在菜单里。
    expect(within(menu).queryByText("DeepSeek V4 Pro")).not.toBeInTheDocument();
  });

  it("selects another provider's model directly", async () => {
    render(<App client={createClient()} />);
    await screen.findByLabelText("输入消息");
    act(() => {
      useAppStore.getState().setReasoningMode("high");
    });

    const menu = await openModelMenu();
    clickModel(menu, "Kimi K2.7 Code");
    expect(screen.queryByText("XHigh")).not.toBeInTheDocument();

    await waitFor(() => expect(useAppStore.getState().providerId).toBe("kimi"));
    // 选中的是 Kimi 的默认模型，model 归一为 undefined；旧手动推理模式被清掉。
    expect(useAppStore.getState().model).toBeUndefined();
    expect(useAppStore.getState().reasoningMode).toBeUndefined();

    expect(await screen.findByLabelText("选择模型")).toHaveTextContent("Kimi K2.7 Code");
  });

  it("shows current context usage to the left of the model picker", async () => {
    const client = createClient({
      listSessions: vi.fn(async () => [session]),
      listMessages: vi.fn(async () => [
        {
          id: "msg_1",
          sessionId: session.id,
          role: "user",
          content: "你好",
          createdAt: new Date().toISOString()
        }
      ])
    });
    render(<App client={client} />);
    await screen.findByLabelText("输入消息");

    await act(async () => {
      await useAppStore.getState().selectSession(session.id);
    });

    await waitFor(() => expect(client.getSessionContextUsage).toHaveBeenCalled());
    const indicator = await screen.findByLabelText("当前上下文用量");
    expect(indicator).not.toHaveTextContent("12%");
    await act(async () => {
      fireEvent.pointerEnter(indicator, { pointerType: "mouse" });
      fireEvent.click(indicator);
    });
    const popup = await screen.findByText("估计费用");
    const popupContent = popup.closest("[data-radix-popper-content-wrapper]") ?? document.body;
    expect(within(popupContent as HTMLElement).getByText("使用率")).toBeInTheDocument();
    expect(within(popupContent as HTMLElement).getByText("12%")).toBeInTheDocument();
    expect(within(popupContent as HTMLElement).getByText("约 ¥0.16")).toBeInTheDocument();
  });
});
