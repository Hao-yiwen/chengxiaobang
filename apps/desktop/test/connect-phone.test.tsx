// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FeishuConfig, FeishuStatus, ProviderConfig, Session } from "@chengxiaobang/shared";
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
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

const connectedFeishuConfig: FeishuConfig = {
  enabled: true,
  appId: "cli_connected",
  appSecretRef: "memory:feishu",
  domain: "feishu",
  fullAccess: false
};

function session(overrides: Partial<Session>): Session {
  return {
    id: "session_1",
    projectId: null,
    title: "测试会话",
    providerId: provider.id,
    accessMode: "approval",
    createdAt: "2026-06-15T09:00:00.000Z",
    updatedAt: "2026-06-15T09:00:00.000Z",
    ...overrides
  };
}

function createClient(overrides: Partial<ApiClient> = {}): ApiClient {
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
    getFeishuConfig: vi.fn(
      async (): Promise<FeishuConfig> => ({
        enabled: false,
        appId: "",
        domain: "feishu",
        fullAccess: false
      })
    ),
    saveFeishuConfig: vi.fn() as never,
    startFeishuInstall: vi.fn(async () => ({
      ok: true,
      url: "https://open.feishu.cn/page/cli?user_code=QR-CODE",
      deviceCode: "device-qr",
      userCode: "QR-CODE",
      interval: 3,
      expiresIn: 120
    })),
    pollFeishuInstall: vi.fn(async () => ({ done: false })),
    getFeishuStatus: vi.fn(async (): Promise<FeishuStatus> => ({ status: "disconnected" })),
    listTasks: vi.fn(async () => []),
    updateTask: vi.fn() as never,
    deleteTask: vi.fn(async () => true),
    runTaskNow: vi.fn(async () => {}),
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
  useAppStore.setState({ onboardingOpen: false, onboardingCompleted: true });
});

afterEach(() => {
  vi.useRealTimers();
});

async function openConnectPhone(client: ApiClient): Promise<void> {
  render(<App client={client} />);
  await waitFor(() => expect(client.listProjects).toHaveBeenCalled());
  fireEvent.click(screen.getByRole("button", { name: "连接飞书" }));
  await screen.findAllByText("连接飞书");
}

