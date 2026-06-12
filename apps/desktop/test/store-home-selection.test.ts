// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../src/renderer/lib/api";
import { resetAppStore, useAppStore } from "../src/renderer/store";
import type { Project, ProviderConfig, Session } from "@chengxiaobang/shared";

const provider: ProviderConfig = {
  id: "deepseek",
  kind: "deepseek",
  name: "DeepSeek",
  baseURL: "https://api.deepseek.com",
  model: "deepseek-v4-flash",
  apiKeyRef: "test:deepseek",
  createdAt: "2026-06-08T00:00:00.000Z",
  updatedAt: "2026-06-08T00:00:00.000Z"
};

const project: Project = {
  id: "project_1",
  name: "chengxiaobang",
  path: "/tmp/chengxiaobang",
  createdAt: "2026-06-08T00:00:00.000Z",
  updatedAt: "2026-06-08T00:00:00.000Z"
};

const session: Session = {
  id: "session_1",
  projectId: project.id,
  title: "帮我分析一下这个项目。",
  providerId: provider.id,
  accessMode: "approval",
  createdAt: "2026-06-08T00:00:00.000Z",
  updatedAt: "2026-06-08T00:00:00.000Z"
};

function createClient(): ApiClient {
  return {
    listProjects: vi.fn(async () => [project]),
    listSessions: vi.fn(async () => [session]),
    listProviders: vi.fn(async () => [provider]),
    listSlashCommands: vi.fn(async () => ({ commands: [], diagnostics: [] }))
  } as unknown as ApiClient;
}

beforeEach(() => {
  window.localStorage.clear();
  resetAppStore();
});

describe("store home selection restore", () => {
  it("clears stale activeSessionId before publishing loaded home sessions", async () => {
    const snapshots: Array<string | undefined> = [];
    const unsubscribe = useAppStore.subscribe((state) => {
      if (state.sessions.length > 0) {
        snapshots.push(state.activeSessionId);
      }
    });

    useAppStore.setState({
      view: "home",
      activeProjectId: project.id,
      activeSessionId: session.id
    });

    const persisted = JSON.parse(window.localStorage.getItem("chengxiaobang.app") ?? "{}");
    expect(persisted.state.activeSessionId).toBeUndefined();

    await useAppStore.getState().initClient(createClient());
    unsubscribe();

    expect(useAppStore.getState().activeSessionId).toBeUndefined();
    expect(snapshots).not.toContain(session.id);
  });
});
