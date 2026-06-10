import type {
  AccessMode,
  Message,
  Project,
  ProviderConfig,
  RunRecord,
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
}

export interface CreateRunInput {
  id: string;
  sessionId: string;
  status: "running" | "completed" | "aborted" | "failed";
}

export interface UpdateSessionInput {
  title?: string;
  providerId?: string | null;
  accessMode?: AccessMode;
  /** undefined preserves the current value; null clears it. */
  compactedUpToMessageId?: string | null;
}

export interface StateStore {
  initialize(): Promise<void>;
  close(): Promise<void>;
  listProjects(): Promise<Project[]>;
  getProject(id: string): Promise<Project | undefined>;
  getProjectByPath(path: string): Promise<Project | undefined>;
  createProject(input: CreateProjectInput): Promise<Project>;
  listSessions(projectId?: string | null): Promise<Session[]>;
  getSession(id: string): Promise<Session | undefined>;
  /** The session bound to a Feishu chat, if one exists (one session per chat). */
  findSessionByFeishuChatId(chatId: string): Promise<Session | undefined>;
  createSession(input: CreateSessionInput): Promise<Session>;
  updateSession(id: string, input: UpdateSessionInput): Promise<Session>;
  deleteSession(id: string): Promise<boolean>;
  /**
   * Clones messages up to and including `messageId` into a new session
   * linked to the source via parentSessionId/forkMessageId. Runs/tool calls
   * are not cloned (tool-role messages keep the model context intact).
   */
  forkSession(sessionId: string, messageId: string): Promise<Session>;
  touchSession(id: string, title?: string): Promise<void>;
  addMessage(input: CreateMessageInput): Promise<Message>;
  listMessages(sessionId: string): Promise<Message[]>;
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
  /** Small key-value settings (JSON strings), e.g. the Feishu config. */
  getSetting(key: string): Promise<string | undefined>;
  setSetting(key: string, value: string): Promise<void>;
}
