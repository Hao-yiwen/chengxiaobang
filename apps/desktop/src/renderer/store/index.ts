import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  askUserArgsSchema,
  createId,
  getCatalogModelOptions,
  isStreamEvent
} from "@chengxiaobang/shared";
import type {
  AccessMode,
  ActiveRunSnapshot,
  AppEvent,
  ApprovalDecision,
  FeishuConfig,
  FeishuConfigInput,
  FeishuStatus,
  Message,
  MessageAttachment,
  Project,
  ProjectFileEntry,
  ProviderConfig,
  ProviderInput,
  ProviderKind,
  ReasoningMode,
  RunImageAttachment,
  RunRecord,
  ScheduledTaskEvent,
  ScheduledTask,
  ScheduledTaskUpdate,
  Session,
  SessionSearchResult,
  SkillCreateInput,
  SkillDetail,
  SkillSummary,
  SlashCommand,
  StreamEvent,
  TokenUsage,
  ToolActivity,
  ToolCall,
  WebSearchConfig,
  WebSearchConfigInput
} from "@chengxiaobang/shared";
import { previewKindForPath, type PreviewKind } from "../../common/file-preview";
import {
  prepareAttachmentsForRun,
  saveDisplayAttachmentSnapshots,
  type AttachmentDescriptor
} from "../lib/attachment-preparation";
import type { ArtifactKind } from "../lib/artifact";
import { createApiClient, type ApiClient } from "../lib/api";
import { downloadTextFile } from "../lib/download";
import { showSystemNotification } from "../lib/notifications";
import { buildSessionMarkdown, exportFilename } from "../lib/session-export";
import i18n, { DEFAULT_LOCALE, type Locale } from "../i18n";

export type Theme = "light" | "dark" | "system";
export type View = "home" | "chat" | "settings" | "tasks" | "skills";
export type RightPanelMode = "changes" | "terminal" | "browser" | "files" | "chat";
type ScheduledTaskFinishedEvent = Extract<ScheduledTaskEvent, { type: "scheduled_task_finished" }>;
type SessionRunHistory = { runs: RunRecord[]; toolCalls: ToolCall[] };

export interface Attachment extends AttachmentDescriptor {
  path: string;
  name: string;
  size: number;
  kind?: PreviewKind;
  text?: string;
}

type ComposerDraftScope = string;

interface ComposerDraft {
  input: string;
  attachments: Attachment[];
}

interface RunPromptDisplay {
  content?: string;
  attachments?: MessageAttachment[];
}

/** One command run from the terminal panel; output is absent while running. */
export interface TerminalEntry {
  id: string;
  command: string;
  output?: string;
  exitCode?: number;
}

export interface NotificationToast {
  id: string;
  kind: "success" | "warning" | "error";
  title: string;
  description?: string;
  createdAt: number;
}

export interface PreviewFileState {
  path: string;
  projectPath?: string;
  sessionId?: string;
}

interface RightPanelSessionState {
  open: boolean;
  mode: RightPanelMode | null;
  width: number;
  previewFile?: PreviewFileState;
  browserUrl: string;
}

type LegacyRightPanelMode = RightPanelMode | "progress" | "artifacts";
type LegacyRightPanelSessionState = Omit<RightPanelSessionState, "mode"> & {
  mode: LegacyRightPanelMode | null;
};

const RIGHT_PANEL_MIN_WIDTH = 300;
const RIGHT_PANEL_MAX_WIDTH = 720;
/** File preview widens the panel to at least this, like an editor pane. */
const RIGHT_PANEL_FILE_WIDTH = 480;
const INTERRUPTED_RUN_ERROR =
  "运行进程已重启，无法继续等待审批或工具结果。请重新发起本次请求。";

// The ApiClient is not serializable, so it lives outside the persisted store.
let apiClient: ApiClient | undefined;
let unsubscribeRunEvents: (() => void) | undefined;

interface AppState {
  // data
  projects: Project[];
  sessions: Session[];
  messages: Message[];
  toolHistory: ToolCall[];
  runHistory: RunRecord[];
  providers: ProviderConfig[];
  slashCommands: SlashCommand[];
  // selection (persisted)
  activeSessionId?: string;
  activeProjectId?: string;
  providerId?: string;
  model?: string;
  reasoningMode?: ReasoningMode;
  planMode: boolean;
  accessMode: AccessMode;
  // ui
  view: View;
  paletteOpen: boolean;
  /** First-run provider setup dialog (shown instead of forcing the settings page). */
  onboardingOpen: boolean;
  notice?: string;
  notificationToasts: NotificationToast[];
  // run (transient)
  input: string;
  attachments: Attachment[];
  composerDraftsByScope: Record<ComposerDraftScope, ComposerDraft>;
  activeComposerDraftScope: ComposerDraftScope;
  /** Project file suggestions for the composer's @-mention menu. */
  fileSuggestions: string[];
  streamText: string;
  thinking: string;
  // When the current turn's reasoning stream began (epoch ms), for the live timer.
  // Completed reasoning is persisted on the message (message.reasoning) instead.
  thinkingStartedAt?: number;
  events: StreamEvent[];
  toolActivity?: ToolActivity;
  runningTool?: ToolCall;
  pendingTool?: ToolCall;
  isRunning: boolean;
  runningSessionsById: Record<string, true>;
  runningRunSessionById: Record<string, string>;
  runningTaskIds: Record<string, true>;
  activeRunId?: string;
  activeRunClientRequestId?: string;
  progressPanelOpen: boolean;
  progressPanelAutoOpenedRunId?: string;
  activeRunModel?: { providerId?: string; model: string; reasoningMode?: ReasoningMode };
  activeRunLastAssistant?: Message;
  lastUsage?: TokenUsage;
  lastRunModel?: { providerId?: string; model: string; reasoningMode?: ReasoningMode };
  runMeta: Record<
    string,
    {
      durationMs: number;
      promptTokens: number;
      completionTokens: number;
      model: string;
      reasoningMode?: ReasoningMode;
    }
  >;
  // left sidebar (persisted)
  sidebarOpen: boolean;
  // right workspace panel (current session state + per-session memory)
  rightPanelOpen: boolean;
  /** null = the panel's menu page (pick a tool). */
  rightPanelMode: RightPanelMode | null;
  rightPanelWidth: number;
  previewFile?: PreviewFileState;
  browserUrl: string;
  rightPanelBySession: Record<string, RightPanelSessionState>;
  terminalEntries: TerminalEntry[];
  terminalRunning: boolean;
  // feishu integration (transient; loaded when the settings section opens)
  feishuConfig?: FeishuConfig;
  feishuStatus?: FeishuStatus;
  // 网络搜索集成（瞬态；打开对应设置页时加载）
  webSearchConfig?: WebSearchConfig;
  // scheduled tasks (transient; loaded when the tasks view opens)
  tasks: ScheduledTask[];
  // skills（瞬态；打开技能页时加载）
  skills: SkillSummary[];
  /** 一次性信号：从别处（如输入框加号）进入技能页时顺带打开「添加技能」弹窗。 */
  skillsAddRequested: boolean;
  // theme (persisted)
  theme: Theme;
  // language (persisted)
  locale: Locale;
  // readiness
  clientReady: boolean;

  // setters
  setView(view: View): void;
  /** 跳到技能页；openAdd 为真时同时请求打开「添加技能」弹窗。 */
  openSkills(openAdd?: boolean): void;
  /** 消费一次性的「添加技能」请求（SkillsView 打开弹窗后调用）。 */
  clearSkillsAddRequest(): void;
  setInput(input: string): void;
  setPaletteOpen(open: boolean): void;
  setOnboardingOpen(open: boolean): void;
  setNotice(notice: string | undefined): void;
  dismissNotificationToast(id: string): void;
  setProviderId(id: string | undefined): void;
  setModel(model: string | undefined): void;
  setReasoningMode(reasoningMode: ReasoningMode | undefined): void;
  setPlanMode(enabled: boolean): void;
  setAccessMode(mode: AccessMode): void;
  setActiveProjectId(id: string | undefined): void;
  setTheme(theme: Theme): void;
  setLocale(locale: Locale): void;
  /** 折叠/展开左侧边栏。 */
  toggleSidebar(): void;
  /** Closed -> opens on the menu page; open -> closes. */
  toggleRightPanel(): void;
  /** Opens the panel on a tool page, or back on the menu page with null. */
  openRightPanel(mode: RightPanelMode | null): void;
  closeRightPanel(): void;
  setRightPanelWidth(width: number): void;
  setBrowserUrl(url: string): void;
  openFilePreview(path: string): void;
  /** 打开生成物：统一进入右侧文件预览工作台，由预览器按类型处理。 */
  openArtifact(path: string, kind: ArtifactKind): void;
  runTerminalCommand(command: string): Promise<void>;

  // actions
  initClient(injected?: ApiClient): Promise<void>;
  loadData(): Promise<
    { projects: Project[]; sessions: Session[]; providers: ProviderConfig[] } | undefined
  >;
  refresh(): Promise<void>;
  refreshSlashCommands(projectId?: string): Promise<void>;
  loadFileSuggestions(query: string): Promise<void>;
  listProjectDirectory(path?: string): Promise<ProjectFileEntry[]>;
  restoreInitialState(): Promise<void>;
  loadSessionDetail(id: string, view?: View): Promise<void>;
  selectSession(id: string): Promise<void>;
  searchSessions(query: string): Promise<SessionSearchResult[]>;
  renameSession(id: string, title: string): Promise<void>;
  /** 置顶/取消置顶会话（侧边栏置顶区）。 */
  setSessionPinned(id: string, pinned: boolean): Promise<void>;
  deleteSession(id: string): Promise<void>;
  /** Downloads any session (active or not) as a Markdown document. */
  exportSession(id: string): Promise<void>;
  /** Branches the active session at a message and switches to the new branch. */
  forkSession(messageId: string): Promise<void>;
  /** Renames a project (the folder on disk is untouched). */
  renameProject(id: string, name: string): Promise<void>;
  /** 置顶/取消置顶项目（侧边栏置顶区）。 */
  setProjectPinned(id: string, pinned: boolean): Promise<void>;
  /** Deletes a project and everything in it (sessions, messages, runs). */
  deleteProject(id: string): Promise<void>;
  newChat(): void;
  /** Starts a new chat already scoped to the given project (home view, project preselected). */
  newChatInProject(projectId: string): void;
  openFolder(): Promise<void>;
  createBlankProject(name: string): Promise<void>;
  addContext(): Promise<void>;
  addDroppedContext(files: File[]): Promise<void>;
  removeAttachment(path: string): void;
  submit(): Promise<void>;
  /** Runs an already-assembled prompt in the active session (used by submit/regenerate/edit). */
  runPrompt(
    prompt: string,
    attachments?: RunImageAttachment[],
    display?: RunPromptDisplay
  ): Promise<void>;
  /** Rewinds to the last user message and re-runs it. */
  regenerateLast(): Promise<void>;
  /** Rewinds to the given user message and re-runs it with edited content. */
  editAndResend(messageId: string, content: string): Promise<void>;
  abortRun(): Promise<void>;
  approve(toolCallId: string, decision: ApprovalDecision | boolean): void;
  handleAppEvent(event: AppEvent): void;
  handleRunEvent(event: StreamEvent, options?: { force?: boolean }): void;
  recoverActiveRunSnapshot(): Promise<void>;
  saveProvider(input: ProviderInput): Promise<void>;
  deleteProvider(id: string): Promise<void>;
  testProvider(id: string): Promise<void>;
  loadFeishuConfig(): Promise<void>;
  saveFeishuConfig(input: FeishuConfigInput): Promise<void>;
  refreshFeishuStatus(): Promise<void>;
  loadWebSearchConfig(): Promise<void>;
  saveWebSearchConfig(input: WebSearchConfigInput): Promise<void>;
  testWebSearchConfig(): Promise<void>;
  loadTasks(): Promise<void>;
  updateTask(id: string, input: ScheduledTaskUpdate): Promise<void>;
  deleteTask(id: string): Promise<void>;
  /** 立即触发一次执行（后端异步跑），随后重拉任务列表带回状态。 */
  runTaskNow(id: string): Promise<void>;
  loadSkills(): Promise<void>;
  /** 拉取单个技能的详情（含正文），用于详情弹窗；失败或不可用返回 undefined。 */
  getSkillDetail(name: string): Promise<SkillDetail | undefined>;
  /** 激活/停用市场技能；变更后刷新斜杠命令（技能也是 / 命令）。 */
  setSkillEnabled(name: string, enabled: boolean): Promise<void>;
  importSkillFromUrl(url: string): Promise<void>;
  createCustomSkill(input: SkillCreateInput): Promise<void>;
  deleteCustomSkill(name: string): Promise<void>;
  clearRunState(): void;
}

