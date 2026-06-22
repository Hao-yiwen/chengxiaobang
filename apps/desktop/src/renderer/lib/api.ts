import { createId, isStreamEvent } from "@chengxiaobang/shared";
import type {
  AppEvent,
  ApprovalDecision,
  ActiveRunSnapshot,
  ConnectPhoneInstallPollInput,
  ConnectPhoneInstallPollResult,
  ConnectPhoneInstallStartInput,
  ConnectPhoneInstallStartResult,
  FeishuConfig,
  FeishuConfigInput,
  FeishuInstallPollInput,
  FeishuInstallPollResult,
  FeishuInstallStartInput,
  FeishuInstallStartResult,
  FeishuStatus,
  GitChangeDiffResult,
  GitChangeScope,
  GitChangesResult,
  GitFileChange,
  GitInfo,
  Message,
  MessageFeedback,
  PluginConfigValues,
  PluginDetail,
  PluginInstallInput,
  PluginSummary,
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
  WebSearchConfigInput,
  WechatConfig,
  WechatStatus
} from "@chengxiaobang/shared";

type EventSubscriptionOptions = {
  onReconnect?: () => void;
  onError?: (error: unknown) => void;
};

type ReadSseStreamOptions = {
  onEventId?: (id: string) => void;
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
  /** 当前项目单个变更文件的 diff（审查面板展开文件时懒加载）。 */
  getGitChangeDiff?(
    projectId: string,
    input: { scope: GitChangeScope; path: string }
  ): Promise<GitFileChange>;
  updateSession(id: string, input: SessionUpdate): Promise<Session>;
  deleteSession(id: string): Promise<boolean>;
  searchSessions?(query: string): Promise<SessionSearchResult[]>;
  listMessages(sessionId: string): Promise<Message[]>;
  setMessageFeedback?(
    sessionId: string,
    messageId: string,
    feedback: MessageFeedback | null
  ): Promise<Message>;
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
  /** 停用/恢复一个插件来源的技能（kind=skill），返回更新后的完整技能清单。 */
  setSkillDisabled?(name: string, disabled: boolean): Promise<SkillSummary[]>;
  /** 停用/恢复一个插件来源的提示词命令（kind=prompt_template），返回更新后的命令清单。 */
  setCommandDisabled?(
    name: string,
    disabled: boolean,
    projectId?: string
  ): Promise<{ commands: SlashCommand[]; diagnostics: SlashCommandDiagnostic[] }>;
  /** 插件页：已安装 + 内置插件的统一清单。 */
  listPlugins?(): Promise<PluginSummary[]>;
  /** 单个插件的详情（manifest、资源清单、配置字段与当前值），详情弹窗用。 */
  getPluginDetail?(name: string): Promise<PluginDetail>;
  /** 安装插件：本地目录/zip 绝对路径或 GitHub 链接，二选一。 */
  installPlugin?(input: PluginInstallInput): Promise<PluginSummary>;
  /** 卸载一个已安装插件（内置插件不可卸载）。 */
  uninstallPlugin?(name: string): Promise<boolean>;
  /** 启停插件，返回更新后的完整插件清单。 */
  setPluginEnabled?(name: string, enabled: boolean): Promise<PluginSummary[]>;
  /** 更新插件 userConfig 取值，返回更新后的插件详情。 */
  setPluginConfig?(name: string, values: PluginConfigValues): Promise<PluginDetail>;
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
  startConnectPhoneInstall?(
    input: ConnectPhoneInstallStartInput
  ): Promise<ConnectPhoneInstallStartResult>;
  pollConnectPhoneInstall?(
    input: ConnectPhoneInstallPollInput
  ): Promise<ConnectPhoneInstallPollResult>;
  getWechatConfig?(): Promise<WechatConfig>;
  getWechatStatus?(): Promise<WechatStatus>;
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
  let lastAppEventId: string | undefined;

  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${baseURL}${path}`, {
      ...init,
      headers: {
        ...headers,
        "Content-Type": "application/json",
        "x-request-id": createId("req"),
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
            const eventPath = lastAppEventId
              ? `/api/events?lastEventId=${encodeURIComponent(lastAppEventId)}`
              : "/api/events";
            console.info("[api] 连接全局应用事件流", {
              reconnecting,
              lastEventId: lastAppEventId
            });
            const response = await fetch(`${baseURL}${eventPath}`, {
              headers: {
                ...headers,
                "x-request-id": createId("req")
              },
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
            await readSseStream<AppEvent>(response.body, dispatchAppEvent, {
              onEventId: (id) => {
                lastAppEventId = id;
              }
            });
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
    async getGitChangeDiff(projectId, input) {
      const query = new URLSearchParams({
        scope: input.scope,
        path: input.path
      });
      return (
        await request<GitChangeDiffResult>(
          `/api/projects/${encodeURIComponent(projectId)}/git/changes/diff?${query.toString()}`
        )
      ).file;
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
    async setMessageFeedback(sessionId, messageId, feedback) {
      return (
        await request<{ message: Message }>(
          `/api/sessions/${sessionId}/messages/${messageId}/feedback`,
          {
            method: "PATCH",
            body: JSON.stringify({ feedback })
          }
        )
      ).message;
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
    async setSkillDisabled(name, disabled) {
      console.info("[api] 切换插件技能停用态", { name, disabled });
      return (
        await request<{ skills: SkillSummary[] }>(
          `/api/skills/${encodeURIComponent(name)}/disabled`,
          { method: "PUT", body: JSON.stringify({ disabled }) }
        )
      ).skills;
    },
    async setCommandDisabled(name, disabled, projectId) {
      console.info("[api] 切换插件命令停用态", { name, disabled, projectId });
      const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
      return request<{ commands: SlashCommand[]; diagnostics: SlashCommandDiagnostic[] }>(
        `/api/slash-commands/${encodeURIComponent(name)}/disabled${query}`,
        { method: "PUT", body: JSON.stringify({ disabled }) }
      );
    },
    async listPlugins() {
      return (await request<{ plugins: PluginSummary[] }>("/api/plugins")).plugins;
    },
    async getPluginDetail(name) {
      return (
        await request<{ plugin: PluginDetail }>(
          `/api/plugins/detail/${encodeURIComponent(name)}`
        )
      ).plugin;
    },
    async installPlugin(input) {
      console.info("[api] 安装插件", { path: input.path, url: input.url });
      return (
        await request<{ plugin: PluginSummary }>("/api/plugins/install", {
          method: "POST",
          body: JSON.stringify(input)
        })
      ).plugin;
    },
    async uninstallPlugin(name) {
      console.info("[api] 卸载插件", { name });
      return (
        await request<{ uninstalled: boolean }>(`/api/plugins/${encodeURIComponent(name)}`, {
          method: "DELETE"
        })
      ).uninstalled;
    },
    async setPluginEnabled(name, enabled) {
      console.info("[api] 启停插件", { name, enabled });
      return (
        await request<{ plugins: PluginSummary[] }>(
          `/api/plugins/${encodeURIComponent(name)}/enabled`,
          { method: "PUT", body: JSON.stringify({ enabled }) }
        )
      ).plugins;
    },
    async setPluginConfig(name, values) {
      console.info("[api] 更新插件配置", { name, keys: Object.keys(values) });
      return (
        await request<{ plugin: PluginDetail }>(
          `/api/plugins/${encodeURIComponent(name)}/config`,
          { method: "PUT", body: JSON.stringify({ values }) }
        )
      ).plugin;
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
    async startConnectPhoneInstall(input) {
      return request<ConnectPhoneInstallStartResult>("/api/settings/connect-phone/install/start", {
        method: "POST",
        body: JSON.stringify(input)
      });
    },
    async pollConnectPhoneInstall(input) {
      return request<ConnectPhoneInstallPollResult>("/api/settings/connect-phone/install/poll", {
        method: "POST",
        body: JSON.stringify(input)
      });
    },
    async getWechatConfig() {
      return (await request<{ config: WechatConfig }>("/api/settings/wechat")).config;
    },
    async getWechatStatus() {
      return (await request<{ status: WechatStatus }>("/api/settings/wechat/status")).status;
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
          "Content-Type": "application/json",
          "x-request-id": createId("req")
        },
        body: JSON.stringify(input)
      });
      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => ({}) as { error?: string });
        throw new Error(body.error ?? response.statusText ?? "运行请求失败");
      }
      let sawEvent = false;
      let sawTerminal = false;
      await readSseStream<StreamEvent>(response.body, (event) => {
        sawEvent = true;
        if (event.type === "run_end" || event.type === "setup_error") {
          sawTerminal = true;
        }
        onEvent(event);
      });
      // 空事件流意味着 run 在启动阶段就失败了，要显式暴露错误。
      if (!sawEvent) {
        console.error("[api] /api/runs/stream 返回了空事件流");
        throw new Error("运行启动失败：后端没有返回任何事件，请检查模型配置");
      }
      // 流自然结束却没有任何终态事件(run_end / setup_error):属于中途断流(网络中断/连接被关),
      // 不能当成功收尾,否则上层不会清理 isRunning。抛错交由调用方走 run 失败收尾。
      if (!sawTerminal) {
        console.error("[api] /api/runs/stream 流在终态事件之前中断");
        throw new Error("运行流中断：连接在结束前断开，请重试");
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
  onEvent: (event: T) => void,
  options: ReadSseStreamOptions = {}
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
      dispatchSseBlock<T>(block, onEvent, options);
    }
  }
  // 流结束时 buffer 可能仍残留一个未以 \n\n 收尾的事件(代理/压缩层未补尾,或最后事件紧贴关闭),
  // 补解析一次,避免丢掉最后一个事件(可能是 run_end,丢了会让前端永久卡运行态)。
  if (buffer.trim().length > 0) {
    dispatchSseBlock<T>(buffer, onEvent, options);
  }
}

/**
 * 解析并分发单个 SSE 块。
 * - 坏 JSON 帧:跳过且**不推进** lastEventId(无法解析就不当作已处理)。
 * - onEvent(业务分发)抛错:**向上传播**以中止当前流,且**不推进** lastEventId——
 *   交由全局流的重连(从上一个已确认 id 续传)重放该事件,保证 at-least-once,
 *   绝不“吞掉异常的同时确认 offset”而永久丢事件。
 */
function dispatchSseBlock<T extends AppEvent = AppEvent>(
  block: string,
  onEvent: (event: T) => void,
  options: ReadSseStreamOptions
): void {
  const lines = block.split("\n");
  const eventId = lines.find((line) => line.startsWith("id: "))?.slice(4);
  const data = lines.find((line) => line.startsWith("data: "))?.slice(6);
  if (!data) {
    return;
  }
  let event: T;
  try {
    event = JSON.parse(data) as T;
  } catch (error) {
    // 单条坏帧不应炸掉整条流(否则 run 误判失败 / 全局流抖动重连),记录并跳过、不推进 id。
    console.warn("[api] 跳过无法解析的 SSE data 帧", {
      error: error instanceof Error ? error.message : String(error),
      preview: data.slice(0, 200)
    });
    return;
  }
  // 先分发再推进 id:onEvent 抛错时不会执行到 onEventId,offset 不前进,事件可被重放。
  onEvent(event);
  if (eventId) {
    options.onEventId?.(eventId);
  }
}
