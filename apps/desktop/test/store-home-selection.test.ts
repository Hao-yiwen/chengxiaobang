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
  models: ["deepseek-v4-flash", "deepseek-v4-pro"],
  apiKeyRef: "test:deepseek",
  createdAt: "2026-06-08T00:00:00.000Z",
  updatedAt: "2026-06-08T00:00:00.000Z"
};

const kimiProvider: ProviderConfig = {
  id: "kimi",
  kind: "kimi",
  name: "Kimi",
  baseURL: "https://api.moonshot.ai/v1",
  model: "kimi-k2.6",
  models: ["kimi-k2.7-code", "kimi-k2.6", "kimi-k2.5"],
  apiKeyRef: "test:kimi",
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
    listMessages: vi.fn(async () => []),
    listSessionRuns: vi.fn(async () => ({ runs: [], toolCalls: [] })),
    listSlashCommands: vi.fn(async () => ({ commands: [], diagnostics: [] })),
    streamRun: vi.fn(async () => {})
  } as unknown as ApiClient;
}

beforeEach(() => {
  window.localStorage.clear();
  Object.defineProperty(window, "chengxiaobang", {
    value: undefined,
    configurable: true,
    writable: true
  });
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
      activeSessionId: session.id,
      planMode: true
    });

    const persisted = JSON.parse(window.localStorage.getItem("chengxiaobang.app") ?? "{}");
    expect(persisted.state.activeSessionId).toBeUndefined();
    expect(persisted.state.planMode).toBe(false);

    await useAppStore.getState().initClient(createClient());
    unsubscribe();

    expect(useAppStore.getState().activeSessionId).toBeUndefined();
    expect(useAppStore.getState().planMode).toBe(false);
    expect(snapshots).not.toContain(session.id);
  });

  it("turns plan mode off when returning to home for a fresh chat", () => {
    useAppStore.setState({
      providers: [provider],
      view: "chat",
      activeProjectId: project.id,
      activeSessionId: session.id,
      planMode: true
    });

    useAppStore.getState().newChat();

    expect(useAppStore.getState().view).toBe("home");
    expect(useAppStore.getState().activeSessionId).toBeUndefined();
    expect(useAppStore.getState().activeProjectId).toBeUndefined();
    expect(useAppStore.getState().planMode).toBe(false);
  });

  it("uses the last Windows path segment as the opened project name", async () => {
    const winPath = "C:\\Users\\me\\repo";
    const winProject: Project = {
      ...project,
      id: "project_win",
      name: "repo",
      path: winPath
    };
    const createProject = vi.fn(async () => winProject);
    const client = {
      ...createClient(),
      createProject,
      listProjects: vi.fn(async () => [winProject])
    } as unknown as ApiClient;
    Object.defineProperty(window, "chengxiaobang", {
      value: {
        pickDirectory: vi.fn(async () => winPath)
      },
      configurable: true
    });

    await useAppStore.getState().initClient(client);
    await useAppStore.getState().openFolder();

    expect(createProject).toHaveBeenCalledWith({ path: winPath, name: "repo" });
  });

  it("keeps composer text drafts isolated between home and sessions", async () => {
    await useAppStore.getState().initClient(createClient());

    useAppStore.getState().setInput("首页草稿");
    await useAppStore.getState().selectSession(session.id);

    expect(useAppStore.getState().view).toBe("chat");
    expect(useAppStore.getState().activeSessionId).toBe(session.id);
    expect(useAppStore.getState().input).toBe("");

    useAppStore.getState().setInput("会话草稿");
    useAppStore.getState().newChat();

    expect(useAppStore.getState().view).toBe("home");
    expect(useAppStore.getState().activeSessionId).toBeUndefined();
    expect(useAppStore.getState().input).toBe("首页草稿");

    await useAppStore.getState().selectSession(session.id);

    expect(useAppStore.getState().input).toBe("会话草稿");
  });

  it("keeps composer attachments isolated between home and sessions", async () => {
    const homeAttachment = {
      path: "/tmp/home.png",
      name: "home.png",
      size: 128,
      kind: "image" as const
    };
    const sessionAttachment = {
      path: "/tmp/session.png",
      name: "session.png",
      size: 256,
      kind: "image" as const
    };

    await useAppStore.getState().initClient(createClient());

    useAppStore.setState({ attachments: [homeAttachment] });
    await useAppStore.getState().selectSession(session.id);

    expect(useAppStore.getState().attachments).toEqual([]);

    useAppStore.setState({ attachments: [sessionAttachment] });
    useAppStore.getState().newChat();

    expect(useAppStore.getState().attachments).toEqual([homeAttachment]);

    await useAppStore.getState().selectSession(session.id);

    expect(useAppStore.getState().attachments).toEqual([sessionAttachment]);
  });

  it("drops a stale model when it does not belong to the selected provider", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const streamRun = vi.fn(async () => {});
    const client = {
      ...createClient(),
      listProviders: vi.fn(async () => [provider, kimiProvider]),
      streamRun
    } as unknown as ApiClient;

    await useAppStore.getState().initClient(client);
    useAppStore.setState({
      providerId: provider.id,
      model: "kimi-k2.7-code",
      reasoningMode: "auto"
    });

    await useAppStore.getState().runPrompt("帮我查询今天的 AI 新闻");

    expect(streamRun).toHaveBeenCalledTimes(1);
    expect(streamRun.mock.calls[0]?.[0]).toMatchObject({ providerId: provider.id });
    expect(streamRun.mock.calls[0]?.[0]).not.toHaveProperty("model");
    expect(useAppStore.getState().model).toBeUndefined();
    expect(useAppStore.getState().reasoningMode).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      "[store] 模型不属于当前供应商，已回退到供应商默认模型",
      expect.objectContaining({
        providerId: provider.id,
        staleModel: "kimi-k2.7-code",
        fallbackModel: "deepseek-v4-flash"
      })
    );
    warn.mockRestore();
  });
});
