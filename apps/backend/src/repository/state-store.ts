import type {
  AccessMode,
  Message,
  Project,
  ProviderConfig,
  ReasoningMode,
  RunRecord,
  ScheduledTask,
  ScheduledTaskStatus,
  Session,
  ToolCall
} from "@chengxiaobang/shared";

export interface CreateProjectInput {
  name: string;
  path: string;
}

export interface CreateSessionInput {
  projectId: string | null;
  title: string;
  providerId?: string;
  accessMode: AccessMode;
  /** 会话级模型记忆（§6.2）；为空时回退 provider.model。 */
  model?: string;
  /** 会话级推理模式记忆；为空时不覆盖 provider/平台默认。 */
  reasoningMode?: ReasoningMode;
  parentSessionId?: string;
  forkMessageId?: string;
  feishuChatId?: string;
}

export interface CreateMessageInput {
  sessionId: string;
  role: Message["role"];
  kind?: Message["kind"];
  content: string;
  reasoning?: string;
  reasoningMs?: number;
  durationMs?: number;
  /** Raw pi message JSON for lossless model-context reconstruction. */
  payload?: string;
}

/** A persisted message including the backend-only pi payload column. */
export type StoredMessage = Message & { payload?: string };

export interface CreateRunInput {
  id: string;
  sessionId: string;
  status: "running" | "completed" | "aborted" | "failed";
}

export interface UpdateSessionInput {
  title?: string;
  providerId?: string | null;
  accessMode?: AccessMode;
  /** 会话级模型记忆（§6.2）。undefined preserves the current value; null clears it. */
  model?: string | null;
  /** 会话级推理模式记忆。undefined preserves the current value; null clears it. */
  reasoningMode?: ReasoningMode | null;
  /** undefined preserves the current value; null clears it. */
  compactedUpToMessageId?: string | null;
}

export interface CreateScheduledTaskInput {
  sessionId: string;
  name: string;
  prompt: string;
  cron: string;
  fullAccess: boolean;
  /** 创建时由 cron 算好（UTC ISO），调度器据此判断到期。 */
  nextRunAt: string;
}

export interface UpdateScheduledTaskInput {
  name?: string;
  cron?: string;
  prompt?: string;
  enabled?: boolean;
  fullAccess?: boolean;
  nextRunAt?: string;
  lastRunAt?: string;
  lastStatus?: ScheduledTaskStatus;
  /** undefined preserves the current value; null clears it. */
  lastError?: string | null;
}

export interface StateStore {
  initialize(): Promise<void>;
  close(): Promise<void>;
  listProjects(): Promise<Project[]>;
  getProject(id: string): Promise<Project | undefined>;
  getProjectByPath(path: string): Promise<Project | undefined>;
  createProject(input: CreateProjectInput): Promise<Project>;
  /** Renames a project (its directory on disk is untouched). */
  renameProject(id: string, name: string): Promise<Project>;
  /** 置顶/取消置顶项目。只写 pinned_at，不更新 updated_at（避免扰动列表排序）。 */
  setProjectPinned(id: string, pinned: boolean): Promise<Project>;
  listSessions(projectId?: string | null): Promise<Session[]>;
  getSession(id: string): Promise<Session | undefined>;
  /** The session bound to a Feishu chat, if one exists (one session per chat). */
  findSessionByFeishuChatId(chatId: string): Promise<Session | undefined>;
  createSession(input: CreateSessionInput): Promise<Session>;
  updateSession(id: string, input: UpdateSessionInput): Promise<Session>;
  /** 置顶/取消置顶会话。只写 pinned_at，不更新 updated_at（避免扰动列表排序）。 */
  setSessionPinned(id: string, pinned: boolean): Promise<Session>;
  deleteSession(id: string): Promise<boolean>;
  /**
   * Clones messages up to and including `messageId` into a new session
   * linked to the source via parentSessionId/forkMessageId. Runs/tool calls
   * are not cloned (tool-role messages keep the model context intact).
   */
  forkSession(sessionId: string, messageId: string): Promise<Session>;
  /** Deletes a project and cascades to its sessions/messages/runs. */
  deleteProject(id: string): Promise<boolean>;
  touchSession(id: string, title?: string): Promise<void>;
  addMessage(input: CreateMessageInput): Promise<StoredMessage>;
  listMessages(sessionId: string): Promise<StoredMessage[]>;
  /**
   * Deletes the given message and every later one in the session (plus runs
   * and tool calls from that span). Returns how many messages were removed;
   * 0 when the message id is not in the session.
   */
  deleteMessagesFrom(sessionId: string, messageId: string): Promise<number>;
  createRun(input: CreateRunInput): Promise<void>;
  updateRunStatus(id: string, status: CreateRunInput["status"]): Promise<void>;
  listRuns(sessionId: string): Promise<RunRecord[]>;
  listToolCallsForSession(sessionId: string): Promise<ToolCall[]>;
  listProviders(): Promise<ProviderConfig[]>;
  getProvider(id: string): Promise<ProviderConfig | undefined>;
  upsertProvider(provider: ProviderConfig): Promise<ProviderConfig>;
  deleteProvider(id: string): Promise<boolean>;
  insertToolCall(toolCall: ToolCall): Promise<ToolCall>;
  updateToolCall(toolCall: ToolCall): Promise<ToolCall>;
  listScheduledTasks(): Promise<ScheduledTask[]>;
  getScheduledTask(id: string): Promise<ScheduledTask | undefined>;
  createScheduledTask(input: CreateScheduledTaskInput): Promise<ScheduledTask>;
  /**
   * Partial update. Returns undefined when the row no longer exists (the task
   * may be deleted while an execution is in flight) instead of throwing.
   */
  updateScheduledTask(
    id: string,
    input: UpdateScheduledTaskInput
  ): Promise<ScheduledTask | undefined>;
  deleteScheduledTask(id: string): Promise<boolean>;
  /** Small key-value settings (JSON strings), e.g. the Feishu config. */
  getSetting(key: string): Promise<string | undefined>;
  setSetting(key: string, value: string): Promise<void>;
}