const initialState = {
  projects: [] as Project[],
  sessions: [] as Session[],
  messages: [] as Message[],
  toolHistory: [] as ToolCall[],
  runHistory: [] as RunRecord[],
  providers: [] as ProviderConfig[],
  slashCommands: [] as SlashCommand[],
  activeSessionId: undefined as string | undefined,
  activeProjectId: undefined as string | undefined,
  providerId: undefined as string | undefined,
  model: undefined as string | undefined,
  reasoningMode: undefined as ReasoningMode | undefined,
  planMode: false,
  accessMode: "approval" as AccessMode,
  view: "home" as View,
  paletteOpen: false,
  onboardingOpen: false,
  notice: undefined as string | undefined,
  notificationToasts: [] as NotificationToast[],
  input: "",
  attachments: [] as Attachment[],
  composerDraftsByScope: {} as Record<ComposerDraftScope, ComposerDraft>,
  activeComposerDraftScope: "home" as ComposerDraftScope,
  fileSuggestions: [] as string[],
  streamText: "",
  thinking: "",
  thinkingStartedAt: undefined as number | undefined,
  events: [] as StreamEvent[],
  toolActivity: undefined as ToolActivity | undefined,
  runningTool: undefined as ToolCall | undefined,
  pendingTool: undefined as ToolCall | undefined,
  isRunning: false,
  runningSessionsById: {} as Record<string, true>,
  runningRunSessionById: {} as Record<string, string>,
  runningTaskIds: {} as Record<string, true>,
  activeRunId: undefined as string | undefined,
  activeRunClientRequestId: undefined as string | undefined,
  progressPanelOpen: false,
  progressPanelAutoOpenedRunId: undefined as string | undefined,
  activeRunModel: undefined as
    | { providerId?: string; model: string; reasoningMode?: ReasoningMode }
    | undefined,
  activeRunLastAssistant: undefined as Message | undefined,
  lastUsage: undefined as TokenUsage | undefined,
  lastRunModel: undefined as
    | { providerId?: string; model: string; reasoningMode?: ReasoningMode }
    | undefined,
  runMeta: {} as Record<
    string,
    {
      durationMs: number;
      promptTokens: number;
      completionTokens: number;
      model: string;
      reasoningMode?: ReasoningMode;
    }
  >,
  sidebarOpen: true,
  rightPanelOpen: false,
  rightPanelMode: null as RightPanelMode | null,
  rightPanelWidth: 380,
  previewFile: undefined as PreviewFileState | undefined,
  browserUrl: "",
  rightPanelBySession: {} as Record<string, RightPanelSessionState>,
  terminalEntries: [] as TerminalEntry[],
  terminalRunning: false,
  feishuConfig: undefined as FeishuConfig | undefined,
  feishuStatus: undefined as FeishuStatus | undefined,
  webSearchConfig: undefined as WebSearchConfig | undefined,
  tasks: [] as ScheduledTask[],
  skills: [] as SkillSummary[],
  skillsAddRequested: false,
  theme: "system" as Theme,
  locale: DEFAULT_LOCALE as Locale,
  clientReady: false
};

function resetHomePlanMode(source: string, wasEnabled?: boolean): Pick<AppState, "planMode"> {
  if (wasEnabled) {
    console.info("[store] 进入首页时关闭计划模式", { source });
  }
  return { planMode: false };
}

const HOME_COMPOSER_DRAFT_SCOPE = "home";

function sessionComposerDraftScope(sessionId: string): ComposerDraftScope {
  return `session:${sessionId}`;
}

function composerDraftScopeForView(
  view: View,
  activeSessionId?: string
): ComposerDraftScope | undefined {
  if (view === "home") {
    return HOME_COMPOSER_DRAFT_SCOPE;
  }
  if (view === "chat" && activeSessionId) {
    return sessionComposerDraftScope(activeSessionId);
  }
  return undefined;
}

function isEmptyComposerDraft(draft: ComposerDraft): boolean {
  return draft.input.length === 0 && draft.attachments.length === 0;
}

function emptyComposerDraft(): ComposerDraft {
  return { input: "", attachments: [] };
}

function rememberComposerDraft(
  state: AppState,
  source: string,
  scope = state.activeComposerDraftScope,
  draft: ComposerDraft = { input: state.input, attachments: state.attachments }
): Record<ComposerDraftScope, ComposerDraft> {
  const next = { ...state.composerDraftsByScope };
  if (isEmptyComposerDraft(draft)) {
    delete next[scope];
  } else {
    next[scope] = draft;
  }
  console.debug("[store] 保存输入草稿", {
    source,
    scope,
    inputChars: draft.input.length,
    attachmentCount: draft.attachments.length
  });
  return next;
}

function restoreComposerDraft(
  drafts: Record<ComposerDraftScope, ComposerDraft>,
  scope: ComposerDraftScope,
  source: string
): Pick<AppState, "input" | "attachments"> {
  const draft = drafts[scope] ?? emptyComposerDraft();
  console.debug("[store] 恢复输入草稿", {
    source,
    scope,
    inputChars: draft.input.length,
    attachmentCount: draft.attachments.length
  });
  return {
    input: draft.input,
    attachments: draft.attachments
  };
}

function switchComposerDraftScope(
  state: AppState,
  targetScope: ComposerDraftScope,
  source: string
): Pick<AppState, "composerDraftsByScope" | "activeComposerDraftScope" | "input" | "attachments"> {
  const drafts = rememberComposerDraft(state, source);
  if (state.activeComposerDraftScope !== targetScope) {
    console.info("[store] 切换输入草稿作用域", {
      source,
      from: state.activeComposerDraftScope,
      to: targetScope
    });
  }
  return {
    composerDraftsByScope: drafts,
    activeComposerDraftScope: targetScope,
    ...restoreComposerDraft(drafts, targetScope, source)
  };
}

function clearActiveComposerDraft(
  state: AppState,
  source: string
): Pick<AppState, "composerDraftsByScope" | "input" | "attachments"> {
  const drafts = { ...state.composerDraftsByScope };
  delete drafts[state.activeComposerDraftScope];
  console.info("[store] 清空当前输入草稿", {
    source,
    scope: state.activeComposerDraftScope,
    inputChars: state.input.length,
    attachmentCount: state.attachments.length
  });
  return {
    composerDraftsByScope: drafts,
    input: "",
    attachments: []
  };
}

function clearActiveComposerInput(
  state: AppState,
  source: string
): Pick<AppState, "composerDraftsByScope" | "input"> {
  return {
    composerDraftsByScope: rememberComposerDraft(state, source, state.activeComposerDraftScope, {
      input: "",
      attachments: state.attachments
    }),
    input: ""
  };
}

function restoredComposerDraftFrom(
  drafts: Record<ComposerDraftScope, ComposerDraft>,
  targetScope: ComposerDraftScope,
  source: string
): Pick<AppState, "composerDraftsByScope" | "activeComposerDraftScope" | "input" | "attachments"> {
  return {
    composerDraftsByScope: drafts,
    activeComposerDraftScope: targetScope,
    ...restoreComposerDraft(drafts, targetScope, source)
  };
}

function dropComposerDraftMemory(
  state: AppState,
  sessionIds: string[]
): Record<ComposerDraftScope, ComposerDraft> {
  if (sessionIds.length === 0) {
    return state.composerDraftsByScope;
  }
  const remove = new Set(sessionIds.map(sessionComposerDraftScope));
  return Object.fromEntries(
    Object.entries(state.composerDraftsByScope).filter(([scope]) => !remove.has(scope))
  );
}

function pruneComposerDraftsByLiveSessions(
  state: AppState,
  liveSessionIds: Set<string>
): Record<ComposerDraftScope, ComposerDraft> {
  return Object.fromEntries(
    Object.entries(state.composerDraftsByScope).filter(([scope]) => {
      if (!scope.startsWith("session:")) {
        return true;
      }
      return liveSessionIds.has(scope.slice("session:".length));
    })
  );
}

function appendMessage(messages: Message[], message: Message): Message[] {
  if (messages.some((item) => item.id === message.id)) {
    return messages;
  }
  return [...messages, message];
}

function upsertToolCall(toolCalls: ToolCall[], toolCall: ToolCall): ToolCall[] {
  if (toolCalls.some((item) => item.id === toolCall.id)) {
    return toolCalls.map((item) => (item.id === toolCall.id ? toolCall : item));
  }
  return [...toolCalls, toolCall];
}

function upsertSession(sessions: Session[], session: Session): Session[] {
  if (sessions.some((item) => item.id === session.id)) {
    return sessions.map((item) => (item.id === session.id ? session : item));
  }
  // First run of a brand-new session: it isn't in the sidebar list yet.
  return [session, ...sessions];
}

function markSessionRunning(state: AppState, sessionId: string): Pick<AppState, "runningSessionsById"> {
  if (state.runningSessionsById[sessionId]) {
    return { runningSessionsById: state.runningSessionsById };
  }
  console.debug("[store] 标记会话运行中", { sessionId });
  return { runningSessionsById: { ...state.runningSessionsById, [sessionId]: true } };
}

function clearSessionRunning(state: AppState, sessionId: string): Pick<AppState, "runningSessionsById"> {
  if (!state.runningSessionsById[sessionId]) {
    return { runningSessionsById: state.runningSessionsById };
  }
  const { [sessionId]: _removed, ...rest } = state.runningSessionsById;
  console.debug("[store] 清理会话运行态", { sessionId });
  return { runningSessionsById: rest };
}

function markRunRunning(
  state: AppState,
  runId: string,
  sessionId: string
): Pick<AppState, "runningSessionsById" | "runningRunSessionById"> {
  const sessionPatch = markSessionRunning(state, sessionId);
  if (state.runningRunSessionById[runId] === sessionId) {
    return {
      ...sessionPatch,
      runningRunSessionById: state.runningRunSessionById
    };
  }
  console.debug("[store] 记录运行归属", { runId, sessionId });
  return {
    ...sessionPatch,
    runningRunSessionById: {
      ...state.runningRunSessionById,
      [runId]: sessionId
    }
  };
}

function clearRunRunning(
  state: AppState,
  runId: string,
  fallbackSessionId?: string
): Pick<AppState, "runningSessionsById" | "runningRunSessionById"> {
  const sessionId = state.runningRunSessionById[runId] ?? fallbackSessionId;
  if (!sessionId) {
    return {
      runningSessionsById: state.runningSessionsById,
      runningRunSessionById: state.runningRunSessionById
    };
  }
  const { [runId]: _removed, ...runningRunSessionById } = state.runningRunSessionById;
  const hasOtherRunningRun = Object.values(runningRunSessionById).some((id) => id === sessionId);
  console.debug("[store] 清理运行归属", { runId, sessionId, hasOtherRunningRun });
  return {
    runningRunSessionById,
    ...(hasOtherRunningRun
      ? { runningSessionsById: state.runningSessionsById }
      : clearSessionRunning(state, sessionId))
  };
}

function clearSessionRunTracking(
  state: AppState,
  sessionId: string
): Pick<AppState, "runningSessionsById" | "runningRunSessionById"> {
  const runningRunSessionById = Object.fromEntries(
    Object.entries(state.runningRunSessionById).filter(([, id]) => id !== sessionId)
  ) as Record<string, string>;
  return {
    runningRunSessionById,
    ...clearSessionRunning(state, sessionId)
  };
}

function addNotificationToast(
  state: AppState,
  toast: Omit<NotificationToast, "id" | "createdAt">
): Pick<AppState, "notificationToasts"> {
  const item: NotificationToast = {
    ...toast,
    id: createId("toast"),
    createdAt: Date.now()
  };
  return {
    notificationToasts: [...state.notificationToasts, item].slice(-4)
  };
}

function scheduledTaskToastKind(
  status: ScheduledTaskFinishedEvent["status"]
): NotificationToast["kind"] {
  if (status === "completed") {
    return "success";
  }
  return status === "aborted" ? "warning" : "error";
}

function scheduledTaskFinishedTitle(event: ScheduledTaskFinishedEvent): string {
  if (event.status === "completed") {
    return i18n.t("notifications.scheduledTask.completedTitle", { name: event.name });
  }
  if (event.status === "aborted") {
    return i18n.t("notifications.scheduledTask.abortedTitle", { name: event.name });
  }
  return i18n.t("notifications.scheduledTask.failedTitle", { name: event.name });
}

function scheduledTaskFinishedDescription(event: ScheduledTaskFinishedEvent): string {
  if (event.error) {
    return i18n.t("notifications.scheduledTask.errorDetail", {
      error: truncateNotificationText(event.error)
    });
  }
  return i18n.t("notifications.scheduledTask.savedToSession");
}

function truncateNotificationText(text: string): string {
  return text.length > 160 ? `${text.slice(0, 157)}...` : text;
}

type AddContextSource = "file_picker" | "file_drop";

interface ResolveContextAttachmentsOptions {
  paths: string[];
  source: AddContextSource;
  bridge: NonNullable<Window["chengxiaobang"]>;
  existingPaths: Set<string>;
  projectPath?: string;
  sessionId?: string;
}

interface ResolveContextAttachmentsResult {
  attachments: Attachment[];
  added: number;
  skipped: number;
  failed: number;
  notices: string[];
}

