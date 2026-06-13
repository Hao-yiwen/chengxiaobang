import { isStreamEvent } from "@chengxiaobang/shared";
import type {
  AppEvent,
  ApprovalDecision,
  ActiveRunSnapshot,
  FeishuConfig,
  FeishuConfigInput,
  FeishuInstallPollInput,
  FeishuInstallPollResult,
  FeishuInstallStartInput,
  FeishuInstallStartResult,
  FeishuStatus,
  GitChangesResult,
  GitInfo,
  Message,
  Project,
  ProjectFileEntry,
  ProviderConfig,
  ProviderInput,
  ProviderModelOption,
  ReasoningMode,
  RunRecord,
  RunRequest,
  RunStartResponse,
  RunSteeringRequest,
  ScheduledTask,
  ScheduledTaskUpdate,
  SessionDebugContext,
  SessionContextUsage,
  Session,
  SessionSearchResult,
  SessionUpdate,
  SkillCreateInput,
  SkillDetail,
  SkillSummary,
  SlashCommand,
  SlashCommandDiagnostic,
  StreamEvent,
  TerminalExecRequest,
  TerminalExecResult,
  ToolCall,
  UsageStats,
  WebSearchConfig,
  WebSearchConfigInput
} from "@chengxiaobang/shared";

type EventSubscriptionOptions = {
  onReconnect?: () => void;
  onError?: (error: unknown) => void;
};

export interface ApiClient {
  listProjects(): Promise<Project[]>;
  createProject(input: { path: string; name?: string }): Promise<Project>;
  renameProject(id: string, name: string): Promise<Project>;
  /** 置顶/取消置顶项目（会话置顶走 updateSession 的 pinned 字段）。 */
  setProjectPinned(id: string, pinned: boolean): Promise<Project>;
  deleteProject(id: string): Promise<boolean>;
  listSessions(projectId?: string): Promise<Session[]>;
  listProjectFiles(projectId: string, query: string): Promise<string[]>;
  /** 当前项目文件树面板读取某个目录的直属子项。 */
  listProjectDirectory(projectId: string, path?: string): Promise<ProjectFileEntry[]>;
  /** 当前项目是否为 Git 仓库（右侧菜单显隐用，避免为菜单拉完整 diff）。 */
  getGitInfo?(projectId: string): Promise<GitInfo>;
  /** 当前项目的未提交 git 变更（变更面板用）。 */
  getGitChanges(projectId: string): Promise<GitChangesResult>;
  updateSession(id: string, input: SessionUpdate): Promise<Session>;
  deleteSession(id: string): Promise<boolean>;
  searchSessions?(query: string): Promise<SessionSearchResult[]>;
  listMessages(sessionId: string): Promise<Message[]>;
  rewindSession(sessionId: string, messageId: string): Promise<Message[]>;
  forkSession(sessionId: string, messageId: string): Promise<Session>;
  listSessionRuns(sessionId: string): Promise<{ runs: RunRecord[]; toolCalls: ToolCall[] }>;
  /** 当前后端进程仍在执行的 run 快照，用于页面刷新/重连后恢复审批态。 */
  listActiveRuns?(sessionId?: string): Promise<ActiveRunSnapshot[]>;
  /** 当前会话的 agent 调试上下文，只读，不会启动模型或修改会话。 */
  getSessionDebugContext?(
    sessionId: string,
    options?: { planMode?: boolean }
  ): Promise<SessionDebugContext>;
  /** 当前会话即将发送给模型的上下文用量估算。 */
  getSessionContextUsage?(
    sessionId: string,
    options?: {
      providerId?: string;
      model?: string;
      reasoningMode?: ReasoningMode;
      planMode?: boolean;
    }
  ): Promise<SessionContextUsage>;
  listSlashCommands(projectId?: string): Promise<{
    commands: SlashCommand[];
    diagnostics: SlashCommandDiagnostic[];
  }>;
  /** 技能页：内置 + 市场 + 自定义技能的统一清单。 */
  listSkills?(): Promise<SkillSummary[]>;
  /** 单个技能的详情（含 SKILL.md 正文），详情弹窗用。 */
  getSkillDetail?(name: string): Promise<SkillDetail>;
  /** 激活/停用一个市场技能，返回更新后的完整清单。 */
  setMarketSkillEnabled?(name: string, enabled: boolean): Promise<SkillSummary[]>;
  /** 经 GitHub 链接（或 SKILL.md 直链）导入自定义技能。 */
  importSkillFromUrl?(url: string): Promise<SkillSummary>;
  /** 手动创建自定义技能。 */
  createCustomSkill?(input: SkillCreateInput): Promise<SkillSummary>;
  deleteCustomSkill?(name: string): Promise<boolean>;
  listProviders(): Promise<ProviderConfig[]>;
  saveProvider(input: ProviderInput): Promise<ProviderConfig>;
  deleteProvider(id: string): Promise<boolean>;
  testProvider(id: string): Promise<void>;
  /** 实时拉取某 provider 的可用模型列表（ARCH-SPEC §6.3，新端点）。 */
  listProviderModels(providerId: string): Promise<string[]>;
  /** 静态目录 + 在线模型合并后的模型选项，包含推理能力。 */
  listProviderModelOptions(providerId: string): Promise<ProviderModelOption[]>;
  /** 设置页全局 Token 与预估费用统计。 */
  getUsageStats?(options: { timezoneOffsetMinutes: number }): Promise<UsageStats>;
  listTasks(): Promise<ScheduledTask[]>;
  updateTask(id: string, input: ScheduledTaskUpdate): Promise<ScheduledTask>;
  deleteTask(id: string): Promise<boolean>;
  /** 立即触发一次执行；后端 fire-and-forget，结果经任务行 lastStatus 反映。 */
  runTaskNow(id: string): Promise<void>;
  getFeishuConfig(): Promise<FeishuConfig>;
  saveFeishuConfig(
    input: FeishuConfigInput
  ): Promise<{ config: FeishuConfig; status: FeishuStatus }>;
  startFeishuInstall?(input: FeishuInstallStartInput): Promise<FeishuInstallStartResult>;
  pollFeishuInstall?(input: FeishuInstallPollInput): Promise<FeishuInstallPollResult>;
  getFeishuStatus(): Promise<FeishuStatus>;
  getWebSearchConfig?(): Promise<WebSearchConfig>;
  saveWebSearchConfig?(input: WebSearchConfigInput): Promise<WebSearchConfig>;
  testWebSearchConfig?(): Promise<void>;
  /** 审批/计划确认/ask-user 答复共用：决议对象整体透传（ARCH-SPEC §1.7）。 */
  approve(toolCallId: string, decision: ApprovalDecision): Promise<void>;
  abort(runId: string): Promise<void>;
  steerRun?(runId: string, input: RunSteeringRequest): Promise<void>;
  terminalExec(input: TerminalExecRequest): Promise<TerminalExecResult>;
  startRun?(input: RunRequest): Promise<RunStartResponse>;
  subscribeRunEvents?(
    onEvent: (event: StreamEvent) => void,
    options?: EventSubscriptionOptions
  ): () => void;
  subscribeAppEvents?(
    onEvent: (event: AppEvent) => void,
    options?: EventSubscriptionOptions
  ): () => void;
  streamRun(input: RunRequest, onEvent: (event: StreamEvent) => void): Promise<void>;
}

