// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ConnectPhoneInstallStartInput,
  ConnectPhoneInstallPollResult,
  FeishuConfig,
  FeishuStatus,
  Project,
  ProviderConfig,
  Session,
  WechatConfig,
  WechatStatus
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

const connectedWechatConfig: WechatConfig = {
  enabled: true,
  accountId: "wechat_account",
  sessionKey: "wechat_session"
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

function qrStart(input: ConnectPhoneInstallStartInput) {
  return {
    ok: true as const,
    target: input.target,
    url:
      input.target === "wechat"
        ? "data:image/png;base64,ZmFrZQ=="
        : "https://open.feishu.cn/page/cli?user_code=QR-CODE",
    deviceCode: `${input.target}-device`,
    userCode: "",
    interval: 3,
    expiresIn: 120
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
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
    startFeishuInstall: vi.fn() as never,
    pollFeishuInstall: vi.fn(async () => ({ done: false })),
    getFeishuStatus: vi.fn(async (): Promise<FeishuStatus> => ({ status: "disconnected" })),
    getWechatConfig: vi.fn(async (): Promise<WechatConfig> => ({ enabled: false, accountId: "" })),
    getWechatStatus: vi.fn(async (): Promise<WechatStatus> => ({ status: "disconnected" })),
    startConnectPhoneInstall: vi.fn(async (input) => qrStart(input)),
    pollConnectPhoneInstall: vi.fn(async (input) => ({ done: false, target: input.target })),
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
  fireEvent.click(
    screen.queryByRole("button", { name: "连接手机" }) ??
      screen.getByRole("button", { name: "连接飞书" })
  );
  await screen.findByTestId("connect-phone-panel");
}

describe("ConnectPhoneView", () => {
  it("shows Feishu by default and automatically generates a Feishu QR", async () => {
    const startConnectPhoneInstall = vi.fn(async (input: ConnectPhoneInstallStartInput) => qrStart(input));
    const client = createClient({ startConnectPhoneInstall });

    await openConnectPhone(client);

    const wechatButton = screen.getByRole("button", { name: "微信" });
    const feishuButton = screen.getByRole("button", { name: "飞书 / Lark" });
    expect(screen.getByTestId("connect-phone-panel")).toHaveClass("rounded-sm", "border");
    expect(
      feishuButton.compareDocumentPosition(wechatButton) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(feishuButton).toHaveAttribute("aria-pressed", "true");
    expect(feishuButton).toHaveClass(
      "border-soft-blue-border",
      "bg-soft-blue-surface",
      "text-soft-blue-foreground"
    );
    expect(feishuButton).not.toHaveClass("bg-foreground");
    expect(wechatButton).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("用微信或飞书扫码连接程小帮，在手机里继续对话与触发任务。")).toBeInTheDocument();
    expect(screen.getByText("飞书 / Lark 扫码连接")).toBeInTheDocument();
    expect(screen.getByAltText("手机飞书聊天页插画")).toBeInTheDocument();

    await waitFor(() => expect(startConnectPhoneInstall).toHaveBeenCalledWith({ target: "feishu" }));
    expect(screen.getByTestId("feishu-qr-surface")).toHaveClass("mx-auto", "size-[246px]");
    expect(screen.getByTestId("connect-phone-qr-frame")).toBeInTheDocument();
    expect(screen.queryByLabelText("App ID")).not.toBeInTheDocument();
    expect(screen.queryByText("允许完全访问")).not.toBeInTheDocument();
  });

  it("can switch to WeChat and generate the WeChat QR path", async () => {
    const startConnectPhoneInstall = vi.fn(async (input: ConnectPhoneInstallStartInput) => qrStart(input));
    const client = createClient({ startConnectPhoneInstall });

    await openConnectPhone(client);
    fireEvent.click(screen.getByRole("button", { name: "微信" }));

    await waitFor(() => expect(startConnectPhoneInstall).toHaveBeenCalledWith({ target: "wechat" }));
    expect(screen.getByText("微信扫码连接")).toBeInTheDocument();
    expect(screen.getByTestId("wechat-qr-surface")).toHaveClass("mx-auto", "size-[246px]");
    expect(screen.getByAltText("手机微信聊天页插画")).toBeInTheDocument();
  });

  it("shows the Feishu binding list by default when only Feishu is configured", async () => {
    const startConnectPhoneInstall = vi.fn();
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
      startConnectPhoneInstall: startConnectPhoneInstall as never
    });

    await openConnectPhone(client);

    const bindingList = await screen.findByTestId("feishu-binding-list");
    expect(screen.getByRole("button", { name: "飞书 / Lark" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("tab", { name: "绑定列表" })).toHaveAttribute("aria-selected", "true");
    expect(within(bindingList).getByText("飞书 · 张三")).toBeInTheDocument();
    expect(within(bindingList).queryByText("普通会话")).not.toBeInTheDocument();
    expect(startConnectPhoneInstall).not.toHaveBeenCalled();

    fireEvent.click(within(bindingList).getByText("飞书 · 张三"));
    await waitFor(() => expect(client.listMessages).toHaveBeenCalledWith("session_feishu"));
  });

  it("binds a Feishu session to a selected folder from the binding list", async () => {
    const bound = session({
      id: "session_feishu",
      title: "飞书 · 张三",
      feishuChatId: "oc_chat1"
    });
    const project: Project = {
      id: "project_mobile",
      name: "mobile-project",
      path: "/tmp/mobile-project",
      createdAt: "2026-06-15T09:10:00.000Z",
      updatedAt: "2026-06-15T09:10:00.000Z"
    };
    const createProject = vi.fn(async () => project);
    const updateSession = vi.fn(async () => ({ ...bound, projectId: project.id }));
    Object.defineProperty(window, "chengxiaobang", {
      value: {
        pickDirectory: vi.fn(async () => "/tmp/mobile-project")
      },
      configurable: true
    });
    const client = createClient({
      listSessions: vi.fn(async () => [bound]),
      getFeishuConfig: vi.fn(async () => connectedFeishuConfig),
      getFeishuStatus: vi.fn(async () => ({ status: "connected" }) satisfies FeishuStatus),
      createProject,
      updateSession
    });

    await openConnectPhone(client);
    fireEvent.click(await screen.findByLabelText("为「飞书 · 张三」绑定文件夹"));

    await waitFor(() =>
      expect(createProject).toHaveBeenCalledWith({
        path: "/tmp/mobile-project",
        name: "mobile-project"
      })
    );
    expect(updateSession).toHaveBeenCalledWith("session_feishu", {
      projectId: "project_mobile"
    });
    expect(useAppStore.getState().sessions.find((item) => item.id === "session_feishu")).toMatchObject({
      projectId: "project_mobile"
    });
  });

  it("shows WeChat bound sessions when WeChat is configured", async () => {
    const startConnectPhoneInstall = vi.fn(async (input: ConnectPhoneInstallStartInput) => qrStart(input));
    const bound = session({
      id: "session_wechat",
      title: "微信 · 小王",
      wechatChatId: "wx_user1"
    });
    const feishu = session({
      id: "session_feishu",
      title: "飞书 · 张三",
      feishuChatId: "oc_chat1"
    });
    const client = createClient({
      listSessions: vi.fn(async () => [bound, feishu]),
      getWechatConfig: vi.fn(async () => connectedWechatConfig),
      getWechatStatus: vi.fn(async () => ({ status: "connected" }) satisfies WechatStatus),
      startConnectPhoneInstall
    });

    await openConnectPhone(client);
    fireEvent.click(screen.getByRole("button", { name: "微信" }));

    const bindingList = await screen.findByTestId("wechat-binding-list");
    expect(screen.getByRole("button", { name: "微信" })).toHaveAttribute("aria-pressed", "true");
    expect(within(bindingList).getByText("微信 · 小王")).toBeInTheDocument();
    expect(within(bindingList).queryByText("飞书 · 张三")).not.toBeInTheDocument();
  });

  it("uses the plus button to add a new Feishu connection from the binding tab", async () => {
    const startConnectPhoneInstall = vi.fn(async (input: ConnectPhoneInstallStartInput) => qrStart(input));
    const client = createClient({
      getFeishuConfig: vi.fn(async () => connectedFeishuConfig),
      getFeishuStatus: vi.fn(async () => ({ status: "connected" }) satisfies FeishuStatus),
      startConnectPhoneInstall
    });

    await openConnectPhone(client);
    await screen.findByTestId("feishu-binding-empty");

    fireEvent.click(screen.getByRole("button", { name: "新增连接" }));

    await waitFor(() => expect(startConnectPhoneInstall).toHaveBeenCalledWith({ target: "feishu" }));
    expect(screen.getByRole("tab", { name: "扫码连接" })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByTestId("connect-phone-qr-frame")).toBeInTheDocument();
  });

  it("returns to the binding list after a successful WeChat install", async () => {
    const listSessions = vi.fn(async () => []);
    const startConnectPhoneInstall = vi.fn(async (input: ConnectPhoneInstallStartInput) => qrStart(input));
    const pollConnectPhoneInstall = vi.fn(async () => ({
      done: true as const,
      target: "wechat" as const,
      config: connectedWechatConfig,
      status: { status: "connected", accountId: "wechat_account" } satisfies WechatStatus
    }));
    const client = createClient({
      listSessions,
      startConnectPhoneInstall,
      pollConnectPhoneInstall
    });

    await openConnectPhone(client);
    fireEvent.click(screen.getByRole("button", { name: "微信" }));

    await waitFor(() => expect(pollConnectPhoneInstall).toHaveBeenCalledWith({
      target: "wechat",
      deviceCode: "wechat-device"
    }));
    expect(await screen.findByTestId("wechat-binding-empty")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "绑定列表" })).toHaveAttribute("aria-selected", "true");
    expect(listSessions).toHaveBeenCalled();
  });

  it("keeps a stale WeChat poll from replacing success with an expired QR error", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const firstPoll = deferred<ConnectPhoneInstallPollResult>();
    const secondPoll = deferred<ConnectPhoneInstallPollResult>();
    const startConnectPhoneInstall = vi.fn(async (input: ConnectPhoneInstallStartInput) => qrStart(input));
    const pollConnectPhoneInstall = vi
      .fn<NonNullable<ApiClient["pollConnectPhoneInstall"]>>()
      .mockImplementationOnce(async () => firstPoll.promise)
      .mockImplementationOnce(async () => secondPoll.promise);
    const client = createClient({
      startConnectPhoneInstall,
      pollConnectPhoneInstall
    });

    await openConnectPhone(client);
    fireEvent.click(screen.getByRole("button", { name: "微信" }));
    await waitFor(() => expect(pollConnectPhoneInstall).toHaveBeenCalledTimes(1));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    await waitFor(() => expect(pollConnectPhoneInstall).toHaveBeenCalledTimes(2));

    await act(async () => {
      firstPoll.resolve({
        done: true,
        target: "wechat",
        config: connectedWechatConfig,
        status: { status: "connected", accountId: "wechat_account" } satisfies WechatStatus
      });
      await firstPoll.promise;
    });
    expect(await screen.findByTestId("wechat-binding-empty")).toBeInTheDocument();

    await act(async () => {
      secondPoll.resolve({
        done: false,
        target: "wechat",
        error: "扫码状态已过期，请重新生成二维码"
      });
      await secondPoll.promise;
    });

    expect(screen.getByTestId("wechat-binding-empty")).toBeInTheDocument();
    expect(screen.queryByText("扫码状态已过期，请重新生成二维码")).not.toBeInTheDocument();
  });

  it("marks the QR code as expired and allows retry", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const startConnectPhoneInstall = vi.fn(async (input: ConnectPhoneInstallStartInput) => ({
      ...qrStart(input),
      deviceCode: "device-expired",
      expiresIn: 1
    }));
    const client = createClient({ startConnectPhoneInstall });

    await openConnectPhone(client);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId("feishu-qr-surface")).toHaveClass("mx-auto", "size-[246px]");
    expect(screen.getByTestId("connect-phone-qr-frame")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "刷新" })).not.toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(screen.getByTestId("connect-phone-qr-frame")).toBeInTheDocument();
    expect(screen.queryByText("二维码已过期")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(startConnectPhoneInstall).toHaveBeenCalledTimes(2);
  });
});
