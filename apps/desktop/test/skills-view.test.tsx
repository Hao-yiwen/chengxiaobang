// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

const marketSkill: SkillSummary = {
  name: "code-review",
  description: "对代码做安全与正确性审查",
  category: "coding",
  source: "market",
  enabled: false
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
    listSkills: vi.fn(async () => [builtinSkill, marketSkill, customSkill]),
    getSkillDetail: vi.fn(async (name: string) => ({
      name,
      description: "技能详情",
      category: "coding" as const,
      source: "market" as const,
      enabled: false,
      content: `# ${name}\n\n这是 ${name} 的技能说明正文。`,
      filePath: `/skills/${name}/SKILL.md`
    })),
    setMarketSkillEnabled: vi.fn(async (_name: string, enabled: boolean) => [
      builtinSkill,
      { ...marketSkill, enabled },
      customSkill
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

async function openSkillsView(client: ApiClient): Promise<void> {
  render(<App client={client} />);
  await waitFor(() => expect(client.listProjects).toHaveBeenCalled());
  fireEvent.click(screen.getByRole("button", { name: "技能" }));
  await waitFor(() => expect(client.listSkills).toHaveBeenCalled());
}

beforeEach(() => {
  window.localStorage.clear();
  resetAppStore();
  useAppStore.setState({ onboardingCompleted: true });
});

describe("SkillsView", () => {
  it("opens from the sidebar and splits my skills from the marketplace", async () => {
    const client = createClient();
    await openSkillsView(client);

    // 我的技能：内置 + 自定义；市场区：未激活的 code-review
    const mine = await screen.findByTestId("skill-card-builtin-word");
    expect(within(mine).getByText("始终启用")).toBeInTheDocument();
    expect(screen.getByTestId("skill-card-custom-my-skill")).toBeInTheDocument();

    const market = screen.getByTestId("skill-card-market-code-review");
    expect(within(market).getByText("添加")).toBeInTheDocument();
  });

  it("opens the detail dialog when a card is clicked and renders its content", async () => {
    const client = createClient();
    await openSkillsView(client);

    const market = await screen.findByTestId("skill-card-market-code-review");
    fireEvent.click(market);

    await waitFor(() => expect(client.getSkillDetail).toHaveBeenCalledWith("code-review"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/技能说明正文/)).toBeInTheDocument();
    expect(within(dialog).getByText("/skills/code-review/SKILL.md")).toBeInTheDocument();
  });

  it("does not open the detail dialog when clicking the card action button", async () => {
    const client = createClient();
    await openSkillsView(client);

    const market = await screen.findByTestId("skill-card-market-code-review");
    fireEvent.click(within(market).getByText("添加"));

    await waitFor(() =>
      expect(client.setMarketSkillEnabled).toHaveBeenCalledWith("code-review", true)
    );
    expect(client.getSkillDetail).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("enables a market skill and refreshes slash commands", async () => {
    const client = createClient();
    await openSkillsView(client);

    const market = await screen.findByTestId("skill-card-market-code-review");
    fireEvent.click(within(market).getByText("添加"));

    await waitFor(() =>
      expect(client.setMarketSkillEnabled).toHaveBeenCalledWith("code-review", true)
    );
    // 激活后出现在「我的技能」（同名卡片出现两份：mine + market 区已添加态）
    await waitFor(() =>
      expect(screen.getAllByTestId("skill-card-market-code-review").length).toBeGreaterThan(1)
    );
    expect(client.listSlashCommands).toHaveBeenCalled();
  });

  it("filters marketplace skills by category", async () => {
    const client = createClient({
      listSkills: vi.fn(async () => [
        marketSkill,
        { ...marketSkill, name: "meeting-notes", category: "office" as const }
      ])
    });
    await openSkillsView(client);

    await screen.findByTestId("skill-card-market-code-review");
    fireEvent.click(screen.getByRole("radio", { name: "办公" }));

    expect(screen.queryByTestId("skill-card-market-code-review")).not.toBeInTheDocument();
    expect(screen.getByTestId("skill-card-market-meeting-notes")).toBeInTheDocument();
  });

  it("imports a custom skill from a GitHub url", async () => {
    const client = createClient();
    await openSkillsView(client);

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

  it("starts a chat to create a skill via the add dialog", async () => {
    const client = createClient();
    await openSkillsView(client);

    fireEvent.click(screen.getByRole("button", { name: "添加技能" }));
    fireEvent.click(await screen.findByRole("button", { name: "去对话创建" }));

    // 切回首页并在输入框预置起手提示词，引导用户描述需求或贴链接。
    await waitFor(() => expect(useAppStore.getState().view).toBe("home"));
    expect(useAppStore.getState().input).toContain("创建一个新技能");
  });

  it("deletes a custom skill after confirmation", async () => {
    const client = createClient();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    try {
      await openSkillsView(client);

      const custom = await screen.findByTestId("skill-card-custom-my-skill");
      fireEvent.click(within(custom).getByText("删除"));
      const dialog = await screen.findByRole("alertdialog");
      expect(within(dialog).getByText("确定删除自定义技能「my-skill」？技能文件会从磁盘移除。")).toBeInTheDocument();
      expect(confirmSpy).not.toHaveBeenCalled();
      fireEvent.click(within(dialog).getByRole("button", { name: "删除" }));

      await waitFor(() => expect(client.deleteCustomSkill).toHaveBeenCalledWith("my-skill"));
      await waitFor(() =>
        expect(screen.queryByTestId("skill-card-custom-my-skill")).not.toBeInTheDocument()
      );
    } finally {
      confirmSpy.mockRestore();
    }
  });
});
