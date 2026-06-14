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

async function chooseProviderFromCascade(
  form: HTMLElement,
  region: string,
  providerName: string
): Promise<void> {
  openProviderCascade(form);
  fireEvent.click(await findCascaderOption(region));
  fireEvent.click(await findCascaderOption(providerName));
  await clickCascadeConfirm();
}

function openProviderCascade(form: HTMLElement): void {
  const input =
    within(form).queryByLabelText("供应商") ?? within(form).getByLabelText("类型");
  fireEvent.click(input);
}

async function findCascaderOption(name: string): Promise<HTMLElement> {
  return waitFor(() => {
    const options = Array.from(
      document.querySelectorAll<HTMLElement>(".provider-cascade-popup .ant-cascader-menu-item")
    );
    const option = options.find((item) => item.textContent?.trim() === name);
    if (!option) {
      throw new Error(`未找到级联选项：${name}`);
    }
    return option;
  });
}

function queryCascaderOption(name: string): HTMLElement | undefined {
  const options = Array.from(
    document.querySelectorAll<HTMLElement>(".provider-cascade-popup .ant-cascader-menu-item")
  );
  return options.find((item) => item.textContent?.trim() === name);
}

async function clickCascadeConfirm(): Promise<void> {
  const popup = await waitFor(() => {
    const element = document.querySelector<HTMLElement>(".provider-cascade-popup");
    if (!element) {
      throw new Error("未找到供应商级联弹层");
    }
    return element;
  });
  fireEvent.click(within(popup).getByRole("button", { name: "确认" }));
}

describe("设置页供应商：级联选择后展开表单", () => {
  it("starts with one cascaded provider select and expands the form after picking a provider", async () => {
    const form = await openProvidersSection(createClient());

    // 初始只有一个级联选择，不直接铺开全部供应商或整张表单。
    expect(
      within(form).getByText(
        "在一个下拉框里先选区域，再选供应商；填写 Base URL 和 API Key 并保存后才会激活。"
      )
    ).toBeInTheDocument();
    expect(within(form).queryByLabelText("Base URL")).not.toBeInTheDocument();
    expect(within(form).getByText("选择区域和供应商")).toBeInTheDocument();

    openProviderCascade(form);
    expect(screen.queryByText("自定义")).not.toBeInTheDocument();
    expect(queryCascaderOption("DeepSeek")).toBeUndefined();
    fireEvent.click(await findCascaderOption("国外供应商"));
    expect(await screen.findByText("OpenAI")).toBeInTheDocument();
    expect(screen.queryByText("全选")).not.toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });

    await chooseProviderFromCascade(form, "国内供应商", "DeepSeek");

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

    await chooseProviderFromCascade(form, "国内供应商", "DeepSeek");
    fireEvent.change(within(form).getByLabelText("Base URL"), { target: { value: "不是网址" } });
    fireEvent.click(within(form).getByRole("button", { name: "保存" }));

    expect(await within(form).findByText("请填写合法的 Base URL（http/https）")).toBeInTheDocument();
    expect(within(form).getByText("请填写 API Key")).toBeInTheDocument();
    expect(saveProvider).not.toHaveBeenCalled();
  });

  it("saves one provider with catalog defaults and no model overrides", async () => {
    const saveProvider = vi.fn(async (_input: ProviderInput) => deepseek);
    const form = await openProvidersSection(createClient({ saveProvider: saveProvider as never }));

    await chooseProviderFromCascade(form, "国内供应商", "DeepSeek");
    expect(within(form).queryByText("启用的模型")).not.toBeInTheDocument();
    fireEvent.change(within(form).getByLabelText("API Key"), { target: { value: "sk-test" } });
    fireEvent.click(within(form).getByRole("button", { name: "保存" }));

    await waitFor(() => expect(saveProvider).toHaveBeenCalledTimes(1));
    expect(saveProvider.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        kind: "deepseek",
        model: "deepseek-v4-flash",
        apiKey: "sk-test"
      })
    );
    expect(saveProvider.mock.calls[0]?.[0].models).toEqual([
      "deepseek-v4-flash",
      "deepseek-v4-pro"
    ]);
    expect(saveProvider.mock.calls[0]?.[0].modelOverrides).toBeUndefined();
  });

  it("blocks saving when all models are cleared", async () => {
    const saveProvider = vi.fn(async (_input: ProviderInput) => deepseek);
    const form = await openProvidersSection(createClient({ saveProvider: saveProvider as never }));

    await chooseProviderFromCascade(form, "国内供应商", "DeepSeek");
    if (!screen.queryByText("清空")) {
      openProviderCascade(form);
    }
    fireEvent.click(await screen.findByText("清空"));
    expect(
      within(form).getByRole("button", { name: "移除 DeepSeek V4 Flash" })
    ).toBeInTheDocument();
    await clickCascadeConfirm();
    expect(within(form).getByText("未选择模型")).toBeInTheDocument();
    fireEvent.change(within(form).getByLabelText("API Key"), { target: { value: "sk-test" } });
    fireEvent.click(within(form).getByRole("button", { name: "保存" }));

    expect(await within(form).findByText("请至少勾选一个模型")).toBeInTheDocument();
    expect(saveProvider).not.toHaveBeenCalled();
  });

  it("does not expose or submit model tool limits from provider settings", async () => {
    const providerWithLegacyOverride: ProviderConfig = {
      ...deepseek,
      modelOverrides: {
        "deepseek-v4-pro": { maxToolIterations: 1200 }
      }
    };
    const saveProvider = vi.fn(async (_input: ProviderInput) => deepseek);
    const form = await openProvidersSection(
      createClient({
        listProviders: vi.fn(async () => [providerWithLegacyOverride, kimi]),
        saveProvider: saveProvider as never
      })
    );
    const list = screen.getByTestId("settings-provider-list");

    fireEvent.click(within(list).getByRole("button", { name: /^DeepSeek/ }));
    expect(within(form).queryByText("工具调用上限")).not.toBeInTheDocument();
    expect(within(form).queryByLabelText(/工具调用上限/)).not.toBeInTheDocument();
    fireEvent.click(within(form).getByRole("button", { name: "保存" }));

    await waitFor(() => expect(saveProvider).toHaveBeenCalledTimes(1));
    expect(saveProvider.mock.calls[0]?.[0].modelOverrides).toBeUndefined();
  });

  it("does not offer custom providers from the new-provider picker", async () => {
    const form = await openProvidersSection(createClient());

    openProviderCascade(form);

    expect(await screen.findByText("国内供应商")).toBeInTheDocument();
    expect(screen.queryByText("自定义")).not.toBeInTheDocument();
    expect(screen.queryByText("Custom")).not.toBeInTheDocument();
  });
});

