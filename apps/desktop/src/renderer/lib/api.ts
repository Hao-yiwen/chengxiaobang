import type {
  FeishuConfig,
  FeishuConfigInput,
  FeishuStatus,
  Message,
  Project,
  ProviderConfig,
  ProviderInput,
  RunRecord,
  RunRequest,
  Session,
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
  listSessions(projectId?: string): Promise<Session[]>;
  listProjectFiles(projectId: string, query: string): Promise<string[]>;
  updateSession(id: string, input: { title?: string }): Promise<Session>;
  deleteSession(id: string): Promise<boolean>;
  listMessages(sessionId: string): Promise<Message[]>;
  rewindSession(sessionId: string, messageId: string): Promise<Message[]>;
  forkSession(sessionId: string, messageId: string): Promise<Session>;
  listSessionRuns(sessionId: string): Promise<{ runs: RunRecord[]; toolCalls: ToolCall[] }>;
  listSlashCommands(projectId?: string): Promise<{
    commands: SlashCommand[];
    diagnostics: SlashCommandDiagnostic[];
  }>;
  listProviders(): Promise<ProviderConfig[]>;
  saveProvider(input: ProviderInput): Promise<ProviderConfig>;
  deleteProvider(id: string): Promise<boolean>;
  testProvider(id: string): Promise<void>;
  getFeishuConfig(): Promise<FeishuConfig>;
  saveFeishuConfig(
    input: FeishuConfigInput
  ): Promise<{ config: FeishuConfig; status: FeishuStatus }>;
  getFeishuStatus(): Promise<FeishuStatus>;
  approve(toolCallId: string, approved: boolean): Promise<void>;
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
    async approve(toolCallId, approved) {
      await request(`/api/approvals/${toolCallId}`, {
        method: "POST",
        body: JSON.stringify({ approved })
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
        throw new Error(response.statusText);
      }
      await readSseStream(response.body, onEvent);
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
