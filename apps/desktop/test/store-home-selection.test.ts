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
  it("does not default to the first configured provider while restored on home", async () => {
    const streamRun = vi.fn(async () => {});
    const client = { ...createClient(), streamRun } as unknown as ApiClient;

    await useAppStore.getState().initClient(client);

    expect(useAppStore.getState().view).toBe("home");
    expect(useAppStore.getState().providerId).toBeUndefined();
    expect(useAppStore.getState().model).toBeUndefined();

    useAppStore.getState().setInput("首页未选供应商");
    await useAppStore.getState().submit();

    expect(streamRun).not.toHaveBeenCalled();
    expect(useAppStore.getState().notice).toBe("请先选择供应商");
  });

  it("remembers an explicit home model selection without restoring the last session", async () => {
    useAppStore.setState({
      view: "home",
      activeSessionId: session.id,
      providerId: provider.id,
      model: "deepseek-v4-pro",
      reasoningMode: "high",
      homeModelSelection: {
        providerId: provider.id,
        model: "deepseek-v4-pro",
        reasoningMode: "high"
      }
    });

    const persisted = JSON.parse(window.localStorage.getItem("chengxiaobang.app") ?? "{}");
    expect(persisted.state.activeSessionId).toBeUndefined();
    expect(persisted.state.providerId).toBe(provider.id);
    expect(persisted.state.model).toBe("deepseek-v4-pro");
    expect(persisted.state.reasoningMode).toBe("high");
    expect(persisted.state.homeModelSelection).toEqual({
      providerId: provider.id,
      model: "deepseek-v4-pro",
      reasoningMode: "high"
    });

    await useAppStore.getState().initClient(createClient());

    expect(useAppStore.getState().view).toBe("home");
    expect(useAppStore.getState().activeSessionId).toBeUndefined();
    expect(useAppStore.getState().providerId).toBe(provider.id);
    expect(useAppStore.getState().model).toBe("deepseek-v4-pro");
    expect(useAppStore.getState().reasoningMode).toBe("high");
  });

  it("restores the explicit home model after switching into a session and back home", async () => {
    await useAppStore.getState().initClient(createClient());

    await useAppStore.getState().selectComposerModel(provider.id, "deepseek-v4-pro", "high");
    expect(useAppStore.getState().homeModelSelection).toEqual({
      providerId: provider.id,
      model: "deepseek-v4-pro",
      reasoningMode: "high"
    });

    await useAppStore.getState().selectSession(session.id);
    expect(useAppStore.getState().view).toBe("chat");
    expect(useAppStore.getState().model).toBe(provider.model);
    expect(useAppStore.getState().reasoningMode).toBeUndefined();

    useAppStore.getState().newChat();

    expect(useAppStore.getState().view).toBe("home");
    expect(useAppStore.getState().activeSessionId).toBeUndefined();
    expect(useAppStore.getState().providerId).toBe(provider.id);
    expect(useAppStore.getState().model).toBe("deepseek-v4-pro");
    expect(useAppStore.getState().reasoningMode).toBe("high");
  });

  it("restores each session model without leaking another session selection", async () => {
    const deepseekSession: Session = {
      ...session,
      id: "session_deepseek",
      model: "deepseek-v4-pro",
      reasoningMode: "high"
    };
    const kimiSession: Session = {
      ...session,
      id: "session_kimi",
      providerId: kimiProvider.id,
      model: "kimi-k2.5",
      reasoningMode: undefined
    };
    const client = {
      ...createClient(),
      listSessions: vi.fn(async () => [deepseekSession, kimiSession]),
      listProviders: vi.fn(async () => [provider, kimiProvider])
    } as unknown as ApiClient;

    await useAppStore.getState().initClient(client);
    await useAppStore.getState().selectSession(deepseekSession.id);

    expect(useAppStore.getState().providerId).toBe(provider.id);
    expect(useAppStore.getState().model).toBe("deepseek-v4-pro");
    expect(useAppStore.getState().reasoningMode).toBe("high");

    await useAppStore.getState().selectSession(kimiSession.id);

    expect(useAppStore.getState().providerId).toBe(kimiProvider.id);
    expect(useAppStore.getState().model).toBe("kimi-k2.5");
    expect(useAppStore.getState().reasoningMode).toBeUndefined();

    await useAppStore.getState().selectSession(deepseekSession.id);

    expect(useAppStore.getState().providerId).toBe(provider.id);
    expect(useAppStore.getState().model).toBe("deepseek-v4-pro");
    expect(useAppStore.getState().reasoningMode).toBe("high");
  });

  it("falls back legacy sessions without model to their provider default and clears stale reasoning", async () => {
    await useAppStore.getState().initClient(createClient());
    useAppStore.setState({
      providerId: provider.id,
      model: "deepseek-v4-pro",
      reasoningMode: "high"
    });

    await useAppStore.getState().selectSession(session.id);

    expect(useAppStore.getState().providerId).toBe(provider.id);
    expect(useAppStore.getState().model).toBe(provider.model);
    expect(useAppStore.getState().reasoningMode).toBeUndefined();
  });

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
    expect(useAppStore.getState().providerId).toBeUndefined();
    expect(useAppStore.getState().model).toBeUndefined();
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
    expect(streamRun.mock.calls[0]?.[0]).toMatchObject({
      providerId: provider.id,
      model: provider.model
    });
    expect(useAppStore.getState().model).toBe(provider.model);
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

  it("sends the concrete default model for a new home session", async () => {
    const streamRun = vi.fn(async () => {});
    const client = { ...createClient(), streamRun } as unknown as ApiClient;

    await useAppStore.getState().initClient(client);
    await useAppStore.getState().selectComposerModel(provider.id, provider.model, undefined);
    useAppStore.getState().setInput("用默认模型创建新会话");

    await useAppStore.getState().submit();

    expect(streamRun).toHaveBeenCalledTimes(1);
    expect(streamRun.mock.calls[0]?.[0]).toMatchObject({
      providerId: provider.id,
      model: provider.model,
      sessionId: undefined
    });
  });
});
