// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/renderer/App";
import type { ApiClient } from "../src/renderer/lib/api";
import { isNearBottom } from "../src/renderer/lib/scroll";
import { resetAppStore } from "../src/renderer/store";
import type { Message, ProviderConfig, Session } from "@chengxiaobang/shared";

describe("isNearBottom", () => {
  it("is true within the threshold and false at or beyond it", () => {
    const el = (scrollTop: number) => ({ scrollHeight: 1000, clientHeight: 300, scrollTop });
    // remaining = 1000 - scrollTop - 300
    expect(isNearBottom(el(581))).toBe(true); // 119px left
    expect(isNearBottom(el(580))).toBe(false); // exactly 120px left
    expect(isNearBottom(el(579))).toBe(false); // 121px left
  });

  it("treats an unmeasured (zero-size) element as at the bottom", () => {
    expect(isNearBottom({ scrollHeight: 0, clientHeight: 0, scrollTop: 0 })).toBe(true);
  });
});

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

const session: Session = {
  id: "session_1",
  projectId: null,
  title: "长对话",
  providerId: "deepseek",
  accessMode: "approval",
  createdAt: "2026-06-08T00:00:00.000Z",
  updatedAt: "2026-06-08T00:00:02.000Z"
};

const messages: Message[] = [
  {
    id: "u1",
    sessionId: session.id,
    role: "user",
    content: "问题",
    createdAt: "2026-06-08T00:00:00.000Z"
  },
  {
    id: "a1",
    sessionId: session.id,
    role: "assistant",
    content: "很长的回答",
    createdAt: "2026-06-08T00:00:01.000Z"
  }
];

function createClient(): ApiClient {
  return {
    listProjects: vi.fn(async () => []),
    createProject: vi.fn() as never,
    listSessions: vi.fn(async () => [session]),
    updateSession: vi.fn() as never,
    deleteSession: vi.fn() as never,
    listMessages: vi.fn(async () => messages),
    rewindSession: vi.fn(async () => []),
    listSessionRuns: vi.fn(async () => ({ runs: [], toolCalls: [] })),
    listSlashCommands: vi.fn(async () => ({ commands: [], diagnostics: [] })),
    listProviders: vi.fn(async () => [provider]),
    saveProvider: vi.fn() as never,
    deleteProvider: vi.fn(async () => true),
    testProvider: vi.fn() as never,
    approve: vi.fn() as never,
    abort: vi.fn() as never,
    terminalExec: vi.fn() as never,
    streamRun: vi.fn(async () => {})
  };
}

beforeEach(() => {
  window.localStorage.clear();
  resetAppStore();
});

describe("scroll-to-bottom button", () => {
  it("appears when scrolled away and smooth-scrolls back on click", async () => {
    render(<App client={createClient()} />);
    await screen.findByText("很长的回答");

    const scroller = screen.getByTestId("chat-scroll");
    Object.defineProperty(scroller, "scrollHeight", { value: 1000, configurable: true });
    Object.defineProperty(scroller, "clientHeight", { value: 300, configurable: true });

    // Far from the bottom → the button shows up.
    scroller.scrollTop = 0;
    fireEvent.scroll(scroller);
    const button = await screen.findByRole("button", { name: "回到底部" });

    const scrollIntoView = vi.fn();
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      value: scrollIntoView,
      configurable: true,
      writable: true
    });
    fireEvent.click(button);
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "end" });

    // Back near the bottom → the button disappears.
    scroller.scrollTop = 700;
    fireEvent.scroll(scroller);
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "回到底部" })).not.toBeInTheDocument()
    );
  });
});