async function resolveContextAttachments(
  options: ResolveContextAttachmentsOptions
): Promise<ResolveContextAttachmentsResult> {
  const seenPaths = new Set(options.existingPaths);
  const attachments: Attachment[] = [];
  const notices: string[] = [];
  let skipped = 0;
  let failed = 0;

  console.info("[store] 开始解析上下文附件", {
    source: options.source,
    pathCount: options.paths.length,
    projectPath: options.projectPath,
    sessionId: options.sessionId
  });

  for (const path of options.paths) {
    if (!path) {
      skipped += 1;
      notices.push(i18n.t("notice.dropFilePathUnavailable"));
      console.warn("[store] 跳过无本地路径的拖拽附件", { source: options.source });
      continue;
    }
    if (seenPaths.has(path)) {
      skipped += 1;
      console.info("[store] 跳过重复附件", { source: options.source, path });
      continue;
    }
    seenPaths.add(path);

    const fallbackName = path.split(/[\\/]/u).pop() ?? path;
    try {
      const previewInfo = await options.bridge.getFilePreviewInfo?.(path, {
        projectPath: options.projectPath,
        sessionId: options.sessionId
      });
      if (previewInfo?.ok) {
        if (options.source === "file_drop" && previewInfo.kind === "unsupported") {
          failed += 1;
          const notice = i18n.t("notice.skipDroppedUnsupported", { name: previewInfo.name });
          notices.push(notice);
          console.warn("[store] 拖拽附件类型不可作为上下文，已跳过", {
            source: options.source,
            path: previewInfo.path,
            kind: previewInfo.kind,
            size: previewInfo.size
          });
          continue;
        }
        console.info("[store] 已添加附件元信息", {
          source: options.source,
          path: previewInfo.path,
          kind: previewInfo.kind,
          size: previewInfo.size
        });
        attachments.push({
          path: previewInfo.path,
          name: previewInfo.name,
          size: previewInfo.size,
          kind: previewInfo.kind
        });
        continue;
      }
      if (previewInfo && !previewInfo.ok) {
        console.warn("[store] 附件预览信息读取失败，尝试旧文本读取", {
          source: options.source,
          path,
          error: previewInfo.error
        });
      }

      const result = await options.bridge.readFileText?.(path);
      if (result?.ok) {
        console.info("[store] 已按旧文本读取添加附件", {
          source: options.source,
          path,
          size: result.size
        });
        attachments.push({
          path,
          name: result.name,
          size: result.size,
          kind: previewKindForPath(path),
          text: result.text
        });
      } else if (result) {
        failed += 1;
        const notice = i18n.t("notice.skipFile", { name: result.name, error: result.error });
        notices.push(notice);
        console.warn("[store] 附件读取失败，已跳过", {
          source: options.source,
          path,
          error: result.error
        });
      } else {
        failed += 1;
        const notice = i18n.t("notice.skipFile", {
          name: fallbackName,
          error: i18n.t("notice.fileReadUnavailable")
        });
        notices.push(notice);
        console.warn("[store] 附件读取能力不可用，已跳过", {
          source: options.source,
          path
        });
      }
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      notices.push(i18n.t("notice.skipFile", { name: fallbackName, error: message }));
      console.warn("[store] 附件解析异常，已跳过", {
        source: options.source,
        path,
        error: message
      });
    }
  }

  console.info("[store] 上下文附件解析完成", {
    source: options.source,
    pathCount: options.paths.length,
    added: attachments.length,
    skipped,
    failed
  });

  return {
    attachments,
    added: attachments.length,
    skipped,
    failed,
    notices
  };
}

function messageAttachmentsToDescriptors(attachments: MessageAttachment[]): AttachmentDescriptor[] {
  return attachments.map((attachment) => ({
    path: attachment.path,
    name: attachment.name,
    size: attachment.size,
    kind: previewKindForPath(attachment.path)
  }));
}

async function prepareRunInputFromVisibleMessage(options: {
  content: string;
  attachments: AttachmentDescriptor[];
  provider: ProviderConfig;
  model?: string;
  bridge?: Window["chengxiaobang"];
}): Promise<{
  prompt: string;
  nativeAttachments: RunImageAttachment[];
  warnings: string[];
  inputModalities: string[];
}> {
  const preparedAttachments = await prepareAttachmentsForRun({
    attachments: options.attachments,
    provider: options.provider,
    model: options.model,
    bridge: options.bridge,
    formatTextBlock: (attachment, text) =>
      i18n.t("notice.attachmentBlock", {
        name: attachment.name,
        text
      })
  });
  const prompt =
    `${preparedAttachments.textContext}${options.content}`.trim().length > 0
      ? `${preparedAttachments.textContext}${options.content}`
      : preparedAttachments.nativeAttachments.length > 0
        ? "请分析这些图片。"
        : "";
  return {
    prompt,
    nativeAttachments: preparedAttachments.nativeAttachments,
    warnings: preparedAttachments.warnings,
    inputModalities: preparedAttachments.inputModalities
  };
}

function runModelFromStarted(
  event: Extract<StreamEvent, { type: "run_started" }>
): { providerId?: string; model: string; reasoningMode?: ReasoningMode } | undefined {
  if (!event.model) {
    return undefined;
  }
  return {
    providerId: event.providerId,
    model: event.model,
    reasoningMode: event.reasoningMode
  };
}

function logRecoveredFailedRuns(sessionId: string, runs: RunRecord[], source: string): void {
  const failedRuns = runs.filter((run) => run.status === "failed");
  if (failedRuns.length === 0) {
    return;
  }
  console.info("[store] 已恢复失败运行提示", {
    sessionId,
    source,
    runIds: failedRuns.map((run) => run.id)
  });
}

function settleInterruptedRunHistory(
  sessionId: string,
  history: SessionRunHistory,
  source: string
): {
  history: SessionRunHistory;
  interruptedRunIds: string[];
  interruptedToolCallIds: string[];
} {
  const interruptedRunIds = history.runs
    .filter((run) => run.status === "running")
    .map((run) => run.id);
  if (interruptedRunIds.length === 0) {
    return { history, interruptedRunIds: [], interruptedToolCallIds: [] };
  }

  const timestamp = new Date().toISOString();
  const interruptedRunIdSet = new Set(interruptedRunIds);
  const interruptedToolCallIds: string[] = [];
  const settledHistory = {
    runs: history.runs.map((run) =>
      interruptedRunIdSet.has(run.id)
        ? {
            ...run,
            status: "failed" as const,
            error: INTERRUPTED_RUN_ERROR,
            updatedAt: timestamp
          }
        : run
    ),
    toolCalls: history.toolCalls.map((toolCall) => {
      if (
        !interruptedRunIdSet.has(toolCall.runId) ||
        (toolCall.status !== "pending_smart_approval" &&
          toolCall.status !== "pending_approval" &&
          toolCall.status !== "running")
      ) {
        return toolCall;
      }
      interruptedToolCallIds.push(toolCall.id);
      return {
        ...toolCall,
        status: "failed" as const,
        result: INTERRUPTED_RUN_ERROR,
        updatedAt: timestamp
      };
    })
  };

  console.warn("[store] 已收敛无后端活跃快照的历史运行", {
    sessionId,
    source,
    runIds: interruptedRunIds,
    toolCallIds: interruptedToolCallIds,
    reason: INTERRUPTED_RUN_ERROR
  });

  return { history: settledHistory, interruptedRunIds, interruptedToolCallIds };
}

function settledSessionHistoryPatch(
  state: AppState,
  sessionId: string,
  messages: Message[],
  history: SessionRunHistory,
  view?: View
): Partial<AppState> {
  const shouldClearCurrentRun = state.activeSessionId === sessionId;
  const targetScope = view ? composerDraftScopeForView(view, sessionId) : undefined;
  return {
    messages,
    toolHistory: history.toolCalls,
    runHistory: history.runs,
    ...(view ? { view } : {}),
    ...(targetScope ? switchComposerDraftScope(state, targetScope, "settledSessionHistory") : {}),
    ...(shouldClearCurrentRun
      ? {
          isRunning: false,
          activeRunId: undefined,
          activeRunClientRequestId: undefined,
          activeRunModel: undefined,
          activeRunLastAssistant: undefined,
          pendingTool: undefined,
          runningTool: undefined,
          toolActivity: undefined,
          streamText: "",
          thinking: "",
          thinkingStartedAt: undefined,
          events: [],
          ...clearSessionRunTracking(state, sessionId)
        }
      : {})
  };
}

function runRecordFromEndEvent(
  event: Extract<StreamEvent, { type: "run_end" }>,
  sessionId: string,
  existing?: RunRecord
): RunRecord {
  const timestamp = new Date().toISOString();
  return {
    id: event.runId,
    sessionId,
    status: event.status,
    ...(event.usage ? { usage: event.usage } : {}),
    ...(event.status === "failed" && event.error ? { error: event.error } : {}),
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp
  };
}

