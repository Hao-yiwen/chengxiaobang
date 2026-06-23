// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderConfig, UsageStats, UsageStatsRangeSummary } from "@chengxiaobang/shared";
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
  createdAt: "2026-06-13T00:00:00.000Z",
  updatedAt: "2026-06-13T00:00:00.000Z"
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
    getFeishuConfig: vi.fn(async () => ({
      enabled: false,
      appId: "",
      domain: "feishu" as const,
      fullAccess: false
    })),
    saveFeishuConfig: vi.fn() as never,
    getFeishuStatus: vi.fn(async () => ({ status: "disconnected" as const })),
    getUsageStats: vi.fn(async () => usageStatsFixture()),
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
  useAppStore.setState({ onboardingCompleted: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function openUsageSettings(client: ApiClient): Promise<void> {
  render(<App client={client} />);
  fireEvent.click(await screen.findByText("设置"));
  fireEvent.click(await screen.findByText("用量统计"));
  await screen.findByText("今日概览");
}

describe("设置页用量统计", () => {
  it("shows usage metrics, model ranking, and switches heatmap modes", async () => {
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(1_000);
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(500);
    const getUsageStats = vi.fn(async () => usageStatsFixture());
    await openUsageSettings(createClient({ getUsageStats }));

    expect(getUsageStats).toHaveBeenCalledWith({
      timezoneOffsetMinutes: expect.any(Number)
    });
    expect((await screen.findAllByText("¥2.84")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("2.00M").length).toBeGreaterThan(0);
    expect(screen.getByText("deepseek-v4-flash")).toBeInTheDocument();
    expect(screen.getByText("3 次运行")).toBeInTheDocument();
    expect(screen.getByText("缓存命中 900k · 75%")).toBeInTheDocument();
    expect(screen.getByText("总 Token")).toBeInTheDocument();
    expect(screen.getByText("缓存命中")).toBeInTheDocument();
    expect(screen.getByTestId("settings-usage-model-cache-bar")).toHaveStyle({
      width: "39.130434782608695%"
    });
    expect(screen.queryByText("deepseek · deepseek-v4-flash")).not.toBeInTheDocument();
    expect(screen.queryByText("provider_89aa · deepseek-v4-flash")).not.toBeInTheDocument();
    expect(screen.getByText("Token 趋势")).toBeInTheDocument();
    expect(screen.getByText("每日活动")).toBeInTheDocument();
    expect(screen.getAllByTestId("settings-usage-heatmap-cell")).toHaveLength(371);
    await waitFor(() =>
      expect(screen.getByTestId("settings-usage-chart-scroll").scrollLeft).toBe(500)
    );

    fireEvent.mouseEnter(screen.getAllByTestId("settings-usage-heatmap-cell").at(-1)!);
    expect(await screen.findByText("2026年6月13日")).toBeInTheDocument();
    expect(screen.getByText("Token")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: "每周" }));
    await waitFor(() => expect(screen.getAllByTestId("settings-usage-chart-bar")).toHaveLength(120));
    expect(screen.getByTestId("settings-usage-chart-bars")).toHaveStyle({
      gridTemplateColumns: "repeat(120, 12px)",
      width: "1559px"
    });
    expect(screen.getByTestId("settings-usage-chart-bars")).toHaveClass("gap-px");
    expect(screen.getByText("近 120 周")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId("settings-usage-chart-scroll").scrollLeft).toBe(500)
    );

    fireEvent.click(screen.getByRole("radio", { name: "每月" }));
    await waitFor(() => expect(screen.getAllByTestId("settings-usage-chart-bar")).toHaveLength(48));
    expect(screen.getByTestId("settings-usage-chart-bars")).toHaveStyle({
      gridTemplateColumns: "repeat(48, 32px)",
      width: "1583px"
    });
    expect(screen.getByTestId("settings-usage-chart-bars")).toHaveClass("gap-px");
    expect(screen.getByText("近 48 个月")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId("settings-usage-chart-scroll").scrollLeft).toBe(500)
    );
  });

  it("shows an empty model ranking when there is no usage yet", async () => {
    await openUsageSettings(createClient({ getUsageStats: vi.fn(async () => emptyUsageStats()) }));

    expect((await screen.findAllByText("¥0.00")).length).toBeGreaterThan(0);
    expect(screen.getByText("还没有可统计的模型用量。")).toBeInTheDocument();
    expect(screen.getAllByTestId("settings-usage-heatmap-cell")).toHaveLength(371);
  });
});