describe("ConnectPhoneView", () => {
  it("auto-generates a Feishu QR code when no connection is configured", async () => {
    const startFeishuInstall = vi.fn(async () => ({
      ok: true,
      url: "https://open.feishu.cn/page/cli?user_code=QR-CODE",
      deviceCode: "device-qr",
      userCode: "QR-CODE",
      interval: 3,
      expiresIn: 120
    }));
    const client = createClient({ startFeishuInstall: startFeishuInstall as never });

    await openConnectPhone(client);

    expect(screen.getByTestId("connect-phone-feishu-panel")).toHaveClass("rounded-sm", "border");
    await waitFor(() => expect(startFeishuInstall).toHaveBeenCalledWith({ domain: "feishu" }));
    expect(screen.getByText("用飞书扫码授权后，程小帮会自动完成绑定，并在桌面端接收来自手机的消息。")).toBeInTheDocument();
    expect(screen.getByText("扫码快连")).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "绑定列表" })).not.toBeInTheDocument();
    expect(screen.getByTestId("feishu-qr-surface")).toHaveClass("mx-auto", "size-[246px]");
    expect(screen.getByTestId("feishu-qr-frame")).toBeInTheDocument();
    expect(screen.getByAltText("手机飞书聊天页插画")).toBeInTheDocument();
    expect(screen.queryByText(/秒后过期/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "刷新" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("App ID")).not.toBeInTheDocument();
    expect(screen.queryByText("展开手动配置")).not.toBeInTheDocument();
    expect(screen.queryByText("允许完全访问")).not.toBeInTheDocument();
    expect(screen.queryByText("Lark（国际版）")).not.toBeInTheDocument();
  });

  it("shows the binding list by default when a connection and bound sessions exist", async () => {
    const startFeishuInstall = vi.fn();
    const bound = session({
      id: "session_feishu",
      title: "飞书 · 张三",
      feishuChatId: "oc_chat1"
    });
    const plain = session({
      id: "session_plain",
      title: "普通会话"
    });
    const client = createClient({
      listSessions: vi.fn(async () => [bound, plain]),
      getFeishuConfig: vi.fn(async () => connectedFeishuConfig),
      getFeishuStatus: vi.fn(async () => ({ status: "connected" }) satisfies FeishuStatus),
      startFeishuInstall: startFeishuInstall as never
    });

    await openConnectPhone(client);

    const bindingList = await screen.findByTestId("feishu-binding-list");
    expect(bindingList).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "绑定列表" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "扫码连接" })).toHaveAttribute("aria-selected", "false");
    expect(within(bindingList).getByText("飞书 · 张三")).toBeInTheDocument();
    expect(within(bindingList).queryByText("普通会话")).not.toBeInTheDocument();
    expect(startFeishuInstall).not.toHaveBeenCalled();

    fireEvent.click(within(bindingList).getByText("飞书 · 张三"));
    await waitFor(() => expect(client.listMessages).toHaveBeenCalledWith("session_feishu"));
  });

  it("shows an empty binding list for an existing connection without bound sessions", async () => {
    const startFeishuInstall = vi.fn();
    const client = createClient({
      getFeishuConfig: vi.fn(async () => connectedFeishuConfig),
      getFeishuStatus: vi.fn(async () => ({ status: "connected" }) satisfies FeishuStatus),
      startFeishuInstall: startFeishuInstall as never
    });

    await openConnectPhone(client);

    expect(await screen.findByTestId("feishu-binding-empty")).toBeInTheDocument();
    expect(screen.getByText("暂无绑定会话")).toBeInTheDocument();
    expect(screen.getByText("在飞书里私聊机器人，或在群聊里 @ 机器人，绑定会话会自动出现在这里。")).toBeInTheDocument();
    expect(startFeishuInstall).not.toHaveBeenCalled();
  });

  it("uses the plus button to add a new connection from the binding tab", async () => {
    const startFeishuInstall = vi.fn(async () => ({
      ok: true,
      url: "https://open.feishu.cn/page/cli?user_code=PLUS",
      deviceCode: "device-plus",
      userCode: "PLUS",
      interval: 3,
      expiresIn: 120
    }));
    const client = createClient({
      getFeishuConfig: vi.fn(async () => connectedFeishuConfig),
      getFeishuStatus: vi.fn(async () => ({ status: "connected" }) satisfies FeishuStatus),
      startFeishuInstall: startFeishuInstall as never
    });

    await openConnectPhone(client);
    await screen.findByTestId("feishu-binding-empty");

    fireEvent.click(screen.getByRole("button", { name: "新增连接" }));

    await waitFor(() => expect(startFeishuInstall).toHaveBeenCalledWith({ domain: "feishu" }));
    expect(screen.getByRole("tab", { name: "扫码连接" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("feishu-qr-frame")).toBeInTheDocument();
  });

  it("refreshes the QR code when the plus button is clicked on the scan tab", async () => {
    const startFeishuInstall = vi.fn(async () => ({
      ok: true,
      url: "https://open.feishu.cn/page/cli?user_code=PLUS",
      deviceCode: "device-plus",
      userCode: "PLUS",
      interval: 3,
      expiresIn: 120
    }));
    const client = createClient({
      getFeishuConfig: vi.fn(async () => connectedFeishuConfig),
      getFeishuStatus: vi.fn(async () => ({ status: "connected" }) satisfies FeishuStatus),
      startFeishuInstall: startFeishuInstall as never
    });

    await openConnectPhone(client);
    await screen.findByTestId("feishu-binding-empty");

    fireEvent.click(screen.getByRole("button", { name: "新增连接" }));
    await waitFor(() => expect(startFeishuInstall).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "新增连接" }));

    await waitFor(() => expect(startFeishuInstall).toHaveBeenCalledTimes(2));
  });

  it("returns to the binding list after a successful install", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const listSessions = vi.fn(async () => []);
    const startFeishuInstall = vi.fn(async () => ({
      ok: true,
      url: "https://open.feishu.cn/page/cli?user_code=QR-CODE",
      deviceCode: "device-success",
      userCode: "QR-CODE",
      interval: 3,
      expiresIn: 120
    }));
    const pollFeishuInstall = vi.fn(async () => ({
      done: true,
      config: {
        enabled: true,
        appId: "cli_scan",
        appSecretRef: "memory:feishu",
        domain: "lark",
        fullAccess: false
      } satisfies FeishuConfig,
      status: { status: "connected" } satisfies FeishuStatus
    }));
    const client = createClient({
      listSessions,
      startFeishuInstall: startFeishuInstall as never,
      pollFeishuInstall: pollFeishuInstall as never
    });

    await openConnectPhone(client);
    await act(async () => {
      await Promise.resolve();
    });
    expect(startFeishuInstall).toHaveBeenCalledWith({ domain: "feishu" });
    expect(screen.getByTestId("feishu-qr-surface")).toHaveClass("mx-auto", "size-[246px]");
    expect(screen.getByTestId("feishu-qr-frame")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(pollFeishuInstall).toHaveBeenCalledWith({ deviceCode: "device-success" });
    expect(await screen.findByTestId("feishu-binding-empty")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "绑定列表" })).toHaveAttribute("aria-selected", "true");
    expect(listSessions).toHaveBeenCalledTimes(2);
  });

  it("marks the QR code as expired and allows retry", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const startFeishuInstall = vi.fn(async () => ({
      ok: true,
      url: "https://open.feishu.cn/page/cli?user_code=EXP",
      deviceCode: "device-expired",
      userCode: "EXP",
      interval: 30,
      expiresIn: 1
    }));
    const client = createClient({ startFeishuInstall: startFeishuInstall as never });

    await openConnectPhone(client);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId("feishu-qr-surface")).toHaveClass("mx-auto", "size-[246px]");
    expect(screen.getByTestId("feishu-qr-frame")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "刷新" })).not.toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(screen.getByTestId("feishu-qr-frame")).toBeInTheDocument();
    expect(screen.queryByText("二维码已过期")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(startFeishuInstall).toHaveBeenCalledTimes(2);
  });
});