export async function createApiClient(): Promise<ApiClient> {
  const bridgeInfo = await window.chengxiaobang?.getBackendInfo();
  const baseURL =
    bridgeInfo?.baseURL ?? import.meta.env.VITE_BACKEND_URL ?? "http://127.0.0.1:3000";
  const token = bridgeInfo?.token ?? import.meta.env.VITE_BACKEND_TOKEN ?? "";
  const headers: Record<string, string> = token
    ? { "x-chengxiaobang-token": token }
    : {};
  const runEventListeners = new Map<
    (event: StreamEvent) => void,
    EventSubscriptionOptions | undefined
  >();
  const appEventListeners = new Map<
    (event: AppEvent) => void,
    EventSubscriptionOptions | undefined
  >();
  let eventStreamAbort: AbortController | undefined;

  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${baseURL}${path}`, {
      ...init,
      headers: {
        ...headers,
        "Content-Type": "application/json",
        ...objectHeaders(init?.headers)
      }
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error ?? response.statusText);
    }
    return response.json() as Promise<T>;
  }

  function dispatchAppEvent(event: AppEvent): void {
    for (const listener of appEventListeners.keys()) {
      listener(event);
    }
    if (!isStreamEvent(event)) {
      return;
    }
    for (const listener of runEventListeners.keys()) {
      listener(event);
    }
  }

  function listenerCount(): number {
    return runEventListeners.size + appEventListeners.size;
  }

  function emitReconnect(): void {
    for (const options of [...runEventListeners.values(), ...appEventListeners.values()]) {
      options?.onReconnect?.();
    }
  }

  function emitStreamError(error: unknown): void {
    for (const options of [...runEventListeners.values(), ...appEventListeners.values()]) {
      options?.onError?.(error);
    }
  }

  function ensureAppEventStream(): void {
    if (eventStreamAbort || listenerCount() === 0) {
      return;
    }
    const controller = new AbortController();
    eventStreamAbort = controller;
    void (async () => {
      let reconnecting = false;
      try {
        while (!controller.signal.aborted && listenerCount() > 0) {
          try {
            console.info("[api] 连接全局应用事件流", { reconnecting });
            const response = await fetch(`${baseURL}/api/events`, {
              headers,
              signal: controller.signal
            });
            if (!response.ok || !response.body) {
              const body = await response.json().catch(() => ({}) as { error?: string });
              throw new Error(body.error ?? response.statusText ?? "事件流连接失败");
            }
            if (reconnecting) {
              emitReconnect();
            }
            reconnecting = true;
            await readSseStream<AppEvent>(response.body, dispatchAppEvent);
            if (!controller.signal.aborted && listenerCount() > 0) {
              console.warn("[api] 全局应用事件流已关闭，准备重连");
            }
          } catch (error) {
            if (controller.signal.aborted) {
              break;
            }
            console.warn("[api] 全局应用事件流异常，准备重连", error);
            emitStreamError(error);
          }
          if (!controller.signal.aborted && listenerCount() > 0) {
            await sleep(1_000, controller.signal);
          }
        }
      } finally {
        if (eventStreamAbort === controller) {
          eventStreamAbort = undefined;
        }
      }
    })();
  }

  return {
    async listProjects() {
      return (await request<{ projects: Project[] }>("/api/projects")).projects;
    },
    async createProject(input) {
      return (
        await request<{ project: Project }>("/api/projects", {
          method: "POST",
          body: JSON.stringify(input)
        })
      ).project;
    },
    async renameProject(id, name) {
      return (
        await request<{ project: Project }>(`/api/projects/${id}`, {
          method: "PATCH",
          body: JSON.stringify({ name })
        })
      ).project;
    },
    async setProjectPinned(id, pinned) {
      return (
        await request<{ project: Project }>(`/api/projects/${id}`, {
          method: "PATCH",
          body: JSON.stringify({ pinned })
        })
      ).project;
    },
    async deleteProject(id) {
      return (
        await request<{ deleted: boolean }>(`/api/projects/${id}`, { method: "DELETE" })
      ).deleted;
    },
    async listSessions(projectId) {
      const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
      return (await request<{ sessions: Session[] }>(`/api/sessions${query}`)).sessions;
    },
    async listProjectFiles(projectId, query) {
      return (
        await request<{ files: string[] }>(
          `/api/projects/${projectId}/files?query=${encodeURIComponent(query)}`
        )
      ).files;
    },
    async listProjectDirectory(projectId, path = ".") {
      return (
        await request<{ entries: ProjectFileEntry[] }>(
          `/api/projects/${projectId}/files/tree?path=${encodeURIComponent(path)}`
        )
      ).entries;
    },
    async getGitInfo(projectId) {
      return (
        await request<{ info: GitInfo }>(
          `/api/projects/${encodeURIComponent(projectId)}/git/info`
        )
      ).info;
    },
    async getGitChanges(projectId) {
      return (
        await request<{ changes: GitChangesResult }>(
          `/api/projects/${encodeURIComponent(projectId)}/git/changes`
        )
      ).changes;
    },
    async updateSession(id, input) {
      return (
        await request<{ session: Session }>(`/api/sessions/${id}`, {
          method: "PATCH",
          body: JSON.stringify(input)
        })
      ).session;
    },
    async deleteSession(id) {
      return (
        await request<{ deleted: boolean }>(`/api/sessions/${id}`, {
          method: "DELETE"
        })
      ).deleted;
    },
    async searchSessions(query) {
      return (
        await request<{ results: SessionSearchResult[] }>(
          `/api/sessions/search?query=${encodeURIComponent(query)}`
        )
      ).results;
    },
    async listMessages(sessionId) {
      return (
        await request<{ messages: Message[] }>(`/api/sessions/${sessionId}/messages`)
      ).messages;
    },
    async rewindSession(sessionId, messageId) {
      return (
        await request<{ messages: Message[] }>(`/api/sessions/${sessionId}/rewind`, {
          method: "POST",
          body: JSON.stringify({ messageId })
        })
      ).messages;
    },
    async forkSession(sessionId, messageId) {
      return (
        await request<{ session: Session }>(`/api/sessions/${sessionId}/fork`, {
          method: "POST",
          body: JSON.stringify({ messageId })
        })
      ).session;
    },
    async listSessionRuns(sessionId) {
      return request<{ runs: RunRecord[]; toolCalls: ToolCall[] }>(
        `/api/sessions/${sessionId}/runs`
      );
    },
    async listActiveRuns(sessionId) {
      const query = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : "";
      return (await request<{ runs: ActiveRunSnapshot[] }>(`/api/runs/active${query}`)).runs;
    },
    async getSessionDebugContext(sessionId, options = {}) {
      const query = options.planMode ? "?planMode=true" : "";
      return (
        await request<{ debug: SessionDebugContext }>(
          `/api/sessions/${encodeURIComponent(sessionId)}/debug-context${query}`
        )
      ).debug;
    },
    async getSessionContextUsage(sessionId, options = {}) {
      const params = new URLSearchParams();
      if (options.providerId) {
        params.set("providerId", options.providerId);
      }
      if (options.model) {
        params.set("model", options.model);
      }
      if (options.reasoningMode) {
        params.set("reasoningMode", options.reasoningMode);
      }
      if (options.planMode) {
        params.set("planMode", "true");
      }
      const query = params.toString();
      return (
        await request<{ usage: SessionContextUsage }>(
          `/api/sessions/${encodeURIComponent(sessionId)}/context-usage${
            query ? `?${query}` : ""
          }`
        )
      ).usage;
    },
    async listSlashCommands(projectId) {
      const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
      return request<{ commands: SlashCommand[]; diagnostics: SlashCommandDiagnostic[] }>(
        `/api/slash-commands${query}`
      );
    },
    async listSkills() {
      return (await request<{ skills: SkillSummary[] }>("/api/skills")).skills;
    },
    async getSkillDetail(name) {
      return (
        await request<{ skill: SkillDetail }>(
          `/api/skills/detail/${encodeURIComponent(name)}`
        )
      ).skill;
    },
    async setMarketSkillEnabled(name, enabled) {
      return (
        await request<{ skills: SkillSummary[] }>(
          `/api/skills/market/${encodeURIComponent(name)}`,
          { method: "PUT", body: JSON.stringify({ enabled }) }
        )
      ).skills;
    },
    async importSkillFromUrl(url) {
      return (
        await request<{ skill: SkillSummary }>("/api/skills/custom/import", {
          method: "POST",
          body: JSON.stringify({ url })
        })
      ).skill;
    },
    async createCustomSkill(input) {
      return (
        await request<{ skill: SkillSummary }>("/api/skills/custom", {
          method: "POST",
          body: JSON.stringify(input)
        })
      ).skill;
    },
    async deleteCustomSkill(name) {
      return (
        await request<{ deleted: boolean }>(
          `/api/skills/custom/${encodeURIComponent(name)}`,
          { method: "DELETE" }
        )
      ).deleted;
    },
    async listProviders() {
      return (await request<{ providers: ProviderConfig[] }>("/api/settings/providers"))
        .providers;
    },
    async saveProvider(input) {
      return (
        await request<{ provider: ProviderConfig }>("/api/settings/providers", {
          method: "PUT",
          body: JSON.stringify(input)
        })
      ).provider;
    },
    async deleteProvider(id) {
      return (
        await request<{ deleted: boolean }>(`/api/settings/providers/${id}`, {
          method: "DELETE"
        })
      ).deleted;
    },
    async testProvider(id) {
      await request(`/api/settings/providers/${id}/test`, { method: "POST" });
    },
    async listProviderModels(providerId) {
      return (
        await request<{ models: string[] }>(
          `/api/settings/providers/${encodeURIComponent(providerId)}/models`
        )
      ).models;
    },
    async listProviderModelOptions(providerId) {
      return (
        await request<{ models: ProviderModelOption[] }>(
          `/api/settings/providers/${encodeURIComponent(providerId)}/model-options`
        )
      ).models;
    },
    async getUsageStats(options) {
      const params = new URLSearchParams({
        timezoneOffsetMinutes: String(options.timezoneOffsetMinutes)
      });
      return (await request<{ stats: UsageStats }>(`/api/settings/usage-stats?${params}`))
        .stats;
    },
    async listTasks() {
      return (await request<{ tasks: ScheduledTask[] }>("/api/tasks")).tasks;
    },
    async updateTask(id, input) {
      return (
        await request<{ task: ScheduledTask }>(`/api/tasks/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: JSON.stringify(input)
        })
      ).task;
    },
    async deleteTask(id) {
      return (
        await request<{ deleted: boolean }>(`/api/tasks/${encodeURIComponent(id)}`, {
          method: "DELETE"
        })
      ).deleted;
    },
    async runTaskNow(id) {
      await request(`/api/tasks/${encodeURIComponent(id)}/run`, { method: "POST" });
    },
    async getFeishuConfig() {
      return (await request<{ config: FeishuConfig }>("/api/settings/feishu")).config;
    },
    async saveFeishuConfig(input) {
      return request<{ config: FeishuConfig; status: FeishuStatus }>("/api/settings/feishu", {
        method: "PUT",
        body: JSON.stringify(input)
      });
    },
    async startFeishuInstall(input) {
      return request<FeishuInstallStartResult>("/api/settings/feishu/install/start", {
        method: "POST",
        body: JSON.stringify(input)
      });
    },
    async pollFeishuInstall(input) {
      return request<FeishuInstallPollResult>("/api/settings/feishu/install/poll", {
        method: "POST",
        body: JSON.stringify(input)
      });
    },
    async getFeishuStatus() {
      return (await request<{ status: FeishuStatus }>("/api/settings/feishu/status")).status;
    },
    async getWebSearchConfig() {
      return (await request<{ config: WebSearchConfig }>("/api/settings/web-search")).config;
    },
    async saveWebSearchConfig(input) {
      return (
        await request<{ config: WebSearchConfig }>("/api/settings/web-search", {
          method: "PUT",
          body: JSON.stringify(input)
        })
      ).config;
    },
    async testWebSearchConfig() {
      await request("/api/settings/web-search/test", { method: "POST" });
    },
    async approve(toolCallId, decision) {
      await request(`/api/approvals/${encodeURIComponent(toolCallId)}`, {
        method: "POST",
        body: JSON.stringify(decision)
      });
    },
    async abort(runId) {
      await request(`/api/runs/${runId}/abort`, { method: "POST" });
    },
    async steerRun(runId, input) {
      await request(`/api/runs/${encodeURIComponent(runId)}/steering`, {
        method: "POST",
        body: JSON.stringify(input)
      });
    },
    async terminalExec(input) {
      return (
        await request<{ result: TerminalExecResult }>("/api/terminal/exec", {
          method: "POST",
          body: JSON.stringify(input)
        })
      ).result;
    },
    async startRun(input) {
      return request<RunStartResponse>("/api/runs", {
        method: "POST",
        body: JSON.stringify(input)
      });
    },
    subscribeRunEvents(onEvent, options) {
      runEventListeners.set(onEvent, options);
      ensureAppEventStream();
      return () => {
        runEventListeners.delete(onEvent);
        if (listenerCount() === 0) {
          eventStreamAbort?.abort();
          eventStreamAbort = undefined;
        }
      };
    },
    subscribeAppEvents(onEvent, options) {
      appEventListeners.set(onEvent, options);
      ensureAppEventStream();
      return () => {
        appEventListeners.delete(onEvent);
        if (listenerCount() === 0) {
          eventStreamAbort?.abort();
          eventStreamAbort = undefined;
        }
      };
    },
    async streamRun(input, onEvent) {
      const response = await fetch(`${baseURL}/api/runs/stream`, {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(input)
      });
      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => ({}) as { error?: string });
        throw new Error(body.error ?? response.statusText ?? "运行请求失败");
      }
      let sawEvent = false;
      await readSseStream<StreamEvent>(response.body, (event) => {
        sawEvent = true;
        onEvent(event);
      });
      // 空事件流意味着 run 在启动阶段就失败了，要显式暴露错误。
      if (!sawEvent) {
        console.error("[api] /api/runs/stream 返回了空事件流");
        throw new Error("运行启动失败：后端没有返回任何事件，请检查模型配置");
      }
    }
  };
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timer);
        resolve();
      },
      { once: true }
    );
  });
}

function objectHeaders(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) {
    return {};
  }
  if (headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers);
  }
  return headers;
}

export async function readSseStream<T extends AppEvent = AppEvent>(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: T) => void
): Promise<void> {
  const decoder = new TextDecoder();
  const reader = body.getReader();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split(/\n\n+/);
    buffer = blocks.pop() ?? "";
    for (const block of blocks) {
      const data = block
        .split("\n")
        .find((line) => line.startsWith("data: "))
        ?.slice(6);
      if (data) {
        onEvent(JSON.parse(data) as T);
      }
    }
  }
}
