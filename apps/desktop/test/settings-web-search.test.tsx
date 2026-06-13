// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/renderer/App";
import type { ApiClient } from "../src/renderer/lib/api";
import { resetAppStore } from "../src/renderer/store";
import type {
  FeishuConfig,
  FeishuStatus,
  ProviderConfig,
  WebSearchConfig
} from "@chengxiaobang/shared";

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
    renameProject: vi.fn() as never,
    setProjectPinned: vi.fn() as never,
    deleteProject: vi.fn() as never,
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
    runTaskNow: vi.fn() as never,
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
    getWebSearchConfig: vi.fn(async (): Promise<WebSearchConfig> => ({ enabled: false })),
    saveWebSearchConfig: vi.fn(async (input) => ({
      enabled: input.enabled,
      ...(input.apiKey ? { apiKeyRef: "memory:web-search:tavily" } : {})
    })),
    testWebSearchConfig: vi.fn(async () => {}),
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

async function openWebSearchSettings(client: ApiClient): Promise<void> {
  render(<App client={client} />);
  fireEvent.click(await screen.findByText("设置"));
  fireEvent.click(await screen.findByText("网络搜索"));
  await screen.findByText("Tavily 搜索");
}

describe("Web Search settings section", () => {
  it("shows stored Tavily config without echoing the API Key", async () => {
    const client = createClient({
      getWebSearchConfig: vi.fn(
        async (): Promise<WebSearchConfig> => ({
          enabled: true,
          apiKeyRef: "memory:web-search:tavily"
        })
      )
    });

    await openWebSearchSettings(client);

    await waitFor(() => expect(screen.getByLabelText("启用网络搜索")).toBeChecked());
    expect(screen.getByTestId("settings-web-search-form")).toHaveClass("rounded-sm", "border");
    expect(screen.getByLabelText("Tavily API Key")).toHaveValue("");
    expect(screen.getByPlaceholderText("已保存，留空保持不变")).toBeInTheDocument();
  });

  it("saves the enable switch and plaintext Tavily key", async () => {
    const saveWebSearchConfig = vi.fn(
      async (input): Promise<WebSearchConfig> => ({
        enabled: input.enabled,
        apiKeyRef: "memory:web-search:tavily"
      })
    );
    const client = createClient({ saveWebSearchConfig });

    await openWebSearchSettings(client);

    fireEvent.click(screen.getByLabelText("启用网络搜索"));
    fireEvent.change(screen.getByLabelText("Tavily API Key"), {
      target: { value: "tvly-secret" }
    });
    fireEvent.click(screen.getByText("保存"));

    await waitFor(() =>
      expect(saveWebSearchConfig).toHaveBeenCalledWith({
        enabled: true,
        apiKey: "tvly-secret"
      })
    );
    expect(await screen.findByText("已保存")).toBeInTheDocument();
  });

  it("runs the manual search test only for a saved enabled config", async () => {
    const testWebSearchConfig = vi.fn(async () => {});
    const client = createClient({
      getWebSearchConfig: vi.fn(
        async (): Promise<WebSearchConfig> => ({
          enabled: true,
          apiKeyRef: "memory:web-search:tavily"
        })
      ),
      testWebSearchConfig
    });

    await openWebSearchSettings(client);

    await waitFor(() => expect(screen.getByText("测试搜索")).toBeEnabled());
    fireEvent.click(screen.getByText("测试搜索"));

    await waitFor(() => expect(testWebSearchConfig).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("搜索测试通过")).toBeInTheDocument();
  });
});