function upsertRunHistory(runs: RunRecord[], run: RunRecord): RunRecord[] {
  const next = runs.some((item) => item.id === run.id)
    ? runs.map((item) => (item.id === run.id ? run : item))
    : [...runs, run];
  return next.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

function latestActiveRunSnapshot(
  snapshots: ActiveRunSnapshot[]
): ActiveRunSnapshot | undefined {
  return [...snapshots].sort((left, right) =>
    left.run.createdAt.localeCompare(right.run.createdAt)
  ).at(-1);
}

function activeRunRecoveryPatch(
  state: AppState,
  snapshot: ActiveRunSnapshot,
  history: SessionRunHistory,
  source: string
): Partial<AppState> {
  const activeToolCalls = snapshot.toolCalls.length > 0
    ? snapshot.toolCalls
    : history.toolCalls.filter((toolCall) => toolCall.runId === snapshot.run.id);
  const pendingTool = [...activeToolCalls]
    .reverse()
    .find((toolCall) => toolCall.status === "pending_approval");
  const runningTool = [...activeToolCalls]
    .reverse()
    .find(
      (toolCall) =>
        toolCall.status === "running" || toolCall.status === "pending_smart_approval"
    );

  console.info("[store] 恢复后端活跃 run 快照", {
    source,
    sessionId: snapshot.run.sessionId,
    runId: snapshot.run.id,
    pendingToolId: pendingTool?.id,
    runningToolId: runningTool?.id,
    toolCallCount: activeToolCalls.length
  });

  return {
    toolHistory: pendingTool
      ? history.toolCalls.filter((toolCall) => toolCall.id !== pendingTool.id)
      : history.toolCalls,
    runHistory: upsertRunHistory(history.runs, snapshot.run),
    pendingTool,
    runningTool: pendingTool ? undefined : runningTool,
    isRunning: true,
    activeRunId: snapshot.run.id,
    activeRunClientRequestId: undefined,
    activeRunModel: state.activeRunId === snapshot.run.id ? state.activeRunModel : undefined,
    activeRunLastAssistant:
      state.activeRunId === snapshot.run.id ? state.activeRunLastAssistant : undefined,
    toolActivity: undefined,
    streamText: "",
	    thinking: "",
	    thinkingStartedAt: undefined,
	    ...markRunRunning(state, snapshot.run.id, snapshot.run.sessionId)
	  };
}

function shouldHandleRunEvent(
  state: AppState,
  event: StreamEvent,
  force: boolean | undefined
): boolean {
  if (force || event.type === "session_updated") {
    return true;
  }
  if (event.type === "run_started") {
    return Boolean(
      (state.activeRunClientRequestId && event.clientRequestId === state.activeRunClientRequestId) ||
        (state.activeRunId && event.runId === state.activeRunId)
    );
  }
  return Boolean(
    (state.activeRunId && event.runId === state.activeRunId) ||
      state.runHistory.some((run) => run.id === event.runId && run.status === "running")
  );
}

function isConfiguredProvider(provider: ProviderConfig | undefined): provider is ProviderConfig {
  return Boolean(provider?.apiKeyRef);
}

function firstConfiguredProvider(providers: ProviderConfig[]): ProviderConfig | undefined {
  return providers.find(isConfiguredProvider);
}

function configuredProviderById(
  providers: ProviderConfig[],
  id: string | undefined
): ProviderConfig | undefined {
  if (!id) {
    return undefined;
  }
  const provider = providers.find((item) => item.id === id);
  return isConfiguredProvider(provider) ? provider : undefined;
}

const CATALOG_PROVIDER_KINDS: ProviderKind[] = [
  "deepseek",
  "kimi",
  "minimax",
  "doubao",
  "qwen"
];

function catalogOwnsModel(kind: ProviderKind, model: string): boolean {
  return getCatalogModelOptions(kind).some((option) => option.id === model);
}

function modelBelongsToAnotherCatalog(provider: ProviderConfig, model: string): boolean {
  return CATALOG_PROVIDER_KINDS.some(
    (kind) => kind !== provider.kind && catalogOwnsModel(kind, model)
  );
}

function providerAcceptsModel(provider: ProviderConfig, model: string | undefined): boolean {
  if (!model || model === provider.model) {
    return true;
  }
  if (provider.models && provider.models.length > 0) {
    return provider.models.includes(model);
  }
  if (catalogOwnsModel(provider.kind, model)) {
    return true;
  }
  return provider.kind === "custom" || provider.kind === "openai-compatible"
    ? true
    : !modelBelongsToAnotherCatalog(provider, model);
}

function normalizeModelForProvider(
  provider: ProviderConfig,
  model: string | undefined,
  reasoningMode: ReasoningMode | undefined,
  source: string
): Pick<AppState, "model" | "reasoningMode"> {
  if (providerAcceptsModel(provider, model)) {
    return { model, reasoningMode };
  }
  console.warn("[store] 模型不属于当前供应商，已回退到供应商默认模型", {
    source,
    providerId: provider.id,
    providerKind: provider.kind,
    staleModel: model,
    fallbackModel: provider.model
  });
  return { model: undefined, reasoningMode: undefined };
}

function sanitizeLegacyProgressMode(
  mode: LegacyRightPanelMode | null | undefined
): RightPanelMode | null {
  return mode === "progress" || mode === "artifacts" ? null : mode ?? null;
}

function stripLegacyProgressPanelState(state: Partial<AppState>): Partial<AppState> {
  const currentMode = state.rightPanelMode as LegacyRightPanelMode | null | undefined;
  const rightPanelHadFloatingMode = currentMode === "progress" || currentMode === "artifacts";
  let memoryHadFloatingMode = false;
  const rightPanelBySession = Object.fromEntries(
    Object.entries(state.rightPanelBySession ?? {}).map(([sessionId, snapshot]) => {
      const legacySnapshot = snapshot as LegacyRightPanelSessionState;
      if (legacySnapshot.mode !== "progress" && legacySnapshot.mode !== "artifacts") {
        return [sessionId, snapshot];
      }
      memoryHadFloatingMode = true;
      return [
        sessionId,
        {
          ...legacySnapshot,
          open: false,
          mode: null
        } satisfies RightPanelSessionState
      ];
    })
  );
  if (!rightPanelHadFloatingMode && !memoryHadFloatingMode) {
    return state;
  }
  console.info("[store] 迁移旧版右侧面板浮层状态", {
    rightPanelHadFloatingMode,
    memoryHadFloatingMode
  });
  return {
    ...state,
    rightPanelOpen: rightPanelHadFloatingMode ? false : state.rightPanelOpen,
    rightPanelMode: sanitizeLegacyProgressMode(currentMode),
    rightPanelBySession
  };
}

function sanitizePersistedAppState(state: Partial<AppState>): Partial<AppState> {
  const nextState = stripLegacyProgressPanelState(state);
  if (nextState.view !== "home") {
    return nextState;
  }
  return {
    ...nextState,
    planMode: false,
    activeSessionId: undefined,
    progressPanelOpen: false,
    rightPanelOpen: false,
    rightPanelMode: null,
    previewFile: undefined,
    browserUrl: ""
  };
}

function migrateRightPanelMemory(state: Partial<AppState>): Partial<AppState> {
  const rightPanelBySession = state.rightPanelBySession ?? {};
  const activeSessionId = state.activeSessionId;
  if (!activeSessionId || rightPanelBySession[activeSessionId]) {
    return { ...state, rightPanelBySession };
  }
  if (
    !state.rightPanelOpen &&
    !state.rightPanelMode &&
    !state.browserUrl &&
    !state.previewFile
  ) {
    return { ...state, rightPanelBySession };
  }
  return {
    ...state,
    rightPanelBySession: {
      ...rightPanelBySession,
      [activeSessionId]: {
        open: Boolean(state.rightPanelOpen),
        mode: sanitizeLegacyProgressMode(
          state.rightPanelMode as LegacyRightPanelMode | null | undefined
        ),
        width: state.rightPanelWidth ?? initialState.rightPanelWidth,
        browserUrl: state.browserUrl ?? "",
        ...(state.previewFile ? { previewFile: state.previewFile } : {})
      }
    }
  };
}

type RightPanelPatch = Partial<
  Pick<
    AppState,
    "rightPanelOpen" | "rightPanelMode" | "rightPanelWidth" | "previewFile" | "browserUrl"
  >
>;

function hasPatchKey<K extends keyof RightPanelPatch>(
  patch: RightPanelPatch,
  key: K
): patch is RightPanelPatch & Required<Pick<RightPanelPatch, K>> {
  return Object.prototype.hasOwnProperty.call(patch, key);
}

function rightPanelSnapshot(state: AppState, patch: RightPanelPatch = {}): RightPanelSessionState {
  return {
    open: patch.rightPanelOpen ?? state.rightPanelOpen,
    mode: sanitizeLegacyProgressMode(patch.rightPanelMode ?? state.rightPanelMode),
    width: patch.rightPanelWidth ?? state.rightPanelWidth,
    browserUrl: patch.browserUrl ?? state.browserUrl,
    ...(hasPatchKey(patch, "previewFile")
      ? patch.previewFile
        ? { previewFile: patch.previewFile }
        : {}
      : state.previewFile
        ? { previewFile: state.previewFile }
        : {})
  };
}

function rememberRightPanel(
  state: AppState,
  sessionId = state.activeSessionId,
  patch: RightPanelPatch = {}
): Record<string, RightPanelSessionState> {
  if (!sessionId) {
    return state.rightPanelBySession;
  }
  const snapshot = rightPanelSnapshot(state, patch);
  console.debug("[store] 保存会话右侧面板状态", {
    sessionId,
    open: snapshot.open,
    mode: snapshot.mode,
    previewPath: snapshot.previewFile?.path
  });
  return { ...state.rightPanelBySession, [sessionId]: snapshot };
}

/** 创建新项目（打开文件夹 / 新建空白）后选中它并回到首页的统一状态片段。 */
function selectNewProjectState(state: AppState, project: Project, source: string) {
  return {
    rightPanelBySession: rememberRightPanel(state),
    ...switchComposerDraftScope(state, HOME_COMPOSER_DRAFT_SCOPE, source),
    ...resetHomePlanMode(source, state.planMode),
    activeProjectId: project.id,
    activeSessionId: undefined,
    messages: [] as AppState["messages"],
    toolHistory: [] as AppState["toolHistory"],
    runHistory: [] as AppState["runHistory"],
    progressPanelOpen: false,
    rightPanelOpen: false,
    rightPanelMode: null,
    previewFile: undefined,
    browserUrl: "",
    notice: undefined,
    view: "home" as const
  };
}

function restoredRightPanel(
  state: AppState,
  sessionId: string | undefined
): Pick<
  AppState,
  | "progressPanelOpen"
  | "rightPanelOpen"
  | "rightPanelMode"
  | "rightPanelWidth"
  | "previewFile"
  | "browserUrl"
> {
  const snapshot = sessionId ? state.rightPanelBySession[sessionId] : undefined;
  if (!snapshot) {
    console.debug("[store] 目标会话没有右侧面板记忆，默认关闭", { sessionId });
    return {
      progressPanelOpen: false,
      rightPanelOpen: false,
      rightPanelMode: null,
      rightPanelWidth: state.rightPanelWidth,
      previewFile: undefined,
      browserUrl: ""
    };
  }
  console.debug("[store] 恢复会话右侧面板状态", {
    sessionId,
    open: snapshot.open,
    mode: snapshot.mode,
    previewPath: snapshot.previewFile?.path
  });
  return {
    progressPanelOpen: false,
    rightPanelOpen: snapshot.open,
    rightPanelMode: snapshot.mode,
    rightPanelWidth: snapshot.width,
    previewFile: snapshot.previewFile,
    browserUrl: snapshot.browserUrl
  };
}

function dropRightPanelMemory(
  state: AppState,
  sessionIds: string[]
): Record<string, RightPanelSessionState> {
  if (sessionIds.length === 0) {
    return state.rightPanelBySession;
  }
  const remove = new Set(sessionIds);
  return Object.fromEntries(
    Object.entries(state.rightPanelBySession).filter(([sessionId]) => !remove.has(sessionId))
  );
}

function autoOpenProgressPanelPatch(state: AppState, toolCall: ToolCall): Partial<AppState> {
  if (
    toolCall.name !== "todo_create" ||
    state.view !== "chat" ||
    state.activeRunId !== toolCall.runId ||
    state.progressPanelAutoOpenedRunId === toolCall.runId
  ) {
    return {};
  }
  console.info("[store] 检测到 todo 清单，自动打开对话进度浮层", {
    runId: toolCall.runId,
    toolCallId: toolCall.id,
    wasOpen: state.progressPanelOpen,
    rightPanelOpen: state.rightPanelOpen,
    rightPanelMode: state.rightPanelMode
  });
  return {
    progressPanelOpen: true,
    progressPanelAutoOpenedRunId: toolCall.runId
  };
}

/** The provider a run would use: the selected one if configured, else the first configured. */
export function resolveRunProvider(state: AppState): ProviderConfig | undefined {
  const selected =
    state.providers.find((provider) => provider.id === state.providerId) ??
    firstConfiguredProvider(state.providers);
  return isConfiguredProvider(selected) ? selected : undefined;
}

export const useAppStore = create<AppState>()(
  persist<AppState, [], [], Partial<AppState>>(
    (set, get) => ({
      ...initialState,

      setView: (view) =>
        set((state) => {
          const targetScope = composerDraftScopeForView(view, state.activeSessionId);
          return {
            view,
            ...(view === "home" ? resetHomePlanMode("setView", state.planMode) : {}),
            ...(targetScope ? switchComposerDraftScope(state, targetScope, "setView") : {})
          };
        }),
      openSkills: (openAdd) => {
        console.debug("[store] 打开技能页", { openAdd: Boolean(openAdd) });
        set({ view: "skills", skillsAddRequested: Boolean(openAdd) });
      },
      clearSkillsAddRequest: () => set({ skillsAddRequested: false }),
      setInput: (input) => set({ input }),
      setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
      setOnboardingOpen: (onboardingOpen) => set({ onboardingOpen }),
      setNotice: (notice) => set({ notice }),
      dismissNotificationToast: (id) =>
        set((state) => ({
          notificationToasts: state.notificationToasts.filter((toast) => toast.id !== id)
        })),
      setProviderId: (providerId) =>
        set((state) => {
          const provider = configuredProviderById(state.providers, providerId);
          return {
            providerId,
            ...(provider
              ? normalizeModelForProvider(
                  provider,
                  state.model,
                  state.reasoningMode,
                  "setProviderId"
                )
              : { model: undefined, reasoningMode: undefined })
          };
        }),
      setModel: (model) => set({ model }),
      setReasoningMode: (reasoningMode) => set({ reasoningMode }),
      setPlanMode: (planMode) => {
        console.info("[store] 切换计划模式", { planMode });
        set({ planMode });
      },
      setAccessMode: (accessMode) => set({ accessMode }),
      setActiveProjectId: (activeProjectId) => {
        set((state) => ({
          rightPanelBySession: rememberRightPanel(state),
          ...switchComposerDraftScope(state, HOME_COMPOSER_DRAFT_SCOPE, "setActiveProjectId"),
          ...resetHomePlanMode("setActiveProjectId", state.planMode),
          activeProjectId,
          activeSessionId: undefined,
          messages: [],
          toolHistory: [],
          runHistory: [],
          streamText: "",
          thinking: "",
          thinkingStartedAt: undefined,
          events: [],
          toolActivity: undefined,
          runningTool: undefined,
          pendingTool: undefined,
          activeRunId: undefined,
          activeRunClientRequestId: undefined,
          progressPanelOpen: false,
          progressPanelAutoOpenedRunId: undefined,
          activeRunModel: undefined,
          activeRunLastAssistant: undefined,
          rightPanelOpen: false,
          rightPanelMode: null,
          previewFile: undefined,
          browserUrl: "",
          view: "home"
        }));
        void get().refreshSlashCommands(activeProjectId);
      },
      setTheme: (theme) => set({ theme }),
      setLocale: (locale) => set({ locale }),
      toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
      toggleRightPanel: () =>
        set((state) => {
          const patch: RightPanelPatch = state.rightPanelOpen
            ? { rightPanelOpen: false }
            : { rightPanelOpen: true, rightPanelMode: null };
          return {
            ...patch,
            rightPanelBySession: rememberRightPanel(state, undefined, patch)
          };
        }),
      openRightPanel: (mode) =>
        set((state) => {
          const patch: RightPanelPatch = { rightPanelOpen: true, rightPanelMode: mode };
          return {
            ...patch,
            rightPanelBySession: rememberRightPanel(state, undefined, patch)
          };
        }),
      closeRightPanel: () =>
        set((state) => {
          const patch: RightPanelPatch = { rightPanelOpen: false };
          return {
            ...patch,
            rightPanelBySession: rememberRightPanel(state, undefined, patch)
          };
        }),
      setRightPanelWidth: (width) =>
        set((state) => {
          const nextWidth = Math.min(
            RIGHT_PANEL_MAX_WIDTH,
            Math.max(RIGHT_PANEL_MIN_WIDTH, Math.round(width))
          );
          const patch: RightPanelPatch = { rightPanelWidth: nextWidth };
          return {
            ...patch,
            rightPanelBySession: rememberRightPanel(state, undefined, patch)
          };
        }),
      setBrowserUrl: (browserUrl) =>
        set((state) => {
          const patch: RightPanelPatch = { browserUrl };
          return {
            ...patch,
            rightPanelBySession: rememberRightPanel(state, undefined, patch)
          };
        }),

      openFilePreview(path) {
        const state = get();
        const project = selectActiveProject(state);
        const session = selectActiveSession(state);
        const sessionId = session?.id ?? state.activeSessionId;
        console.info("[store] 打开文件预览", {
          path,
          projectPath: project?.path,
          sessionId,
          pathKind: path.startsWith("/") ? "absolute" : "relative"
        });
        set((state) => {
          const patch: RightPanelPatch = {
            previewFile: {
              path,
              ...(project?.path ? { projectPath: project.path } : {}),
              ...(sessionId ? { sessionId } : {})
            },
            rightPanelOpen: true,
            rightPanelMode: "files",
            rightPanelWidth: Math.max(state.rightPanelWidth, RIGHT_PANEL_FILE_WIDTH)
          };
          return {
            ...patch,
            rightPanelBySession: rememberRightPanel(state, undefined, patch)
          };
        });
      },

      openArtifact(path, kind) {
        console.info("[store] 打开生成物预览", { path, kind });
        get().openFilePreview(path);
      },

      async runTerminalCommand(command) {
        const state = get();
        const project = selectActiveProject(state);
        const trimmed = command.trim();
        if (!apiClient || !project || !trimmed || state.terminalRunning) {
          return;
        }
        const id = createId("term");
        set((current) => ({
          terminalEntries: [...current.terminalEntries, { id, command: trimmed }],
          terminalRunning: true
        }));
        const finish = (output: string, exitCode: number) =>
          set((current) => ({
            terminalEntries: current.terminalEntries.map((entry) =>
              entry.id === id ? { ...entry, output, exitCode } : entry
            ),
            terminalRunning: false
          }));
        try {
          const result = await apiClient.terminalExec({
            projectId: project.id,
            command: trimmed
          });
          finish(result.output, result.exitCode);
        } catch (error) {
          finish(error instanceof Error ? error.message : String(error), -1);
        }
      },

      async initClient(injected) {
        apiClient = injected ?? (await createApiClient());
        unsubscribeRunEvents?.();
        if (apiClient.subscribeAppEvents) {
          unsubscribeRunEvents = apiClient.subscribeAppEvents((event) => get().handleAppEvent(event), {
            onReconnect: () => void get().recoverActiveRunSnapshot(),
            onError: (error: unknown) =>
              console.warn("[store] 全局应用事件流异常", {
                error: error instanceof Error ? error.message : String(error)
              })
          });
        } else {
          unsubscribeRunEvents = apiClient.subscribeRunEvents?.(
            (event) => get().handleRunEvent(event),
            {
              onReconnect: () => void get().recoverActiveRunSnapshot(),
              onError: (error: unknown) =>
                console.warn("[store] 全局运行事件流异常", {
                  error: error instanceof Error ? error.message : String(error)
                })
            }
          );
        }
        set({ clientReady: true });
        await get().restoreInitialState();
      },

      async loadData() {
        if (!apiClient) {
          return undefined;
        }
        const [nextProjects, nextSessions, nextProviders] = await Promise.all([
          apiClient.listProjects(),
          apiClient.listSessions(),
          apiClient.listProviders()
        ]);
        const configuredProvider = firstConfiguredProvider(nextProviders);
        set((state) => {
          const activeSessionId = state.view === "home" ? undefined : state.activeSessionId;
          const liveSessionIds = new Set(nextSessions.map((session) => session.id));
          const nextProvider =
            configuredProviderById(nextProviders, state.providerId) ?? configuredProvider;
          const modelState = nextProvider
            ? normalizeModelForProvider(
                nextProvider,
                state.model,
                state.reasoningMode,
                "loadData"
              )
            : { model: undefined, reasoningMode: undefined };
          return {
            projects: nextProjects,
            sessions: nextSessions,
            providers: nextProviders,
            ...modelState,
	    runningSessionsById: Object.fromEntries(
	      Object.entries(state.runningSessionsById).filter(([sessionId]) =>
	        liveSessionIds.has(sessionId)
	      )
	    ) as Record<string, true>,
	    runningRunSessionById: Object.fromEntries(
	      Object.entries(state.runningRunSessionById).filter(([, sessionId]) =>
	        liveSessionIds.has(sessionId)
	      )
	    ) as Record<string, string>,
	    ...(state.view === "home" ? resetHomePlanMode("loadData.home", state.planMode) : {}),
            rightPanelBySession: Object.fromEntries(
              Object.entries(state.rightPanelBySession).filter(([sessionId]) =>
                liveSessionIds.has(sessionId)
              )
            ),
            composerDraftsByScope: pruneComposerDraftsByLiveSessions(state, liveSessionIds),
            activeSessionId,
            providerId: nextProvider?.id,
            activeProjectId:
              state.activeProjectId && nextProjects.some((p) => p.id === state.activeProjectId)
                ? state.activeProjectId
                : (nextSessions.find((s) => s.id === activeSessionId)?.projectId ?? undefined)
          };
        });
        return { projects: nextProjects, sessions: nextSessions, providers: nextProviders };
      },

      async refresh() {
        await get().loadData();
        await get().refreshSlashCommands();
      },

      async refreshSlashCommands(projectId) {
        if (!apiClient) {
          return;
        }
        const targetProjectId = projectId ?? selectActiveProject(get())?.id;
        try {
          const { commands } = await apiClient.listSlashCommands(targetProjectId);
          set({ slashCommands: commands });
        } catch (error) {
          console.warn("加载斜杠命令失败", error);
          set({ slashCommands: [] });
        }
      },

      async loadFileSuggestions(query) {
        const project = selectActiveProject(get());
        if (!apiClient || !project) {
          set({ fileSuggestions: [] });
          return;
        }
        try {
          const files = await apiClient.listProjectFiles(project.id, query);
          set({ fileSuggestions: files });
        } catch (error) {
          console.warn("加载文件建议失败", error);
          set({ fileSuggestions: [] });
        }
      },

      async listProjectDirectory(path = ".") {
        const project = selectActiveProject(get());
        if (!apiClient || !project) {
          console.warn("[store] 文件树目录读取失败：缺少 ApiClient 或当前项目", {
            hasClient: Boolean(apiClient),
            path
          });
          return [];
        }
        console.debug("[store] 读取项目文件树目录", { projectId: project.id, path });
        return apiClient.listProjectDirectory(project.id, path);
      },

      async restoreInitialState() {
        const data = await get().loadData();
        if (!data) {
          return;
        }
        const configuredProvider = firstConfiguredProvider(data.providers);
        if (!configuredProvider) {
          // First run: stay on the home screen and offer a lightweight setup
          // dialog instead of dumping the user into the settings page.
          set((state) => ({
            ...resetHomePlanMode("restoreInitialState.noProvider", get().planMode),
            ...switchComposerDraftScope(
              state,
              HOME_COMPOSER_DRAFT_SCOPE,
              "restoreInitialState.noProvider"
            ),
            activeSessionId: undefined,
            providerId: undefined,
            messages: [],
            toolHistory: [],
            runHistory: [],
            view: "home",
            progressPanelOpen: false,
            rightPanelOpen: false,
            rightPanelMode: null,
            previewFile: undefined,
            browserUrl: "",
            onboardingOpen: true
          }));
          return;
        }
        const restoredView = get().view;
        const storedSessionId = get().activeSessionId;
        const storedSession = storedSessionId
          ? data.sessions.find((session) => session.id === storedSessionId)
          : undefined;
        const fallbackSession =
          !storedSessionId && restoredView !== "home" ? data.sessions[0] : undefined;
        const targetSession = storedSession ?? fallbackSession;
        if (restoredView === "home") {
          console.debug("[store] 首页恢复：跳过会话选中", {
            activeProjectId: get().activeProjectId,
            storedSessionId
          });
          set((state) => ({
            ...resetHomePlanMode("restoreInitialState.home", get().planMode),
            ...switchComposerDraftScope(
              state,
              HOME_COMPOSER_DRAFT_SCOPE,
              "restoreInitialState.home"
            ),
            activeSessionId: undefined,
            messages: [],
            toolHistory: [],
            runHistory: [],
            progressPanelOpen: false,
            rightPanelOpen: false,
            rightPanelMode: null,
            previewFile: undefined,
            browserUrl: "",
            view: "home"
          }));
          await get().refreshSlashCommands();
          return;
        }
        if (!targetSession) {
          if (storedSessionId) {
            console.warn("[store] 持久化会话已不存在，回到首页", { storedSessionId });
          } else {
            console.debug("[store] 没有持久化会话，停留首页", { restoredView });
          }
          set((state) => ({
            ...resetHomePlanMode("restoreInitialState.missingSession", get().planMode),
            ...switchComposerDraftScope(
              state,
              HOME_COMPOSER_DRAFT_SCOPE,
              "restoreInitialState.missingSession"
            ),
            activeSessionId: undefined,
            messages: [],
            toolHistory: [],
            runHistory: [],
            progressPanelOpen: false,
            rightPanelOpen: false,
            rightPanelMode: null,
            previewFile: undefined,
            browserUrl: "",
            view: "home"
          }));
          await get().refreshSlashCommands();
          return;
        }
        console.debug("[store] 恢复启动会话", {
          sessionId: targetSession.id,
          restoredView,
          source: storedSession ? "持久化" : "最新会话"
        });
        set((state) => {
          const sessionProvider =
            configuredProviderById(data.providers, targetSession.providerId) ??
            configuredProviderById(data.providers, state.providerId) ??
            configuredProvider;
          const modelState = sessionProvider
            ? normalizeModelForProvider(
                sessionProvider,
                targetSession.model ?? state.model,
                targetSession.reasoningMode ?? state.reasoningMode,
                "restoreInitialState"
              )
            : { model: undefined, reasoningMode: undefined };
          return {
            ...switchComposerDraftScope(
              state,
              sessionComposerDraftScope(targetSession.id),
              "restoreInitialState"
            ),
            activeSessionId: targetSession.id,
            activeProjectId: targetSession.projectId ?? undefined,
            accessMode: targetSession.accessMode,
            ...restoredRightPanel(state, targetSession.id),
            providerId: sessionProvider?.id,
            ...modelState
          };
        });
        await get().refreshSlashCommands();
        // 预加载活跃会话让对话视图就绪，但保留用户离开时所在的视图。
        await get().loadSessionDetail(targetSession.id, restoredView);
      },

      async loadSessionDetail(id, view = "chat") {
        if (!apiClient) {
          return;
        }
        const [messages, history, activeSnapshots] = await Promise.all([
          apiClient.listMessages(id),
          apiClient.listSessionRuns(id),
          apiClient.listActiveRuns ? apiClient.listActiveRuns(id) : Promise.resolve([])
        ]);
        logRecoveredFailedRuns(id, history.runs, "loadSessionDetail");
        const activeSnapshot = latestActiveRunSnapshot(activeSnapshots);
        if (!activeSnapshot) {
          const settled = settleInterruptedRunHistory(id, history, "loadSessionDetail");
          console.debug("[store] 会话详情未发现后端活跃 run", {
            sessionId: id,
            source: "loadSessionDetail",
            interruptedRunIds: settled.interruptedRunIds
          });
          set((state) =>
            settledSessionHistoryPatch(state, id, messages, settled.history, view)
          );
          return;
        }
        set((state) => ({
          messages,
          view,
          ...activeRunRecoveryPatch(state, activeSnapshot, history, "loadSessionDetail")
        }));
      },

      async selectSession(id) {
        if (!apiClient) {
          return;
        }
        const session = get().sessions.find((item) => item.id === id);
        set((state) => {
          const rightPanelBySession = rememberRightPanel(state);
          const sessionProvider =
            configuredProviderById(state.providers, session?.providerId) ??
            configuredProviderById(state.providers, state.providerId) ??
            firstConfiguredProvider(state.providers);
          const modelState = sessionProvider
            ? normalizeModelForProvider(
                sessionProvider,
                session?.model ?? state.model,
                session?.reasoningMode ?? state.reasoningMode,
                "selectSession"
              )
            : { model: undefined, reasoningMode: undefined };
          return {
            rightPanelBySession,
            ...switchComposerDraftScope(state, sessionComposerDraftScope(id), "selectSession"),
            activeSessionId: id,
            activeProjectId: session?.projectId ?? undefined,
            providerId: sessionProvider?.id,
            ...modelState,
            accessMode: session ? session.accessMode : state.accessMode,
            ...restoredRightPanel({ ...state, rightPanelBySession }, id)
          };
        });
        get().clearRunState();
        await get().refreshSlashCommands(session?.projectId ?? undefined);
        await get().loadSessionDetail(id);
      },

      async searchSessions(query) {
        const trimmed = query.trim();
        if (!trimmed) {
          return [];
        }
        if (!apiClient) {
          console.warn("[store] 搜索会话失败：ApiClient 尚未就绪", { query: trimmed });
          return [];
        }
        try {
          if (apiClient.searchSessions) {
            console.debug("[store] 请求远程会话搜索", { query: trimmed });
            return await apiClient.searchSessions(trimmed);
          }
          console.debug("[store] ApiClient 不支持远程会话搜索，回退到标题过滤", {
            query: trimmed
          });
          const needle = trimmed.toLocaleLowerCase();
          return get()
            .sessions.filter((session) =>
              `${session.title} ${session.id}`.toLocaleLowerCase().includes(needle)
            )
            .map((session) => ({ session, matchType: "title" as const }));
        } catch (error) {
          console.warn("[store] 搜索会话失败", {
            query: trimmed,
            error: error instanceof Error ? error.message : String(error)
          });
          return [];
        }
      },

      async renameSession(id, title) {
        if (!apiClient) {
          return;
        }
        const updated = await apiClient.updateSession(id, { title });
        set((state) => ({
          sessions: state.sessions.map((session) => (session.id === id ? updated : session))
        }));
      },

      async setSessionPinned(id, pinned) {
        if (!apiClient) {
          return;
        }
        console.debug("[store] 更新会话置顶", { id, pinned });
        // 整体替换返回实体：取消置顶时返回对象不含 pinnedAt，merge 会残留旧值。
        const updated = await apiClient.updateSession(id, { pinned });
        set((state) => ({
          sessions: state.sessions.map((session) => (session.id === id ? updated : session))
        }));
      },

      async deleteSession(id) {
        if (!apiClient) {
          return;
        }
        const ok = await apiClient.deleteSession(id);
        if (!ok) {
          return;
        }
        set((state) => {
          const sessions = state.sessions.filter((session) => session.id !== id);
          const rightPanelBySession = dropRightPanelMemory(state, [id]);
          const composerDraftsByScope = dropComposerDraftMemory(state, [id]);
          const { [id]: _runningSession, ...runningSessionsById } = state.runningSessionsById;
          const runningRunSessionById = Object.fromEntries(
            Object.entries(state.runningRunSessionById).filter(([, sessionId]) => sessionId !== id)
          ) as Record<string, string>;
          if (state.activeSessionId === id) {
            return {
              sessions,
              rightPanelBySession,
              ...restoredComposerDraftFrom(
                composerDraftsByScope,
                HOME_COMPOSER_DRAFT_SCOPE,
                "deleteSession"
              ),
              runningSessionsById,
              runningRunSessionById,
              ...resetHomePlanMode("deleteSession", state.planMode),
              activeSessionId: undefined,
              messages: [],
              toolHistory: [],
              runHistory: [],
              progressPanelOpen: false,
              rightPanelOpen: false,
              rightPanelMode: null,
              previewFile: undefined,
              browserUrl: "",
              view: "home" as View
            };
          }
          return {
            sessions,
            rightPanelBySession,
            composerDraftsByScope,
            runningSessionsById,
            runningRunSessionById
          };
        });
      },

      async renameProject(id, name) {
        if (!apiClient) {
          return;
        }
        console.debug("[store] 重命名项目", { id, name });
        const updated = await apiClient.renameProject(id, name);
        set((state) => ({
          projects: state.projects.map((project) => (project.id === id ? updated : project))
        }));
      },

      async setProjectPinned(id, pinned) {
        if (!apiClient) {
          return;
        }
        console.debug("[store] 更新项目置顶", { id, pinned });
        // 整体替换返回实体：取消置顶时返回对象不含 pinnedAt，merge 会残留旧值。
        const updated = await apiClient.setProjectPinned(id, pinned);
        set((state) => ({
          projects: state.projects.map((project) => (project.id === id ? updated : project))
        }));
      },

      async deleteProject(id) {
        if (!apiClient) {
          return;
        }
        const ok = await apiClient.deleteProject(id);
        if (!ok) {
          return;
        }
        set((state) => {
          const projects = state.projects.filter((project) => project.id !== id);
          const sessions = state.sessions.filter((session) => session.projectId !== id);
          const removedSessionIds = state.sessions
            .filter((session) => session.projectId === id)
            .map((session) => session.id);
          const rightPanelBySession = dropRightPanelMemory(state, removedSessionIds);
          const composerDraftsByScope = dropComposerDraftMemory(state, removedSessionIds);
          const activeGone =
            state.activeProjectId === id ||
            (state.activeSessionId &&
              !sessions.some((session) => session.id === state.activeSessionId));
          if (activeGone) {
            return {
              projects,
              sessions,
              rightPanelBySession,
              ...restoredComposerDraftFrom(
                composerDraftsByScope,
                HOME_COMPOSER_DRAFT_SCOPE,
                "deleteProject"
              ),
              ...resetHomePlanMode("deleteProject", state.planMode),
              activeProjectId: undefined,
              activeSessionId: undefined,
              messages: [],
              toolHistory: [],
              runHistory: [],
              progressPanelOpen: false,
              rightPanelOpen: false,
              rightPanelMode: null,
              previewFile: undefined,
              browserUrl: "",
              view: "home" as View
            };
          }
          return { projects, sessions, rightPanelBySession, composerDraftsByScope };
        });
      },

      async exportSession(id) {
        const session = get().sessions.find((item) => item.id === id);
        if (!apiClient || !session) {
          return;
        }
        try {
          // Fetched directly so exporting a non-active session never disturbs
          // the open chat's messages/toolHistory state.
          const [messages, history] = await Promise.all([
            apiClient.listMessages(id),
            apiClient.listSessionRuns(id)
          ]);
          const markdown = buildSessionMarkdown(session, messages, history.toolCalls, {
            user: i18n.t("chat.roleUser"),
            assistant: i18n.t("chat.roleAssistant"),
            toolCall: i18n.t("export.toolCall"),
            reasoning: i18n.t("export.reasoning"),
            exportedAt: i18n.t("export.exportedAt")
          });
          downloadTextFile(exportFilename(session.title), markdown);
        } catch (error) {
          console.warn("导出会话失败", error);
          set({ notice: i18n.t("notice.exportFailed") });
        }
      },

      async forkSession(messageId) {
        const state = get();
        if (!apiClient || !state.activeSessionId || state.isRunning) {
          return;
        }
        const session = await apiClient.forkSession(state.activeSessionId, messageId);
        set((current) => ({ sessions: [session, ...current.sessions] }));
        await get().selectSession(session.id);
      },

      newChat() {
        // No model configured -> invite the quick setup right away (from main).
        if (!firstConfiguredProvider(get().providers)) {
          set({ onboardingOpen: true });
        }
        get().clearRunState();
        set((state) => ({
          rightPanelBySession: rememberRightPanel(state),
          ...switchComposerDraftScope(state, HOME_COMPOSER_DRAFT_SCOPE, "newChat"),
          ...resetHomePlanMode("newChat", state.planMode),
          activeProjectId: undefined,
          activeSessionId: undefined,
          messages: [],
          toolHistory: [],
          runHistory: [],
          progressPanelOpen: false,
          rightPanelOpen: false,
          rightPanelMode: null,
          previewFile: undefined,
          browserUrl: "",
          view: "home"
        }));
        void get().refreshSlashCommands();
      },

      newChatInProject(projectId) {
        console.debug("[store] 在项目下新建会话", { projectId });
        if (!firstConfiguredProvider(get().providers)) {
          set({ onboardingOpen: true });
        }
        get().clearRunState();
        set((state) => ({
          rightPanelBySession: rememberRightPanel(state),
          ...switchComposerDraftScope(state, HOME_COMPOSER_DRAFT_SCOPE, "newChatInProject"),
          ...resetHomePlanMode("newChatInProject", state.planMode),
          activeProjectId: projectId,
          activeSessionId: undefined,
          messages: [],
          toolHistory: [],
          runHistory: [],
          progressPanelOpen: false,
          rightPanelOpen: false,
          rightPanelMode: null,
          previewFile: undefined,
          browserUrl: "",
          view: "home"
        }));
        void get().refreshSlashCommands(projectId);
      },

      async openFolder() {
        if (!apiClient) {
          return;
        }
        if (!window.chengxiaobang?.pickDirectory) {
          set({ notice: i18n.t("notice.openFolderDesktopOnly") });
          return;
        }
        const dir = await window.chengxiaobang.pickDirectory();
        if (!dir) {
          return;
        }
        const project = await apiClient.createProject({ path: dir, name: dir.split("/").pop() });
        await get().refresh();
        get().clearRunState();
        set((state) => selectNewProjectState(state, project, "openFolder"));
        await get().refreshSlashCommands(project.id);
      },

      async createBlankProject(name) {
        console.info("[store] 新建空白项目 入口", { name });
        if (!apiClient) {
          return;
        }
        if (!window.chengxiaobang?.createProjectFolder) {
          set({ notice: i18n.t("notice.openFolderDesktopOnly") });
          return;
        }
        const result = await window.chengxiaobang.createProjectFolder(name);
        if (!result.ok || !result.path) {
          console.error("[store] 新建空白项目 建文件夹失败", { name, error: result.error });
          set({ notice: i18n.t("notice.createBlankProjectFailed") });
          return;
        }
        console.info("[store] 新建空白项目 文件夹已创建", {
          path: result.path,
          name: result.name
        });
        const project = await apiClient.createProject({
          path: result.path,
          name: result.name
        });
        console.info("[store] 新建空白项目 完成", { projectId: project.id });
        await get().refresh();
        get().clearRunState();
        set((state) => selectNewProjectState(state, project, "createBlankProject"));
        await get().refreshSlashCommands(project.id);
      },

      async addContext() {
        const bridge = window.chengxiaobang;
        if (!bridge?.pickFiles) {
          set({ notice: i18n.t("notice.addContextDesktopOnly") });
          return;
        }
        const paths = (await bridge.pickFiles()) ?? [];
        const activeProject = selectActiveProject(get());
        const result = await resolveContextAttachments({
          paths,
          source: "file_picker",
          bridge,
          existingPaths: new Set(get().attachments.map((attachment) => attachment.path)),
          projectPath: activeProject?.path,
          sessionId: get().activeSessionId
        });
        if (result.attachments.length > 0) {
          set((state) => {
            const existing = new Set(state.attachments.map((attachment) => attachment.path));
            const nextAttachments = result.attachments.filter(
              (attachment) => !existing.has(attachment.path)
            );
            return nextAttachments.length > 0
              ? { attachments: [...state.attachments, ...nextAttachments] }
              : {};
          });
        }
        if (result.notices.length > 0) {
          set({ notice: Array.from(new Set(result.notices)).join("\n") });
        }
      },

      async addDroppedContext(files) {
        const bridge = window.chengxiaobang;
        if (!bridge?.getPathForFile) {
          console.warn("[store] 拖拽添加上下文失败：文件路径桥不可用", {
            fileCount: files.length
          });
          set({ notice: i18n.t("notice.addDroppedContextDesktopOnly") });
          return;
        }
        const paths: string[] = [];
        const pathNotices: string[] = [];
        let missingPathCount = 0;
        console.info("[store] 收到拖拽上下文文件", { fileCount: files.length });
        for (const file of files) {
          try {
            const path = bridge.getPathForFile(file);
            if (path) {
              paths.push(path);
              continue;
            }
            missingPathCount += 1;
            console.warn("[store] 拖拽文件缺少本地路径，已跳过", {
              name: file.name,
              type: file.type,
              size: file.size
            });
          } catch (error) {
            missingPathCount += 1;
            console.warn("[store] 拖拽文件路径解析失败，已跳过", {
              name: file.name,
              type: file.type,
              size: file.size,
              error: error instanceof Error ? error.message : String(error)
            });
          }
        }
        if (missingPathCount > 0) {
          pathNotices.push(i18n.t("notice.dropFilePathUnavailable"));
        }
        if (paths.length === 0) {
          set({
            notice:
              pathNotices[0] ??
              i18n.t("notice.dropNoUsableFile", { count: files.length })
          });
          return;
        }
        const activeProject = selectActiveProject(get());
        const result = await resolveContextAttachments({
          paths,
          source: "file_drop",
          bridge,
          existingPaths: new Set(get().attachments.map((attachment) => attachment.path)),
          projectPath: activeProject?.path,
          sessionId: get().activeSessionId
        });
        if (result.attachments.length > 0) {
          set((state) => {
            const existing = new Set(state.attachments.map((attachment) => attachment.path));
            const nextAttachments = result.attachments.filter(
              (attachment) => !existing.has(attachment.path)
            );
            return nextAttachments.length > 0
              ? { attachments: [...state.attachments, ...nextAttachments] }
              : {};
          });
        }
        const notices = Array.from(new Set([...pathNotices, ...result.notices]));
        if (notices.length > 0) {
          set({ notice: notices.join("\n") });
        }
        console.info("[store] 拖拽上下文文件处理完成", {
          fileCount: files.length,
          resolvedPathCount: paths.length,
          missingPathCount,
          added: result.added,
          skipped: result.skipped,
          failed: result.failed
        });
      },

      removeAttachment(path) {
        set((state) => ({
          attachments: state.attachments.filter((attachment) => attachment.path !== path)
        }));
      },

      async submit() {
        const state = get();
        if (!apiClient || (state.input.trim().length === 0 && state.attachments.length === 0)) {
          return;
        }
        if (
          state.isRunning &&
          state.pendingTool?.name === "ask_user" &&
          state.activeRunId === state.pendingTool.runId
        ) {
          const answer = state.input.trim();
          const parsedAskUser = askUserArgsSchema.safeParse(state.pendingTool.args);
          const questions = parsedAskUser.success
            ? parsedAskUser.data.questions
            : [{ question: "用户回答" }];
          if (questions.length > 1) {
            console.warn("[store] 多题 ask_user 不接受输入框快捷回答，请使用提问面板提交", {
              toolCallId: state.pendingTool.id,
              questionCount: questions.length
            });
            return;
          }
          console.info("[store] 将输入框内容作为 ask_user 回答", {
            toolCallId: state.pendingTool.id,
            answerLength: answer.length
          });
          get().approve(state.pendingTool.id, {
            approved: true,
            answer: { answers: [{ question: questions[0]?.question ?? "用户回答", text: answer }] }
          });
          set((state) => clearActiveComposerInput(state, "submit.askUser"));
          return;
        }
        if (
          state.view !== "home" &&
          state.isRunning &&
          (state.activeRunId || state.activeRunClientRequestId)
        ) {
          console.debug("[store] 当前会话运行中，忽略重复提交", {
            activeSessionId: state.activeSessionId,
            activeRunId: state.activeRunId,
            activeRunClientRequestId: state.activeRunClientRequestId
          });
          return;
        }
        const selectedProvider = resolveRunProvider(state);
        if (!selectedProvider) {
          // No model configured yet — prompt a quick setup; keep the typed input.
          set({ onboardingOpen: true });
          return;
        }
        const modelState = normalizeModelForProvider(
          selectedProvider,
          state.model,
          state.reasoningMode,
          "submit"
        );
        const { attachments, input } = state;
        let displayAttachments: MessageAttachment[];
        try {
          displayAttachments = await saveDisplayAttachmentSnapshots(attachments, window.chengxiaobang);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.warn("[store] 附件快照保存失败，取消本次运行", {
            attachmentCount: attachments.length,
            error: message
          });
          set({ notice: `附件保存失败：${message}` });
          return;
        }
        const preparedRun = await prepareRunInputFromVisibleMessage({
          content: input,
          attachments: messageAttachmentsToDescriptors(displayAttachments),
          provider: selectedProvider,
          model: modelState.model,
          bridge: window.chengxiaobang
        });
        if (preparedRun.warnings.length > 0) {
          console.warn("[store] 附件准备存在警告", {
            warnings: preparedRun.warnings,
            inputModalities: preparedRun.inputModalities
          });
          set({ notice: preparedRun.warnings.join("\n") });
        }
        if (!preparedRun.prompt.trim()) {
          return;
        }
        set((state) => clearActiveComposerDraft(state, "submit"));
        await get().runPrompt(preparedRun.prompt, preparedRun.nativeAttachments, {
          content: input,
          attachments: displayAttachments
        });
      },

      async regenerateLast() {
        const state = get();
        if (!apiClient || state.isRunning || !state.activeSessionId) {
          return;
        }
        const sessionId = state.activeSessionId;
        const lastUser = [...state.messages].reverse().find((item) => item.role === "user");
        if (!lastUser) {
          console.warn("[store] 重新生成失败：会话中没有可重试的用户消息", {
            sessionId
          });
          return;
        }
        const selectedProvider = resolveRunProvider(state);
        if (!selectedProvider) {
          set({ onboardingOpen: true });
          return;
        }
        const modelState = normalizeModelForProvider(
          selectedProvider,
          state.model,
          state.reasoningMode,
          "regenerateLast"
        );
        const preparedRun = await prepareRunInputFromVisibleMessage({
          content: lastUser.content,
          attachments: messageAttachmentsToDescriptors(lastUser.attachments ?? []),
          provider: selectedProvider,
          model: modelState.model,
          bridge: window.chengxiaobang
        });
        if (!preparedRun.prompt.trim()) {
          return;
        }
        console.info("[store] 重试最后一条用户消息", {
          sessionId,
          messageId: lastUser.id,
          contentChars: lastUser.content.length,
          attachmentCount: lastUser.attachments?.length ?? 0
        });
        await apiClient.rewindSession(sessionId, lastUser.id);
        await get().loadSessionDetail(sessionId);
        console.info("[store] 重试请求已刷新本地会话历史", {
          sessionId,
          messageId: lastUser.id,
          contentPreview: lastUser.content.slice(0, 80),
          attachmentCount: lastUser.attachments?.length ?? 0
        });
        await get().runPrompt(preparedRun.prompt, preparedRun.nativeAttachments, {
          content: lastUser.content,
          attachments: lastUser.attachments ?? []
        });
      },

      async editAndResend(messageId, content) {
        const state = get();
        const originalMessage = state.messages.find((item) => item.id === messageId);
        if (
          !apiClient ||
          state.isRunning ||
          !state.activeSessionId ||
          (content.trim().length === 0 && (originalMessage?.attachments?.length ?? 0) === 0)
        ) {
          return;
        }
        const selectedProvider = resolveRunProvider(state);
        if (!selectedProvider) {
          set({ onboardingOpen: true });
          return;
        }
        const modelState = normalizeModelForProvider(
          selectedProvider,
          state.model,
          state.reasoningMode,
          "editAndResend"
        );
        const displayAttachments = originalMessage?.attachments ?? [];
        const preparedRun = await prepareRunInputFromVisibleMessage({
          content,
          attachments: messageAttachmentsToDescriptors(displayAttachments),
          provider: selectedProvider,
          model: modelState.model,
          bridge: window.chengxiaobang
        });
        if (!preparedRun.prompt.trim()) {
          return;
        }
        await apiClient.rewindSession(state.activeSessionId, messageId);
        await get().loadSessionDetail(state.activeSessionId);
        await get().runPrompt(preparedRun.prompt, preparedRun.nativeAttachments, {
          content,
          attachments: displayAttachments
        });
      },

      async runPrompt(prompt, attachments = [], display = {}) {
        const state = get();
        if (!apiClient || (prompt.trim().length === 0 && attachments.length === 0)) {
          return;
        }
        const selectedProvider = resolveRunProvider(state);
        if (!selectedProvider) {
          set({ onboardingOpen: true });
          return;
        }
        const modelState = normalizeModelForProvider(
          selectedProvider,
          state.model,
          state.reasoningMode,
          "runPrompt"
        );
        if (
          selectedProvider.id !== state.providerId ||
          modelState.model !== state.model ||
          modelState.reasoningMode !== state.reasoningMode
        ) {
          set({ providerId: selectedProvider.id, ...modelState });
        }
        get().clearRunState();
        const clientRequestId = createId("client_run");
        const { activeSessionId, accessMode, planMode } = state;
        const { model, reasoningMode } = modelState;
        const providerId = selectedProvider.id;
        const activeProject = selectActiveProject(get());
        const runPrompt = prompt.trim().length > 0 ? prompt : "请分析这些图片。";
        const displayContent = display.content ?? runPrompt;
        const displayAttachments = display.attachments ?? [];
        console.info("[store] 发起模型运行", {
          providerId,
          model: model ?? selectedProvider.model,
          nativeAttachmentCount: attachments.length,
          displayAttachmentCount: displayAttachments.length,
          promptChars: runPrompt.length,
          displayChars: displayContent.length
        });
        const runInput = {
          sessionId: activeSessionId,
          projectId: activeProject?.id ?? null,
          prompt: runPrompt,
          displayContent,
          displayAttachments,
          clientRequestId,
          providerId,
          accessMode,
          planMode,
          ...(model ? { model } : {}),
          ...(reasoningMode ? { reasoningMode } : {}),
          ...(attachments.length > 0 ? { attachments } : {})
        };
        set({
          isRunning: true,
          view: "chat",
          activeRunClientRequestId: clientRequestId,
          progressPanelOpen: false
        });
        try {
          if (apiClient.startRun && apiClient.subscribeRunEvents) {
            const started = await apiClient.startRun(runInput);
            const startedModel = started.model
              ? {
                  providerId: started.providerId,
                  model: started.model,
                  reasoningMode: started.reasoningMode
                }
              : undefined;
            set((current) => {
              if (current.activeRunClientRequestId !== clientRequestId) {
                return {};
              }
              return {
                ...switchComposerDraftScope(
                  current,
                  sessionComposerDraftScope(started.sessionId),
                  "runPrompt.startRun"
                ),
	                activeRunId: current.activeRunId ?? started.runId,
	                activeSessionId: started.sessionId,
	                view: "chat",
	                ...markRunRunning(current, started.runId, started.sessionId),
	                ...(startedModel ? { activeRunModel: startedModel, lastRunModel: startedModel } : {})
	              };
            });
            return;
          }
          await apiClient.streamRun(runInput, (event) => {
            get().handleRunEvent(event, { force: true });
          });
        } catch (error) {
          console.error("[store] 运行流中断:", error);
          set((current) => ({
            isRunning: false,
            activeRunId: undefined,
            activeRunClientRequestId: undefined,
            progressPanelOpen: false,
            progressPanelAutoOpenedRunId: undefined,
            activeRunModel: undefined,
            activeRunLastAssistant: undefined,
	            pendingTool: undefined,
	            runningTool: undefined,
	            toolActivity: undefined,
	            ...(current.activeRunId
	              ? clearRunRunning(current, current.activeRunId, current.activeSessionId)
	              : current.activeSessionId
	                ? clearSessionRunning(current, current.activeSessionId)
	                : {}),
	            events: [
              ...current.events,
              {
                type: "run_end",
                runId: "local",
                status: "failed",
                error: error instanceof Error ? error.message : String(error)
              }
            ]
          }));
        }
      },

      async abortRun() {
        const { activeRunId } = get();
        if (!apiClient || !activeRunId) {
          return;
        }
        await apiClient.abort(activeRunId);
      },

      approve(toolCallId, decision) {
        const normalized = typeof decision === "boolean" ? { approved: decision } : decision;
        void apiClient?.approve(toolCallId, normalized);
      },

      handleAppEvent(event) {
        if (isStreamEvent(event)) {
          get().handleRunEvent(event);
          return;
        }
        console.info("[store] 收到定时任务事件", {
          type: event.type,
          taskId: event.taskId,
          sessionId: event.sessionId,
          status: event.type === "scheduled_task_finished" ? event.status : undefined
        });
        if (event.type === "scheduled_task_started") {
          set((state) => ({
            ...markSessionRunning(state, event.sessionId),
            runningTaskIds: { ...state.runningTaskIds, [event.taskId]: true }
          }));
          void get().loadTasks();
          return;
        }

        const title = scheduledTaskFinishedTitle(event);
        const description = scheduledTaskFinishedDescription(event);
        set((state) => {
          const { [event.taskId]: _removed, ...runningTaskIds } = state.runningTaskIds;
          return {
            ...clearSessionRunning(state, event.sessionId),
            runningTaskIds,
            ...addNotificationToast(state, {
              kind: scheduledTaskToastKind(event.status),
              title,
              description
            })
          };
        });
        void showSystemNotification({ title, body: description }).then((sent) => {
          if (!sent) {
            console.info("[store] 系统通知未发送，保留应用内提示", {
              taskId: event.taskId,
              status: event.status
            });
          }
        });
        void get().loadTasks();
      },

      handleRunEvent(event, options) {
        const currentState = get();
        const runEndSessionId =
          event.type === "run_end" ? currentState.runningRunSessionById[event.runId] : undefined;
        if (event.type === "run_started") {
          set((state) => markRunRunning(state, event.runId, event.sessionId));
        } else if (event.type === "run_end") {
          set((state) => clearRunRunning(state, event.runId, runEndSessionId));
        }
        if (!shouldHandleRunEvent(get(), event, options?.force)) {
          return;
        }
        if (event.type === "session_updated") {
          // AI 标题可能来自其他 run；侧边栏元数据可以全局接收。
          set((current) => ({
            sessions: upsertSession(current.sessions, event.session)
          }));
          return;
        }

        set((current) => ({ events: [...current.events, event] }));
        switch (event.type) {
          case "run_started": {
            const runModel = runModelFromStarted(event);
            set((state) => ({
              ...switchComposerDraftScope(
                state,
                sessionComposerDraftScope(event.sessionId),
                "handleRunEvent.run_started"
              ),
              activeRunId: event.runId,
              activeSessionId: event.sessionId,
              activeRunClientRequestId: event.clientRequestId ?? get().activeRunClientRequestId,
              progressPanelOpen: false,
              progressPanelAutoOpenedRunId: undefined,
              activeRunModel: runModel,
              view: "chat",
              isRunning: true,
              ...markRunRunning(state, event.runId, event.sessionId),
              ...(runModel ? { lastRunModel: runModel } : {})
            }));
            break;
          }
          case "delta":
            if (event.channel === "text") {
              set((current) => ({ streamText: current.streamText + event.delta }));
            } else {
              set((current) => ({
                thinking: current.thinking + event.delta,
                thinkingStartedAt: current.thinkingStartedAt ?? Date.now()
              }));
            }
            break;
          case "tool_activity":
            set({ toolActivity: event.activity });
            break;
          case "message":
            // 一个 run 会推送 user 回显、工具间 assistant 轮次和最终回答。
            // assistant 消息已带持久化 reasoning，因此这里只清理实时缓冲。
            set((current) => ({
              messages: appendMessage(current.messages, event.message),
              ...(event.message.role === "assistant"
                ? {
                    streamText: "",
                    thinking: "",
                    thinkingStartedAt: undefined,
                    activeRunLastAssistant: event.message
                  }
                : {})
            }));
            break;
          case "tool_call":
            // tool_call.status 是状态机：pending_approval 独立进底部 dock，
            // 智能审批等待态不需要用户点击，进入历史/活动区展示即可。
            if (event.toolCall.status === "pending_approval") {
              set({
                pendingTool: event.toolCall,
                runningTool: undefined,
                toolActivity: undefined
              });
            } else if (
              event.toolCall.status === "running" ||
              event.toolCall.status === "pending_smart_approval"
            ) {
              set((current) => ({
                pendingTool: undefined,
                runningTool: event.toolCall,
                toolActivity: undefined,
                toolHistory: upsertToolCall(current.toolHistory, event.toolCall),
                ...autoOpenProgressPanelPatch(current, event.toolCall)
              }));
            } else {
              set((current) => ({
                pendingTool: undefined,
                runningTool: undefined,
                toolActivity: undefined,
                toolHistory: upsertToolCall(current.toolHistory, event.toolCall),
                ...autoOpenProgressPanelPatch(current, event.toolCall)
              }));
            }
            break;
          case "run_end": {
            const sessionId = runEndSessionId ?? get().activeSessionId;
            set((current) => ({
              isRunning: false,
              activeRunId: undefined,
              activeRunClientRequestId: undefined,
              progressPanelAutoOpenedRunId: undefined,
              activeRunModel: undefined,
              activeRunLastAssistant: undefined,
              pendingTool: undefined,
              runningTool: undefined,
              toolActivity: undefined,
              streamText: "",
              thinking: "",
              thinkingStartedAt: undefined,
              ...(sessionId
                ? {
                    runHistory: upsertRunHistory(
                      current.runHistory,
                      runRecordFromEndEvent(
                        event,
                        sessionId,
                        current.runHistory.find((run) => run.id === event.runId)
                      )
                    )
                  }
                : {}),
              ...(sessionId ? clearRunRunning(current, event.runId, sessionId) : {}),
              ...(event.status === "completed" ? { lastUsage: event.usage } : {}),
              ...(event.status === "completed" &&
              event.usage &&
              current.activeRunModel &&
              current.activeRunLastAssistant?.durationMs !== undefined
                ? {
                    runMeta: {
                      ...current.runMeta,
                      [current.activeRunLastAssistant.id]: {
                        durationMs: current.activeRunLastAssistant.durationMs,
                        promptTokens: event.usage.promptTokens,
                        completionTokens: event.usage.completionTokens,
                        model: current.activeRunModel.model,
                        ...(current.activeRunModel.reasoningMode
                          ? { reasoningMode: current.activeRunModel.reasoningMode }
                          : {})
                      }
                    }
                  }
                : {})
            }));
            void (async () => {
              await get().refresh();
              if (sessionId && apiClient) {
                await get().loadSessionDetail(sessionId);
              }
            })();
            break;
          }
        }
      },

      async recoverActiveRunSnapshot() {
        const state = get();
        if (!apiClient) {
          return;
        }
        try {
          const activeSnapshots = apiClient.listActiveRuns
            ? await apiClient.listActiveRuns(state.activeSessionId)
            : [];
          const activeSnapshot = latestActiveRunSnapshot(activeSnapshots);
          if (activeSnapshot && state.view === "home" && !state.activeSessionId) {
            console.info("[store] 首页跳过活跃 run 自动恢复", {
              sessionId: activeSnapshot.run.sessionId,
              runId: activeSnapshot.run.id
            });
            return;
          }

          if (activeSnapshot) {
            if (!state.activeSessionId && state.view === "chat") {
              await get().loadData();
            }
            const session = get().sessions.find((item) => item.id === activeSnapshot.run.sessionId);
            const [messages, history] = await Promise.all([
              apiClient.listMessages(activeSnapshot.run.sessionId),
              apiClient.listSessionRuns(activeSnapshot.run.sessionId)
            ]);
            logRecoveredFailedRuns(
              activeSnapshot.run.sessionId,
              history.runs,
              "recoverActiveRunSnapshot.active"
            );
            set((current) => ({
              ...switchComposerDraftScope(
                current,
                sessionComposerDraftScope(activeSnapshot.run.sessionId),
                "recoverActiveRunSnapshot"
              ),
              activeSessionId: activeSnapshot.run.sessionId,
              activeProjectId: session?.projectId ?? current.activeProjectId,
              ...(session ? { accessMode: session.accessMode } : {}),
              messages,
              ...activeRunRecoveryPatch(
                current,
                activeSnapshot,
                history,
                "recoverActiveRunSnapshot"
              )
            }));
            return;
          }

          const { activeSessionId, activeRunId } = get();
          if (!activeSessionId) {
            console.info("[store] 没有可恢复的后端活跃 run", {
              sessionId: activeSessionId,
              runId: activeRunId
            });
            return;
          }

          console.info("[store] 后端无活跃快照，检查当前 run 是否已结束", {
            sessionId: activeSessionId,
            runId: activeRunId
          });
          const [messages, history] = await Promise.all([
            apiClient.listMessages(activeSessionId),
            apiClient.listSessionRuns(activeSessionId)
          ]);
          const settled = settleInterruptedRunHistory(
            activeSessionId,
            history,
            "recoverActiveRunSnapshot.settled"
          );
          if (!activeRunId) {
            if (settled.interruptedRunIds.length === 0) {
              console.info("[store] 没有可恢复的后端活跃 run", {
                sessionId: activeSessionId,
                runId: activeRunId
              });
            }
            set((state) =>
              settledSessionHistoryPatch(state, activeSessionId, messages, settled.history)
            );
            return;
          }
          const activeRun = history.runs.find((run) => run.id === activeRunId);
          if (!apiClient.listActiveRuns && activeRun?.status === "running") {
            set((current) => ({
              messages,
              ...activeRunRecoveryPatch(
                current,
                {
                  run: activeRun,
                  toolCalls: history.toolCalls.filter((toolCall) => toolCall.runId === activeRunId)
                },
                history,
                "recoverActiveRunSnapshot.legacy"
              )
            }));
            return;
          }
          if (!activeRun || activeRun.status !== "running" || apiClient.listActiveRuns) {
            logRecoveredFailedRuns(
              activeSessionId,
              settled.history.runs,
              "recoverActiveRunSnapshot.settled"
            );
            set((state) =>
              settledSessionHistoryPatch(state, activeSessionId, messages, settled.history)
            );
            return;
          }
        } catch (error) {
          console.warn("[store] 活跃运行状态恢复失败", {
            error: error instanceof Error ? error.message : String(error)
          });
        }
      },

      async saveProvider(input) {
        if (!apiClient) {
          return;
        }
        const saved = await apiClient.saveProvider(input);
        await get().refresh();
        if (isConfiguredProvider(saved)) {
          set({
            providerId: saved.id,
            model: saved.model,
            reasoningMode: saved.reasoningMode,
            notice: undefined,
            onboardingOpen: false
          });
        }
      },

      async deleteProvider(id) {
        if (!apiClient) {
          return;
        }
        const ok = await apiClient.deleteProvider(id);
        if (!ok) {
          return;
        }
        await get().refresh();
        const stillConfigured = firstConfiguredProvider(get().providers);
        set((state) => {
          const nextProvider =
            state.providerId === id
              ? stillConfigured
              : configuredProviderById(state.providers, state.providerId);
          const modelState = nextProvider
            ? normalizeModelForProvider(
                nextProvider,
                state.model,
                state.reasoningMode,
                "deleteProvider"
              )
            : { model: undefined, reasoningMode: undefined };
          return {
            providerId: nextProvider?.id,
            ...modelState
          };
        });
      },

      async testProvider(id) {
        await apiClient?.testProvider(id);
      },

      async loadFeishuConfig() {
        if (!apiClient) {
          return;
        }
        try {
          const [config, status] = await Promise.all([
            apiClient.getFeishuConfig(),
            apiClient.getFeishuStatus()
          ]);
          set({ feishuConfig: config, feishuStatus: status });
        } catch (error) {
          console.warn("加载飞书配置失败", error);
        }
      },

      async saveFeishuConfig(input) {
        if (!apiClient) {
          return;
        }
        // Feedback is inline in the settings section — the global notice bar
        // only renders on the home/chat views.
        const { config, status } = await apiClient.saveFeishuConfig(input);
        set({ feishuConfig: config, feishuStatus: status });
      },

      async refreshFeishuStatus() {
        if (!apiClient) {
          return;
        }
        try {
          set({ feishuStatus: await apiClient.getFeishuStatus() });
        } catch {
          // Transient polling failure — keep the last known status.
        }
      },

      async loadWebSearchConfig() {
        if (!apiClient?.getWebSearchConfig) {
          return;
        }
        try {
          set({ webSearchConfig: await apiClient.getWebSearchConfig() });
        } catch (error) {
          console.warn("[store] 加载网络搜索配置失败", error);
        }
      },

      async saveWebSearchConfig(input) {
        if (!apiClient?.saveWebSearchConfig) {
          return;
        }
        console.info("[store] 保存网络搜索配置", {
          enabled: input.enabled,
          hasApiKey: Boolean(input.apiKey?.trim())
        });
        const config = await apiClient.saveWebSearchConfig(input);
        set({ webSearchConfig: config });
      },

      async testWebSearchConfig() {
        if (!apiClient?.testWebSearchConfig) {
          return;
        }
        console.info("[store] 测试网络搜索配置");
        await apiClient.testWebSearchConfig();
      },

      async loadTasks() {
        if (!apiClient) {
          return;
        }
        try {
          set({ tasks: await apiClient.listTasks() });
        } catch (error) {
          console.warn("加载定时任务失败", error);
        }
      },

      async updateTask(id, input) {
        if (!apiClient) {
          return;
        }
        const task = await apiClient.updateTask(id, input);
        set((state) => ({
          tasks: state.tasks.map((item) => (item.id === id ? task : item))
        }));
      },

      async deleteTask(id) {
        if (!apiClient) {
          return;
        }
        const ok = await apiClient.deleteTask(id);
        if (!ok) {
          return;
        }
        set((state) => ({ tasks: state.tasks.filter((item) => item.id !== id) }));
      },

      async runTaskNow(id) {
        if (!apiClient) {
          return;
        }
        await apiClient.runTaskNow(id);
        // 执行是异步的，立刻重拉一次拿到 lastRunAt 的推进；
        // 终态由任务页的轮询带回。
        await get().loadTasks();
      },

      async loadSkills() {
        if (!apiClient?.listSkills) {
          return;
        }
        try {
          set({ skills: await apiClient.listSkills() });
        } catch (error) {
          console.warn("[store] 加载技能列表失败", error);
        }
      },

      async getSkillDetail(name) {
        if (!apiClient?.getSkillDetail) {
          return undefined;
        }
        try {
          return await apiClient.getSkillDetail(name);
        } catch (error) {
          console.warn("[store] 加载技能详情失败", { name, error });
          return undefined;
        }
      },

      async setSkillEnabled(name, enabled) {
        if (!apiClient?.setMarketSkillEnabled) {
          return;
        }
        console.info("[store] 切换市场技能", { name, enabled });
        const skills = await apiClient.setMarketSkillEnabled(name, enabled);
        set({ skills });
        // 技能即 / 命令：激活集合变化后命令面板需要同步。
        await get().refreshSlashCommands(get().activeProjectId);
      },

      async importSkillFromUrl(url) {
        if (!apiClient?.importSkillFromUrl) {
          return;
        }
        console.info("[store] 经链接导入自定义技能", { url });
        await apiClient.importSkillFromUrl(url);
        await get().loadSkills();
        await get().refreshSlashCommands(get().activeProjectId);
      },

      async createCustomSkill(input) {
        if (!apiClient?.createCustomSkill) {
          return;
        }
        console.info("[store] 创建自定义技能", { name: input.name });
        await apiClient.createCustomSkill(input);
        await get().loadSkills();
        await get().refreshSlashCommands(get().activeProjectId);
      },

      async deleteCustomSkill(name) {
        if (!apiClient?.deleteCustomSkill) {
          return;
        }
        console.info("[store] 删除自定义技能", { name });
        const ok = await apiClient.deleteCustomSkill(name);
        if (!ok) {
          return;
        }
        set((state) => ({
          skills: state.skills.filter(
            (skill) => !(skill.source === "custom" && skill.name === name)
          )
        }));
        await get().refreshSlashCommands(get().activeProjectId);
      },

      clearRunState() {
        set({
          isRunning: false,
          streamText: "",
          thinking: "",
          thinkingStartedAt: undefined,
          events: [],
          toolActivity: undefined,
          runningTool: undefined,
          pendingTool: undefined,
          activeRunId: undefined,
          activeRunClientRequestId: undefined,
          progressPanelOpen: false,
          progressPanelAutoOpenedRunId: undefined,
          activeRunModel: undefined,
          activeRunLastAssistant: undefined
        });
      }
    }),
    {
      name: "chengxiaobang.app",
      storage: createJSONStorage(() => localStorage),
      version: 4,
      partialize: (state) => ({
        view: state.view,
        activeSessionId: state.view === "home" ? undefined : state.activeSessionId,
        activeProjectId: state.activeProjectId,
        providerId: state.providerId,
        model: state.model,
        reasoningMode: state.reasoningMode,
        planMode: state.view === "home" ? false : state.planMode,
        accessMode: state.accessMode,
        sidebarOpen: state.sidebarOpen,
        rightPanelOpen: state.rightPanelOpen,
        rightPanelMode: state.rightPanelMode,
        rightPanelWidth: state.rightPanelWidth,
        rightPanelBySession: state.rightPanelBySession,
        theme: state.theme,
        locale: state.locale
      }),
      migrate: (persisted, version) => {
        if (version === 1 && persisted) {
          // v1 had no rightPanelOpen: a non-null mode meant "panel visible".
          const previous = persisted as Partial<AppState>;
          return migrateRightPanelMemory(sanitizePersistedAppState({
            ...previous,
            rightPanelOpen: previous.rightPanelMode != null
          }));
        }
        if (version === 2 && persisted) {
          return migrateRightPanelMemory(
            sanitizePersistedAppState(persisted as Partial<AppState>)
          );
        }
        if (version < 1 || !persisted) {
          // Migrate from the previous per-key localStorage layout.
          const read = (key: string) => localStorage.getItem(key) ?? undefined;
          return {
            activeSessionId: read("chengxiaobang.activeSessionId"),
            activeProjectId: read("chengxiaobang.activeProjectId"),
            providerId: read("chengxiaobang.activeProviderId"),
            accessMode:
              read("chengxiaobang.accessMode") === "full_access"
                ? "full_access"
                : read("chengxiaobang.accessMode") === "smart_approval"
                  ? "smart_approval"
                  : "approval",
            theme: "system",
            locale: DEFAULT_LOCALE
          } satisfies Partial<AppState>;
        }
        return migrateRightPanelMemory(sanitizePersistedAppState(persisted as Partial<AppState>));
      },
      merge: (persisted, current) => ({
        ...current,
        ...migrateRightPanelMemory(sanitizePersistedAppState((persisted ?? {}) as Partial<AppState>))
      })
    }
  )
);

/** The shared ApiClient for components that talk to the backend outside the global run state. */
export function getApiClient(): ApiClient | undefined {
  return apiClient;
}

/** Reset the singleton store (used by tests). */
export function resetAppStore(): void {
  apiClient = undefined;
  useAppStore.setState({ ...initialState });
}

// store 是全局单例：dev 下若被部分热更，新组件会接到旧 store 实例上（拿不到新
// 增的 action，点击静默失效）。改动本模块时直接整页刷新，杜绝新旧实例错位。
if (import.meta.hot) {
  import.meta.hot.accept(() => {
    console.info("[store] 模块热更，强制整页刷新以避免 store 双实例");
    import.meta.hot?.invalidate();
  });
}

// ---- Derived selectors ----

export function selectActiveSession(state: AppState): Session | undefined {
  return state.sessions.find((session) => session.id === state.activeSessionId);
}

export function selectActiveProject(state: AppState): Project | undefined {
  const activeSession = selectActiveSession(state);
  if (activeSession?.projectId === null) {
    return undefined;
  }
  const projectId = activeSession?.projectId ?? state.activeProjectId;
  return state.projects.find((project) => project.id === projectId);
}
