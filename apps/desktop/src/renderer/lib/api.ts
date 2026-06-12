import type {
  ApprovalDecision,
  FeishuConfig,
  FeishuConfigInput,
  FeishuStatus,
  GitChangesResult,
  GitInfo,
  Message,
  Project,
  ProjectFileEntry,
  ProviderConfig,
  ProviderInput,
  ProviderModelOption,
  RunRecord,
  RunRequest,
  ScheduledTask,
  ScheduledTaskUpdate,
  SessionDebugContext,
  Session,
  SessionUpdate,
  SlashCommand,
  SlashCommandDiagnostic,
  StreamEvent,
  TerminalExecRequest,
  TerminalExecResult,
  ToolCall
} from "@chengxiaobang/shared";

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
  listMessages(sessionId: string): Promise<Message[]>;
  rewindSession(sessionId: string, messageId: string): Promise<Message[]>;
  forkSession(sessionId: string, messageId: string): Promise<Session>;
  listSessionRuns(sessionId: string): Promise<{ runs: RunRecord[]; toolCalls: ToolCall[] }>;
  /** 当前会话的 agent 调试上下文，只读，不会启动模型或修改会话。 */
  getSessionDebugContext?(
    sessionId: string,
    options?: { planMode?: boolean }
  ): Promise<SessionDebugContext>;
  listSlashCommands(projectId?: string): Promise<{
    commands: SlashCommand[];
    diagnostics: SlashCommandDiagnostic[];
  }>;
  listProviders(): Promise<ProviderConfig[]>;
  saveProvider(input: ProviderInput): Promise<ProviderConfig>;
  deleteProvider(id: string): Promise<boolean>;
  testProvider(id: string): Promise<void>;
  /** 实时拉取某 provider 的可用模型列表（ARCH-SPEC §6.3，新端点）。 */
  listProviderModels(providerId: string): Promise<string[]>;
  /** 静态目录 + 在线模型合并后的模型选项，包含推理能力。 */
  listProviderModelOptions(providerId: string): Promise<ProviderModelOption[]>;
  listTasks(): Promise<ScheduledTask[]>;
  updateTask(id: string, input: ScheduledTaskUpdate): Promise<ScheduledTask>;
  deleteTask(id: string): Promise<boolean>;
  /** 立即触发一次执行；后端 fire-and-forget，结果经任务行 lastStatus 反映。 */
  runTaskNow(id: string): Promise<void>;
  getFeishuConfig(): Promise<FeishuConfig>;
  saveFeishuConfig(
    input: FeishuConfigInput
  ): Promise<{ config: FeishuConfig; status: FeishuStatus }>;
  getFeishuStatus(): Promise<FeishuStatus>;
  /** 审批/计划确认/ask-user 答复共用：决议对象整体透传（ARCH-SPEC §1.7）。 */
  approve(toolCallId: string, decision: ApprovalDecision): Promise<void>;
  abort(runId: string): Promise<void>;
  terminalExec(input: TerminalExecRequest): Promise<TerminalExecResult>;
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
    async getSessionDebugContext(sessionId, options = {}) {
      const query = options.planMode ? "?planMode=true" : "";
      return (
        await request<{ debug: SessionDebugContext }>(
          `/api/sessions/${encodeURIComponent(sessionId)}/debug-context${query}`
        )
      ).debug;
    },
    async listSlashCommands(projectId) {
      const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
      return request<{ commands: SlashCommand[]; diagnostics: SlashCommandDiagnostic[] }>(
        `/api/slash-commands${query}`
      );
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
    async getFeishuStatus() {
      return (await request<{ status: FeishuStatus }>("/api/settings/feishu/status")).status;
    },
    async approve(toolCallId, decision) {
      await request(`/api/approvals/${toolCallId}`, {
        method: "POST",
        body: JSON.stringify(decision)
      });
    },
    async abort(runId) {
      await request(`/api/runs/${runId}/abort`, { method: "POST" });
    },
    async terminalExec(input) {
      return (
        await request<{ result: TerminalExecResult }>("/api/terminal/exec", {
          method: "POST",
          body: JSON.stringify(input)
        })
      ).result;
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
      await readSseStream(response.body, (event) => {
        sawEvent = true;
        onEvent(event);
      });
      // A stream that closes without a single event means the run died during
      // setup — surface it instead of silently doing nothing.
      if (!sawEvent) {
        console.error("[api] /api/runs/stream 返回了空事件流");
        throw new Error("运行启动失败：后端没有返回任何事件，请检查模型配置");
      }
    }
  };
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

export async function readSseStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: StreamEvent) => void
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
        onEvent(JSON.parse(data) as StreamEvent);
      }
    }
  }
}
