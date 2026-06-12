// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/renderer/App";
import type { ApiClient } from "../src/renderer/lib/api";
import { resetAppStore } from "../src/renderer/store";
import type { FeishuConfig, FeishuStatus, ProviderConfig } from "@chengxiaobang/shared";

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

function createClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    listProjects: vi.fn(async () => []),
    createProject: vi.fn() as never,
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
    getFeishuConfig: vi.fn(
      async (): Promise<FeishuConfig> => ({
        enabled: false,
        appId: "",
        domain: "feishu",
        fullAccess: false
      })
    ),
    saveFeishuConfig: vi.fn() as never,
    getFeishuStatus: vi.fn(async (): Promise<FeishuStatus> => ({ status: "disconnected" })),
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
});

async function openFeishuSettings(client: ApiClient): Promise<void> {
  render(<App client={client} />);
  fireEvent.click(await screen.findByText("设置"));
  fireEvent.click(await screen.findByText("飞书"));
  await screen.findByText("配置指引");
}

describe("Feishu settings section", () => {
  it("shows the stored config and connection status", async () => {
    const client = createClient({
      getFeishuConfig: vi.fn(
        async (): Promise<FeishuConfig> => ({
          enabled: true,
          appId: "cli_existing",
          appSecretRef: "keychain:程小帮:feishu",
          domain: "lark",
          fullAccess: false
        })
      ),
      getFeishuStatus: vi.fn(
        async (): Promise<FeishuStatus> => ({ status: "connected", botName: "程小帮机器人" })
      )
    });

    await openFeishuSettings(client);

    await waitFor(() =>
      expect(screen.getByLabelText("App ID")).toHaveValue("cli_existing")
    );
    expect(screen.getByTestId("settings-feishu-form")).toHaveClass("rounded-sm", "border");
    expect(screen.getByTestId("settings-feishu-form")).not.toHaveClass("rounded-md");
    // A saved secret never echoes back — only the keep-it hint shows.
    expect(screen.getByLabelText("App Secret")).toHaveValue("");
    expect(screen.getByPlaceholderText("已保存，留空保持不变")).toBeInTheDocument();
    expect(await screen.findByText("已连接")).toBeInTheDocument();
    expect(screen.getByText("程小帮机器人")).toBeInTheDocument();
  });

  it("saves the form with the plaintext secret and shows a notice", async () => {
    const saveFeishuConfig = vi.fn(async () => ({
      config: {
        enabled: true,
        appId: "cli_new",
        appSecretRef: "keychain:程小帮:feishu",
        domain: "feishu",
        fullAccess: false
      } satisfies FeishuConfig,
      status: { status: "connected" } satisfies FeishuStatus
    }));
    const client = createClient({ saveFeishuConfig: saveFeishuConfig as never });

    await openFeishuSettings(client);

    fireEvent.change(screen.getByLabelText("App ID"), { target: { value: "cli_new" } });
    fireEvent.change(screen.getByLabelText("App Secret"), { target: { value: "shh" } });
    fireEvent.click(screen.getByLabelText("启用飞书机器人"));
    fireEvent.click(screen.getByText("保存并连接"));

    await waitFor(() =>
      expect(saveFeishuConfig).toHaveBeenCalledWith({
        enabled: true,
        appId: "cli_new",
        appSecret: "shh",
        domain: "feishu",
        fullAccess: false
      })
    );
    expect(await screen.findByText("已保存")).toBeInTheDocument();
    expect(await screen.findByText("已连接")).toBeInTheDocument();
  });

  it("warns loudly when full access is toggled on", async () => {
    await openFeishuSettings(createClient());

    expect(screen.queryByText(/直接读写本地文件并执行命令/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("允许完全访问"));
    expect(await screen.findByText(/直接读写本地文件并执行命令/)).toBeInTheDocument();
  });

  it("surfaces connection errors from the status endpoint", async () => {
    const client = createClient({
      getFeishuStatus: vi.fn(
        async (): Promise<FeishuStatus> => ({
          status: "error",
          error: "无法获取机器人信息，请检查 App ID / App Secret"
        })
      )
    });

    await openFeishuSettings(client);

    expect(await screen.findByText("连接失败")).toBeInTheDocument();
    expect(screen.getByText(/无法获取机器人信息/)).toBeInTheDocument();
  });
});