describe("设置页供应商：列表选中与删除", () => {
  it("lists only providers activated with an API key", async () => {
    const unconfiguredOpenAI: ProviderConfig = {
      id: "openai",
      kind: "openai",
      name: "OpenAI",
      baseURL: "https://api.openai.com/v1",
      model: "gpt-5.5",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    await openProvidersSection(
      createClient({ listProviders: vi.fn(async () => [deepseek, kimi, unconfiguredOpenAI]) })
    );
    const list = screen.getByTestId("settings-provider-list");

    expect(within(list).getByRole("button", { name: /^DeepSeek/ })).toBeInTheDocument();
    expect(within(list).getByRole("button", { name: /^Kimi/ })).toBeInTheDocument();
    expect(within(list).queryByText("OpenAI")).not.toBeInTheDocument();
  });

  it("does not show an in-use badge and opens providers for editing", async () => {
    const form = await openProvidersSection(createClient());
    const list = screen.getByTestId("settings-provider-list");

    // 已配置的供应商都会出现在模型选择器中，设置页不再标记单个「使用中」。
    expect(within(list).queryByText("使用中")).not.toBeInTheDocument();
    const deepseekRow = within(list).getByRole("button", { name: /^DeepSeek/ });
    expect(deepseekRow).not.toHaveTextContent("使用中");

    const kimiRow = within(list).getByRole("button", { name: /^Kimi/ });
    expect(kimiRow).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(kimiRow);

    expect(kimiRow).toHaveAttribute("aria-pressed", "true");
    // 选中后表单进入编辑态：连接字段回填，密钥提示保持不变。
    expect(within(form).getByText("Kimi")).toBeInTheDocument();
    expect(within(form).getByLabelText("Base URL")).toHaveValue("https://api.moonshot.ai/v1");
    expect(within(form).getByPlaceholderText("已保存 API Key，留空保持不变")).toBeInTheDocument();
  });

  it("deletes a configured provider straight from the list", async () => {
    const deleteProvider = vi.fn(async () => true);
    await openProvidersSection(createClient({ deleteProvider }));
    const list = screen.getByTestId("settings-provider-list");

    fireEvent.click(within(list).getByRole("button", { name: "删除 Kimi" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("确定删除该供应商配置？")).toBeInTheDocument();
    expect(window.confirm).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "删除" }));

    await waitFor(() => expect(deleteProvider).toHaveBeenCalledWith("kimi"));
  });
});
