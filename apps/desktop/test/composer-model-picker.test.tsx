// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/renderer/App";
import type { ApiClient } from "../src/renderer/lib/api";
import { resetAppStore, useAppStore } from "../src/renderer/store";
import type { ProviderConfig } from "@chengxiaobang/shared";

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

describe("Composer 模型 + 推理联动选择器", () => {
  it("shows models and the current model's reasoning modes inside one menu", async () => {
    render(<App client={createClient()} />);
    await screen.findByLabelText("输入消息");

    const menu = await openModelMenu();

    // 同一个菜单里：供应商分组的模型项 + 当前模型的推理段。
    expect(within(menu).getByText("DeepSeek")).toBeInTheDocument();
    expect(within(menu).getByText("Kimi")).toBeInTheDocument();
    expect(within(menu).getByText("DeepSeek V4 Flash")).toBeInTheDocument();
    expect(within(menu).getByText("推理模式")).toBeInTheDocument();
    // deepseek-v4-flash 支持 off/high/xhigh，外加「默认」项。
    expect(within(menu).getByText("默认")).toBeInTheDocument();
    expect(within(menu).getByText("关闭")).toBeInTheDocument();
    expect(within(menu).getByText("High")).toBeInTheDocument();
    expect(within(menu).getByText("XHigh")).toBeInTheDocument();
  });

  it("sets reasoningMode from the menu and reflects it on the trigger", async () => {
    render(<App client={createClient()} />);
    await screen.findByLabelText("输入消息");

    const menu = await openModelMenu();
    fireEvent.click(within(menu).getByText("High"));

    await waitFor(() => expect(useAppStore.getState().reasoningMode).toBe("high"));
    expect(await screen.findByLabelText("选择模型")).toHaveTextContent(
      /DeepSeek V4 Flash\s*· High/
    );
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

  it("keeps the menu open on model switch and syncs the reasoning section to the new model", async () => {
    render(<App client={createClient()} />);
    await screen.findByLabelText("输入消息");
    useAppStore.getState().setReasoningMode("high");

    const menu = await openModelMenu();
    fireEvent.click(within(menu).getByText("Kimi K2.7 Code"));

    await waitFor(() => expect(useAppStore.getState().providerId).toBe("kimi"));
    // 选中的是 kimi 的默认模型，model 归一为 undefined；推理模式不被 K2.7 Code 支持，被清掉。
    expect(useAppStore.getState().model).toBeUndefined();
    expect(useAppStore.getState().reasoningMode).toBeUndefined();

    // 菜单保持打开，推理段联动为「始终开启」（K2.7 Code 无可选推理强度）。
    const openMenu = screen.getByRole("menu");
    expect(within(openMenu).getByText("始终开启")).toBeInTheDocument();
    expect(within(openMenu).queryByText("XHigh")).not.toBeInTheDocument();

    expect(await screen.findByLabelText("选择模型")).toHaveTextContent(
      /Kimi K2\.7 Code\s*· 始终开启/
    );
  });
});