function usageStatsFixture(): UsageStats {
  const today = {
    ...emptySummary(),
    costCny: 2.84,
    promptTokens: 1_000_000,
    completionTokens: 1_000_000,
    totalTokens: 2_000_000,
    runCount: 1,
    usageRunCount: 1,
    pricedRunCount: 1
  };
  return {
    ...emptyUsageStats(),
    today,
    week: today,
    total: today,
    dailyBuckets: dailyBuckets(371, "2026-06-13", today),
    weeklyBuckets: weeklyBuckets(120, "2026-06-08", today),
    monthlyBuckets: monthlyBuckets(48, "2026-06", today),
    topModels: [
      {
        providerId: "deepseek",
        providerKind: "deepseek",
        model: "deepseek-v4-flash",
        label: "deepseek · deepseek-v4-flash",
        ...today,
        cachedPromptTokens: 800_000
      },
      {
        ...emptySummary(),
        providerId: "provider_89aa",
        providerKind: "deepseek",
        model: "deepseek-v4-flash",
        label: "provider_89aa · deepseek-v4-flash",
        costCny: 0.42,
        promptTokens: 200_000,
        cachedPromptTokens: 100_000,
        completionTokens: 100_000,
        totalTokens: 300_000,
        runCount: 2,
        usageRunCount: 2,
        pricedRunCount: 2
      }
    ],
    dataQuality: {
      totalRunCount: 1,
      usageRunCount: 1,
      missingUsageRunCount: 0,
      pricedRunCount: 1,
      unknownPriceRunCount: 0,
      fallbackModelRunCount: 0
    }
  };
}

function emptyUsageStats(): UsageStats {
  return {
    generatedAt: "2026-06-13T00:00:00.000Z",
    timezoneOffsetMinutes: -480,
    currency: "CNY",
    today: emptySummary(),
    week: emptySummary(),
    total: emptySummary(),
    dailyBuckets: dailyBuckets(371, "2026-06-13"),
    weeklyBuckets: weeklyBuckets(120, "2026-06-08"),
    monthlyBuckets: monthlyBuckets(48, "2026-06"),
    topModels: [],
    dataQuality: {
      totalRunCount: 0,
      usageRunCount: 0,
      missingUsageRunCount: 0,
      pricedRunCount: 0,
      unknownPriceRunCount: 0,
      fallbackModelRunCount: 0
    }
  };
}

function emptySummary(): UsageStatsRangeSummary {
  return {
    costCny: 0,
    promptTokens: 0,
    completionTokens: 0,
    cachedPromptTokens: 0,
    totalTokens: 0,
    runCount: 0,
    usageRunCount: 0,
    missingUsageRunCount: 0,
    pricedRunCount: 0,
    unknownPriceRunCount: 0,
    fallbackModelRunCount: 0
  };
}

function dailyBuckets(count: number, lastKey: string, last?: UsageStatsRangeSummary) {
  const lastDate = new Date(`${lastKey}T00:00:00.000Z`);
  const start = addDays(lastDate, -(count - 1));
  return Array.from({ length: count }, (_, index) => {
    const summary = last && index === count - 1 ? last : emptySummary();
    const day = addDays(start, index);
    const next = addDays(day, 1);
    return {
      key: dateKey(day),
      label: `${day.getUTCMonth() + 1}/${day.getUTCDate()}`,
      startAt: dateIso(day),
      endAt: dateIso(next),
      ...summary
    };
  });
}

function weeklyBuckets(count: number, lastWeekStartKey: string, last?: UsageStatsRangeSummary) {
  const lastDate = new Date(`${lastWeekStartKey}T00:00:00.000Z`);
  const start = addDays(lastDate, -(count - 1) * 7);
  return Array.from({ length: count }, (_, index) => {
    const summary = last && index === count - 1 ? last : emptySummary();
    const week = addDays(start, index * 7);
    const next = addDays(week, 7);
    return {
      key: dateKey(week),
      label: `${week.getUTCMonth() + 1}/${week.getUTCDate()}`,
      startAt: dateIso(week),
      endAt: dateIso(next),
      ...summary
    };
  });
}

function monthlyBuckets(count: number, lastMonthKey: string, last?: UsageStatsRangeSummary) {
  const lastDate = new Date(`${lastMonthKey}-01T00:00:00.000Z`);
  const start = addMonths(lastDate, -(count - 1));
  return Array.from({ length: count }, (_, index) => {
    const summary = last && index === count - 1 ? last : emptySummary();
    const month = addMonths(start, index);
    const next = addMonths(month, 1);
    const key = dateKey(month).slice(0, 7);
    return {
      key,
      label: key,
      startAt: dateIso(month),
      endAt: dateIso(next),
      ...summary
    };
  });
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function addMonths(date: Date, months: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function dateIso(date: Date): string {
  return `${dateKey(date)}T00:00:00.000Z`;
}
