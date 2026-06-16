// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/renderer/App";
import type { ApiClient } from "../src/renderer/lib/api";
import { resetAppStore, useAppStore } from "../src/renderer/store";
import type { ProviderConfig, SkillSummary } from "@chengxiaobang/shared";

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

const builtinSkill: SkillSummary = {
  name: "word",
  description: "撰写并生成 Word 文档",
  category: "office",
  source: "builtin",
  enabled: true
};

const customSkill: SkillSummary = {
  name: "my-skill",
  description: "我的自定义技能",
  category: "other",
  source: "custom",
  enabled: true
};

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
    listSkills: vi.fn(async () => [builtinSkill, customSkill]),
    getSkillDetail: vi.fn(async (name: string) => ({
      name,
      description: "技能详情",
      category: "other" as const,
      source: "custom" as const,
      enabled: true,
      content: `# ${name}\n\n这是 ${name} 的技能说明正文。`,
      filePath: `/skills/${name}/SKILL.md`
    })),
    setMarketSkillEnabled: vi.fn(async (_name: string, enabled: boolean) => [
      builtinSkill,
      customSkill,
      { ...customSkill, name: "extra", enabled }
    ]),
    importSkillFromUrl: vi.fn(async () => ({
      name: "imported",
      description: "导入的技能",
      category: "other" as const,
      source: "custom" as const,
      enabled: true
    })),
    createCustomSkill: vi.fn(async () => customSkill),
    deleteCustomSkill: vi.fn(async () => true),
    listProviders: vi.fn(async () => [provider]),
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
    listTasks: vi.fn(async () => []),
    updateTask: vi.fn() as never,
    deleteTask: vi.fn(async () => true),
    runTaskNow: vi.fn(async () => {}),
    approve: vi.fn() as never,
    abort: vi.fn() as never,
    terminalExec: vi.fn() as never,
    streamRun: vi.fn() as never,
    ...overrides
  };
}

// 技能已从一级页面收进「设置 → 技能」；经输入框「管理技能」入口（openSkills）进入。
async function openSkillsSettings(client: ApiClient): Promise<void> {
  render(<App client={client} />);
  await waitFor(() => expect(client.listProjects).toHaveBeenCalled());
  act(() => {
    useAppStore.getState().openSkills(false);
  });
  await waitFor(() => expect(client.listSkills).toHaveBeenCalled());
}

beforeEach(() => {
  window.localStorage.clear();
  resetAppStore();
  useAppStore.setState({ onboardingCompleted: true });
});

describe("SkillsSection（设置 → 技能）", () => {
  it("列出内置与自定义技能，内置技能标记为始终启用", async () => {
    const client = createClient();
    await openSkillsSettings(client);

    const builtin = await screen.findByTestId("skill-card-builtin-word");
    expect(within(builtin).getByText("始终启用")).toBeInTheDocument();
    expect(screen.getByTestId("skill-card-custom-my-skill")).toBeInTheDocument();
  });

  it("点击卡片打开详情弹窗并渲染正文", async () => {
    const client = createClient();
    await openSkillsSettings(client);

    const custom = await screen.findByTestId("skill-card-custom-my-skill");
    fireEvent.click(custom);

    await waitFor(() => expect(client.getSkillDetail).toHaveBeenCalledWith("my-skill"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/技能说明正文/)).toBeInTheDocument();
    expect(within(dialog).getByText("/skills/my-skill/SKILL.md")).toBeInTheDocument();
  });

  it("从添加弹窗经 GitHub 链接导入自定义技能", async () => {
    const client = createClient();
    await openSkillsSettings(client);

    fireEvent.click(screen.getByRole("button", { name: "添加技能" }));
    const input = await screen.findByLabelText("GitHub 链接");
    fireEvent.change(input, {
      target: { value: "https://github.com/o/r/tree/main/skills/x" }
    });
    fireEvent.click(screen.getByRole("button", { name: "导入" }));

    await waitFor(() =>
      expect(client.importSkillFromUrl).toHaveBeenCalledWith(
        "https://github.com/o/r/tree/main/skills/x"
      )
    );
  });

  it("从添加弹窗去对话创建技能", async () => {
    const client = createClient();
    await openSkillsSettings(client);

    fireEvent.click(screen.getByRole("button", { name: "添加技能" }));
    fireEvent.click(await screen.findByRole("button", { name: "去对话创建" }));

    // 切回首页并在输入框预置起手提示词，引导用户描述需求或贴链接。
    await waitFor(() => expect(useAppStore.getState().view).toBe("home"));
    expect(useAppStore.getState().input).toContain("创建一个新技能");
  });

  it("确认后删除自定义技能", async () => {
    const client = createClient();
    await openSkillsSettings(client);

    const custom = await screen.findByTestId("skill-card-custom-my-skill");
    fireEvent.click(within(custom).getByText("删除"));
    const dialog = await screen.findByRole("alertdialog");
    expect(
      within(dialog).getByText("确定删除自定义技能「my-skill」？技能文件会从磁盘移除。")
    ).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "删除" }));

    await waitFor(() => expect(client.deleteCustomSkill).toHaveBeenCalledWith("my-skill"));
    await waitFor(() =>
      expect(screen.queryByTestId("skill-card-custom-my-skill")).not.toBeInTheDocument()
    );
  });
});
