// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/renderer/App";
import type { ApiClient } from "../src/renderer/lib/api";
import { resetAppStore } from "../src/renderer/store";
import type { ProviderConfig, ProviderInput } from "@chengxiaobang/shared";

const deepseek: ProviderConfig = {
  id: "deepseek",
  kind: "deepseek",
  name: "DeepSeek",
  baseURL: "https://api.deepseek.com",
  model: "deepseek-v4-flash",
  models: ["deepseek-v4-flash", "deepseek-v4-pro"],
  apiKeyRef: "test:deepseek",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

const kimi: ProviderConfig = {
  id: "kimi",
  kind: "kimi",
  name: "Kimi",
  baseURL: "https://api.moonshot.ai/v1",
  model: "kimi-k2.6",
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
    saveProvider: vi.fn(async (_input: ProviderInput) => deepseek) as never,
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
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

async function openProvidersSection(client: ApiClient): Promise<HTMLElement> {
  render(<App client={client} />);
  fireEvent.click(await screen.findByText("设置"));
  fireEvent.click(await screen.findByText("供应商"));
  return screen.findByTestId("settings-provider-form");
}

describe("设置页供应商：先选类型再展开表单", () => {
  it("starts with the type chooser only and expands the form after picking a type", async () => {
    const form = await openProvidersSection(createClient());

    // 初始只有类型选择，不直接铺开整张表单。
    expect(within(form).getByText("先选择供应商类型，再填写 API Key 等信息。")).toBeInTheDocument();
    expect(within(form).queryByLabelText("Base URL")).not.toBeInTheDocument();

    fireEvent.click(within(form).getByRole("button", { name: "DeepSeek" }));

    expect(within(form).getByLabelText("Base URL")).toHaveValue("https://api.deepseek.com");
    expect(within(form).getByLabelText("API Key")).toBeInTheDocument();

    // 取消后回到类型选择阶段。
    fireEvent.click(within(form).getByRole("button", { name: "取消" }));
    expect(within(form).queryByLabelText("Base URL")).not.toBeInTheDocument();
  });
});

describe("设置页供应商：保存校验", () => {
  it("blocks saving until Base URL and API Key are filled", async () => {
    const saveProvider = vi.fn(async (_input: ProviderInput) => deepseek);
    const form = await openProvidersSection(createClient({ saveProvider: saveProvider as never }));

    fireEvent.click(within(form).getByRole("button", { name: "DeepSeek" }));
    fireEvent.change(within(form).getByLabelText("Base URL"), { target: { value: "不是网址" } });
    fireEvent.click(within(form).getByRole("button", { name: "保存" }));

    expect(await within(form).findByText("请填写合法的 Base URL（http/https）")).toBeInTheDocument();
    expect(within(form).getByText("请填写 API Key")).toBeInTheDocument();
    expect(saveProvider).not.toHaveBeenCalled();
  });

  it("saves one provider with only the checked models", async () => {
    const saveProvider = vi.fn(async (_input: ProviderInput) => deepseek);
    const form = await openProvidersSection(createClient({ saveProvider: saveProvider as never }));

    fireEvent.click(within(form).getByRole("button", { name: "DeepSeek" }));
    // 目录模型默认全选；取消一个后只保存剩余的。
    fireEvent.click(within(form).getByRole("checkbox", { name: "DeepSeek V4 Pro" }));
    fireEvent.change(within(form).getByLabelText("API Key"), { target: { value: "sk-test" } });
    fireEvent.click(within(form).getByRole("button", { name: "保存" }));

    await waitFor(() => expect(saveProvider).toHaveBeenCalledTimes(1));
    expect(saveProvider.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        kind: "deepseek",
        model: "deepseek-v4-flash",
        models: ["deepseek-v4-flash"],
        apiKey: "sk-test"
      })
    );
  });

  it("lets custom providers manage multiple model IDs by hand", async () => {
    const saveProvider = vi.fn(async (_input: ProviderInput) => deepseek);
    const form = await openProvidersSection(createClient({ saveProvider: saveProvider as never }));

    fireEvent.click(within(form).getByRole("button", { name: "自定义" }));
    // 自定义类型不内置任何假模型，从空列表开始手动添加。
    expect(within(form).queryByText("model-name")).not.toBeInTheDocument();
    const modelInput = within(form).getByPlaceholderText("输入或选择模型 ID");
    fireEvent.change(modelInput, { target: { value: "my-model-a" } });
    fireEvent.click(within(form).getByRole("button", { name: "添加" }));
    fireEvent.change(modelInput, { target: { value: "my-model-b" } });
    fireEvent.keyDown(modelInput, { key: "Enter" });

    fireEvent.change(within(form).getByLabelText("API Key"), { target: { value: "sk-test" } });
    fireEvent.click(within(form).getByRole("button", { name: "保存" }));

    await waitFor(() => expect(saveProvider).toHaveBeenCalledTimes(1));
    expect(saveProvider.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        kind: "custom",
        model: "my-model-a",
        models: ["my-model-a", "my-model-b"],
        apiKey: "sk-test"
      })
    );
  });
});

describe("设置页供应商：列表选中与删除", () => {
  it("marks the provider in use, highlights the selection, and opens it for editing", async () => {
    const form = await openProvidersSection(createClient());
    const list = screen.getByTestId("settings-provider-list");

    // 未显式选择时，第一个已配 Key 的供应商即「使用中」。
    const deepseekRow = within(list).getByRole("button", { name: /^DeepSeek/ });
    expect(deepseekRow).toHaveTextContent("使用中");

    const kimiRow = within(list).getByRole("button", { name: /^Kimi/ });
    expect(kimiRow).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(kimiRow);

    expect(kimiRow).toHaveAttribute("aria-pressed", "true");
    // 选中后表单进入编辑态：名称回填，密钥提示保持不变。
    expect(within(form).getByLabelText("名称")).toHaveValue("Kimi");
    expect(within(form).getByPlaceholderText("已保存 API Key，留空保持不变")).toBeInTheDocument();
  });

  it("deletes a configured provider straight from the list", async () => {
    const deleteProvider = vi.fn(async () => true);
    await openProvidersSection(createClient({ deleteProvider }));
    const list = screen.getByTestId("settings-provider-list");

    fireEvent.click(within(list).getByRole("button", { name: "删除 Kimi" }));

    await waitFor(() => expect(deleteProvider).toHaveBeenCalledWith("kimi"));
  });
});
