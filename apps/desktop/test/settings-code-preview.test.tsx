// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderConfig } from "@chengxiaobang/shared";
import { App } from "../src/renderer/App";
import { setupI18n } from "../src/renderer/i18n";
import type { ApiClient } from "../src/renderer/lib/api";
import { resetAppStore, useAppStore } from "../src/renderer/store";

const shikiMock = vi.hoisted(() => ({
  bundledLanguages: {
    typescript: {}
  },
  codeToTokensWithThemes: vi.fn(async (text: string) =>
    text.replace(/\r\n?/g, "\n").split("\n").map((line) =>
      line
        ? [
            {
              content: line,
              variants: {
                light: { color: "#0969da" },
                dark: { color: "#79c0ff" }
              }
            }
          ]
        : []
    )
  )
}));

vi.mock("shiki", () => shikiMock);

const provider: ProviderConfig = {
  id: "deepseek",
  kind: "deepseek",
  name: "DeepSeek",
  baseURL: "https://api.deepseek.com",
  model: "deepseek-v4-flash",
  apiKeyRef: "test:deepseek",
  createdAt: "2026-06-16T00:00:00.000Z",
  updatedAt: "2026-06-16T00:00:00.000Z"
};

function createClient(): ApiClient {
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
    runTaskNow: vi.fn(async () => {}),
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
    streamRun: vi.fn(async () => {})
  };
}

beforeAll(() => {
  setupI18n("zh");
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.focus = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn(() => false) as never;
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
  window.HTMLElement.prototype.setPointerCapture = vi.fn();
});

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
  );
  resetAppStore();
  useAppStore.setState({ onboardingOpen: false, onboardingCompleted: true });
  shikiMock.codeToTokensWithThemes.mockClear();
});

describe("设置页代码预览", () => {
  it("updates theme, wrap and font-size settings from appearance", async () => {
    render(<App client={createClient()} />);

    fireEvent.click(await screen.findByText("设置"));

    expect(await screen.findByText("代码预览")).toBeInTheDocument();
    expect(screen.getByLabelText("浅色代码主题")).toHaveTextContent("GitHub Light");
    expect(screen.getByLabelText("深色代码主题")).toHaveTextContent("GitHub Dark");
    expect(screen.queryByRole("switch", { name: "显示行号" })).not.toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "长行自动换行" })).not.toBeChecked();
    expect(screen.getByText("实时预览")).toBeInTheDocument();

    fireEvent.keyDown(screen.getByLabelText("浅色代码主题"), { key: "Enter" });
    fireEvent.click(await screen.findByRole("option", { name: "Vitesse Light" }));

    fireEvent.click(screen.getByRole("switch", { name: "长行自动换行" }));

    const slider = screen.getByRole("slider", { name: "代码字号" });
    fireEvent.keyDown(slider, { key: "ArrowRight" });

    await waitFor(() =>
      expect(useAppStore.getState().codePreviewSettings).toMatchObject({
        fontSize: 13,
        lightTheme: "vitesse-light",
        wrapLongLines: true
      })
    );
    expect(screen.getByLabelText("浅色代码主题")).toHaveTextContent("Vitesse Light");
    expect(screen.getByText("13")).toBeInTheDocument();
    expect(document.querySelector("[data-code-line-numbers='true']")).not.toBeNull();
    const preview = document.querySelector("[data-code-wrap='true']");
    expect(preview).not.toBeNull();
    expect(preview?.getAttribute("style")).toContain("font-size: 13px");
  });
});
