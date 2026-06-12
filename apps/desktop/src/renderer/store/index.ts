import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { createId } from "@chengxiaobang/shared";
import type {
  AccessMode,
  ApprovalDecision,
  FeishuConfig,
  FeishuConfigInput,
  FeishuStatus,
  Message,
  Project,
  ProjectFileEntry,
  ProviderConfig,
  ProviderInput,
  ReasoningMode,
  ScheduledTask,
  ScheduledTaskUpdate,
  Session,
  SlashCommand,
  StreamEvent,
  TokenUsage,
  ToolCall
} from "@chengxiaobang/shared";
import type { ArtifactKind } from "../lib/artifact";
import { createApiClient, type ApiClient } from "../lib/api";
import { downloadTextFile } from "../lib/download";
import { buildSessionMarkdown, exportFilename } from "../lib/session-export";
import i18n, { DEFAULT_LOCALE, type Locale } from "../i18n";

export type Theme = "light" | "dark" | "system";
export type View = "home" | "chat" | "settings" | "tasks";
export type RightPanelMode = "changes" | "terminal" | "browser" | "files" | "chat";

export interface Attachment {
  path: string;
  name: string;
  size: number;
  text: string;
}

/** One command run from the terminal panel; output is absent while running. */
export interface TerminalEntry {
  id: string;
  command: string;
  output?: string;
  exitCode?: number;
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

const RIGHT_PANEL_MIN_WIDTH = 300;
const RIGHT_PANEL_MAX_WIDTH = 720;
/** File preview widens the panel to at least this, like an editor pane. */
const RIGHT_PANEL_FILE_WIDTH = 480;

// The ApiClient is not serializable, so it lives outside the persisted store.
let apiClient: ApiClient | undefined;

interface AppState {
  // data
  projects: Project[];
  sessions: Session[];
  messages: Message[];
  toolHistory: ToolCall[];
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
  // run (transient)
  input: string;
  attachments: Attachment[];
  /** Project file suggestions for the composer's @-mention menu. */
  fileSuggestions: string[];
  streamText: string;
  thinking: string;
  // When the current turn's reasoning stream began (epoch ms), for the live timer.
  // Completed reasoning is persisted on the message (message.reasoning) instead.
  thinkingStartedAt?: number;
  events: StreamEvent[];
  pendingTool?: ToolCall;
  isRunning: boolean;
  activeRunId?: string;
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
  // scheduled tasks (transient; loaded when the tasks view opens)
  tasks: ScheduledTask[];
  // theme (persisted)
  theme: Theme;
  // language (persisted)
  locale: Locale;
  // readiness
  clientReady: boolean;

  // setters
  setView(view: View): void;
  setInput(input: string): void;
  setPaletteOpen(open: boolean): void;
  setOnboardingOpen(open: boolean): void;
  setNotice(notice: string | undefined): void;
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
  addContext(): Promise<void>;
  removeAttachment(path: string): void;
  submit(): Promise<void>;
  /** Runs an already-assembled prompt in the active session (used by submit/regenerate/edit). */
  runPrompt(prompt: string): Promise<void>;
  /** Rewinds to the last user message and re-runs it. */
  regenerateLast(): Promise<void>;
  /** Rewinds to the given user message and re-runs it with edited content. */
  editAndResend(messageId: string, content: string): Promise<void>;
  abortRun(): Promise<void>;
  approve(toolCallId: string, decision: ApprovalDecision | boolean): void;
  saveProvider(input: ProviderInput): Promise<void>;
  deleteProvider(id: string): Promise<void>;
  testProvider(id: string): Promise<void>;
  loadFeishuConfig(): Promise<void>;
  saveFeishuConfig(input: FeishuConfigInput): Promise<void>;
  refreshFeishuStatus(): Promise<void>;
  loadTasks(): Promise<void>;
  updateTask(id: string, input: ScheduledTaskUpdate): Promise<void>;
  deleteTask(id: string): Promise<void>;
  /** 立即触发一次执行（后端异步跑），随后重拉任务列表带回状态。 */
  runTaskNow(id: string): Promise<void>;
  clearRunState(): void;
}

const initialState = {
  projects: [] as Project[],
  sessions: [] as Session[],
  messages: [] as Message[],
  toolHistory: [] as ToolCall[],
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
  input: "",
  attachments: [] as Attachment[],
  fileSuggestions: [] as string[],
  streamText: "",
  thinking: "",
  thinkingStartedAt: undefined as number | undefined,
  events: [] as StreamEvent[],
  pendingTool: undefined as ToolCall | undefined,
  isRunning: false,
  activeRunId: undefined as string | undefined,
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
  tasks: [] as ScheduledTask[],
  theme: "system" as Theme,
  locale: DEFAULT_LOCALE as Locale,
  clientReady: false
};

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

function isConfiguredProvider(provider: ProviderConfig | undefined): provider is ProviderConfig {
  return Boolean(provider?.apiKeyRef);
}

function firstConfiguredProvider(providers: ProviderConfig[]): ProviderConfig | undefined {
  return providers.find(isConfiguredProvider);
}

function sanitizePersistedAppState(state: Partial<AppState>): Partial<AppState> {
  if (state.view !== "home") {
    return state;
  }
  return {
    ...state,
    activeSessionId: undefined,
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
  if (!state.rightPanelOpen && !state.rightPanelMode && !state.browserUrl && !state.previewFile) {
    return { ...state, rightPanelBySession };
  }
  return {
    ...state,
    rightPanelBySession: {
      ...rightPanelBySession,
      [activeSessionId]: {
        open: Boolean(state.rightPanelOpen),
        mode: state.rightPanelMode ?? null,
        width: state.rightPanelWidth ?? initialState.rightPanelWidth,
        browserUrl: state.browserUrl ?? "",
        ...(state.previewFile ? { previewFile: state.previewFile } : {})
      }
    }
  };
}

type RightPanelPatch = Partial<
  Pick<AppState, "rightPanelOpen" | "rightPanelMode" | "rightPanelWidth" | "previewFile" | "browserUrl">
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
    mode: patch.rightPanelMode ?? state.rightPanelMode,
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

function restoredRightPanel(
  state: AppState,
  sessionId: string | undefined
): Pick<AppState, "rightPanelOpen" | "rightPanelMode" | "rightPanelWidth" | "previewFile" | "browserUrl"> {
  const snapshot = sessionId ? state.rightPanelBySession[sessionId] : undefined;
  if (!snapshot) {
    console.debug("[store] 目标会话没有右侧面板记忆，默认关闭", { sessionId });
    return {
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

/** The provider a run would use: the selected one if configured, else the first configured. */
export function resolveRunProvider(state: AppState): ProviderConfig | undefined {
  const selected =
    state.providers.find((provider) => provider.id === state.providerId) ??
    firstConfiguredProvider(state.providers);
  return isConfiguredProvider(selected) ? selected : undefined;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      ...initialState,

      setView: (view) => set({ view }),
      setInput: (input) => set({ input }),
      setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
      setOnboardingOpen: (onboardingOpen) => set({ onboardingOpen }),
      setNotice: (notice) => set({ notice }),
      setProviderId: (providerId) => set({ providerId }),
      setModel: (model) => set({ model }),
      setReasoningMode: (reasoningMode) => set({ reasoningMode }),
      setPlanMode: (planMode) => set({ planMode }),
      setAccessMode: (accessMode) => set({ accessMode }),
      setActiveProjectId: (activeProjectId) => {
        set((state) => ({
          rightPanelBySession: rememberRightPanel(state),
          activeProjectId,
          activeSessionId: undefined,
          messages: [],
          toolHistory: [],
          streamText: "",
          thinking: "",
          thinkingStartedAt: undefined,
          events: [],
          pendingTool: undefined,
          activeRunId: undefined,
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
        const absolute = resolveProjectPath(state, path);
        console.info("[store] 打开文件预览", {
          path,
          absolute,
          projectPath: project?.path,
          sessionId
        });
        set((state) => {
          const patch: RightPanelPatch = {
            previewFile: {
              path: absolute,
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
          return {
            projects: nextProjects,
            sessions: nextSessions,
            providers: nextProviders,
            rightPanelBySession: Object.fromEntries(
              Object.entries(state.rightPanelBySession).filter(([sessionId]) =>
                liveSessionIds.has(sessionId)
              )
            ),
            activeSessionId,
            providerId:
              state.providerId &&
              isConfiguredProvider(nextProviders.find((p) => p.id === state.providerId))
                ? state.providerId
                : configuredProvider?.id,
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
          set({
            activeSessionId: undefined,
            providerId: undefined,
            messages: [],
            toolHistory: [],
            view: "home",
            rightPanelOpen: false,
            rightPanelMode: null,
            previewFile: undefined,
            browserUrl: "",
            onboardingOpen: true
          });
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
          set({
            activeSessionId: undefined,
            messages: [],
            toolHistory: [],
            rightPanelOpen: false,
            rightPanelMode: null,
            previewFile: undefined,
            browserUrl: "",
            view: "home"
          });
          await get().refreshSlashCommands();
          return;
        }
        if (!targetSession) {
          if (storedSessionId) {
            console.warn("[store] 持久化会话已不存在，回到首页", { storedSessionId });
          } else {
            console.debug("[store] 没有持久化会话，停留首页", { restoredView });
          }
          set({
            activeSessionId: undefined,
            messages: [],
            toolHistory: [],
            rightPanelOpen: false,
            rightPanelMode: null,
            previewFile: undefined,
            browserUrl: "",
            view: "home"
          });
          await get().refreshSlashCommands();
          return;
        }
        console.debug("[store] 恢复启动会话", {
          sessionId: targetSession.id,
          restoredView,
          source: storedSession ? "持久化" : "最新会话"
        });
        set((state) => ({
          activeSessionId: targetSession.id,
          activeProjectId: targetSession.projectId ?? undefined,
          accessMode: targetSession.accessMode,
          ...restoredRightPanel(state, targetSession.id),
          providerId:
            targetSession.providerId &&
            isConfiguredProvider(data.providers.find((p) => p.id === targetSession.providerId))
              ? targetSession.providerId
              : state.providerId &&
                  isConfiguredProvider(data.providers.find((p) => p.id === state.providerId))
                ? state.providerId
                : configuredProvider.id
        }));
        await get().refreshSlashCommands();
        // 预加载活跃会话让对话视图就绪，但保留用户离开时所在的视图。
        await get().loadSessionDetail(targetSession.id, restoredView);
      },

      async loadSessionDetail(id, view = "chat") {
        if (!apiClient) {
          return;
        }
        const [messages, history] = await Promise.all([
          apiClient.listMessages(id),
          apiClient.listSessionRuns(id)
        ]);
        set({ messages, toolHistory: history.toolCalls, view });
      },

      async selectSession(id) {
        if (!apiClient) {
          return;
        }
        const session = get().sessions.find((item) => item.id === id);
        set((state) => {
          const rightPanelBySession = rememberRightPanel(state);
          return {
            rightPanelBySession,
            activeSessionId: id,
            activeProjectId: session?.projectId ?? undefined,
            providerId: session?.providerId ?? state.providerId,
            accessMode: session ? session.accessMode : state.accessMode,
            ...restoredRightPanel({ ...state, rightPanelBySession }, id)
          };
        });
        get().clearRunState();
        await get().refreshSlashCommands(session?.projectId ?? undefined);
        await get().loadSessionDetail(id);
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
          if (state.activeSessionId === id) {
            return {
              sessions,
              rightPanelBySession,
              activeSessionId: undefined,
              messages: [],
              toolHistory: [],
              rightPanelOpen: false,
              rightPanelMode: null,
              previewFile: undefined,
              browserUrl: "",
              view: "home" as View
            };
          }
          return { sessions, rightPanelBySession };
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
          const activeGone =
            state.activeProjectId === id ||
            (state.activeSessionId &&
              !sessions.some((session) => session.id === state.activeSessionId));
          if (activeGone) {
            return {
              projects,
              sessions,
              rightPanelBySession,
              activeProjectId: undefined,
              activeSessionId: undefined,
              messages: [],
              toolHistory: [],
              rightPanelOpen: false,
              rightPanelMode: null,
              previewFile: undefined,
              browserUrl: "",
              view: "home" as View
            };
          }
          return { projects, sessions, rightPanelBySession };
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
          activeProjectId: undefined,
          activeSessionId: undefined,
          messages: [],
          toolHistory: [],
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
          activeProjectId: projectId,
          activeSessionId: undefined,
          messages: [],
          toolHistory: [],
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
        set((state) => ({
          rightPanelBySession: rememberRightPanel(state),
          activeProjectId: project.id,
          activeSessionId: undefined,
          messages: [],
          toolHistory: [],
          rightPanelOpen: false,
          rightPanelMode: null,
          previewFile: undefined,
          browserUrl: "",
          notice: undefined,
          view: "home"
        }));
        await get().refreshSlashCommands(project.id);
      },

      async addContext() {
        if (!window.chengxiaobang?.pickFiles || !window.chengxiaobang?.readFileText) {
          set({ notice: i18n.t("notice.addContextDesktopOnly") });
          return;
        }
        const paths = (await window.chengxiaobang.pickFiles()) ?? [];
        for (const path of paths) {
          if (get().attachments.some((attachment) => attachment.path === path)) {
            continue;
          }
          const result = await window.chengxiaobang.readFileText(path);
          if (result?.ok) {
            set((state) => ({
              attachments: [
                ...state.attachments,
                { path, name: result.name, size: result.size, text: result.text }
              ]
            }));
          } else if (result) {
            console.warn(i18n.t("notice.skipFile", { name: result.name, error: result.error }));
          }
        }
      },

      removeAttachment(path) {
        set((state) => ({
          attachments: state.attachments.filter((attachment) => attachment.path !== path)
        }));
      },

      async submit() {
        const state = get();
        if (!apiClient || state.input.trim().length === 0) {
          return;
        }
        if (state.isRunning && state.pendingTool?.name === "ask_user") {
          const answer = state.input.trim();
          console.info(`[store] 将输入框内容作为 ask_user 回答 toolCallId=${state.pendingTool.id}`);
          get().approve(state.pendingTool.id, { approved: true, answer: { text: answer } });
          set({ input: "" });
          return;
        }
        if (!resolveRunProvider(state)) {
          // No model configured yet — prompt a quick setup; keep the typed input.
          set({ onboardingOpen: true });
          return;
        }
        const { attachments, input } = state;
        const contextBlock =
          attachments.length > 0
            ? attachments
                .map(
                  (attachment) =>
                    i18n.t("notice.attachmentBlock", {
                      name: attachment.name,
                      text: attachment.text
                    })
                )
                .join("\n") + "\n"
            : "";
        set({ input: "", attachments: [] });
        await get().runPrompt(contextBlock + input);
      },

      async regenerateLast() {
        const state = get();
        if (!apiClient || state.isRunning || !state.activeSessionId) {
          return;
        }
        const lastUser = [...state.messages].reverse().find((item) => item.role === "user");
        if (!lastUser) {
          return;
        }
        await apiClient.rewindSession(state.activeSessionId, lastUser.id);
        await get().loadSessionDetail(state.activeSessionId);
        await get().runPrompt(lastUser.content);
      },

      async editAndResend(messageId, content) {
        const state = get();
        if (
          !apiClient ||
          state.isRunning ||
          !state.activeSessionId ||
          content.trim().length === 0
        ) {
          return;
        }
        await apiClient.rewindSession(state.activeSessionId, messageId);
        await get().loadSessionDetail(state.activeSessionId);
        await get().runPrompt(content);
      },

      async runPrompt(prompt) {
        const state = get();
        if (!apiClient || prompt.trim().length === 0) {
          return;
        }
        const selectedProvider = resolveRunProvider(state);
        if (!selectedProvider) {
          set({ onboardingOpen: true });
          return;
        }
        if (selectedProvider.id !== state.providerId) {
          set({ providerId: selectedProvider.id });
        }
        set({ isRunning: true });
        get().clearRunState();
        const { activeSessionId, accessMode, planMode, model, reasoningMode } = state;
        const providerId = selectedProvider.id;
        const activeProject = selectActiveProject(get());
        set({ view: "chat" });
        let runSessionId = activeSessionId;
        let lastAssistantMessage: Message | undefined;
        let runModel:
          | { providerId?: string; model: string; reasoningMode?: ReasoningMode }
          | undefined;
        try {
          await apiClient.streamRun(
            {
              sessionId: activeSessionId,
              projectId: activeProject?.id ?? null,
              prompt,
              providerId,
              accessMode,
              planMode,
              ...(model ? { model } : {}),
              ...(reasoningMode ? { reasoningMode } : {})
            },
            (event) => {
              set((current) => ({ events: [...current.events, event] }));
              switch (event.type) {
                case "run_started":
                  runSessionId = event.sessionId;
                  runModel = event.model
                    ? {
                        providerId: event.providerId,
                        model: event.model,
                        reasoningMode: event.reasoningMode
                      }
                    : undefined;
                  set({
                    activeRunId: event.runId,
                    activeSessionId: event.sessionId,
                    view: "chat",
                    ...(runModel ? { lastRunModel: runModel } : {})
                  });
                  break;
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
                case "message":
                  // A run may deliver several messages (the user echo, interim
                  // assistant narration between tool calls, the final answer).
                  // Assistant messages carry their persisted reasoning, so just
                  // flush the live buffers — the run stays active until run_end.
                  set((current) => ({
                    messages: appendMessage(current.messages, event.message),
                    ...(event.message.role === "assistant"
                      ? { streamText: "", thinking: "", thinkingStartedAt: undefined }
                      : {})
                  }));
                  if (event.message.role === "assistant") {
                    lastAssistantMessage = event.message;
                  }
                  break;
                case "tool_call":
                  // The status field carries the state machine: pending_approval
                  // shows the approval card; any later transition clears it.
                  if (event.toolCall.status === "pending_approval") {
                    set({ pendingTool: event.toolCall });
                  } else {
                    set((current) => ({
                      pendingTool: undefined,
                      toolHistory: upsertToolCall(current.toolHistory, event.toolCall)
                    }));
                  }
                  break;
                case "session_updated":
                  // The AI-generated title lands mid-run — update the sidebar
                  // immediately instead of waiting for the post-run refresh.
                  set((current) => ({
                    sessions: upsertSession(current.sessions, event.session)
                  }));
                  break;
                case "run_end":
                  set((current) => ({
                    activeRunId: undefined,
                    pendingTool: undefined,
                    streamText: "",
                    thinking: "",
                    thinkingStartedAt: undefined,
                    ...(event.status === "completed" ? { lastUsage: event.usage } : {}),
                    ...(event.status === "completed" &&
                    event.usage &&
                    runModel &&
                    lastAssistantMessage?.durationMs !== undefined
                      ? {
                          runMeta: {
                            ...current.runMeta,
                            [lastAssistantMessage.id]: {
                              durationMs: lastAssistantMessage.durationMs,
                              promptTokens: event.usage.promptTokens,
                              completionTokens: event.usage.completionTokens,
                              model: runModel.model,
                              ...(runModel.reasoningMode
                                ? { reasoningMode: runModel.reasoningMode }
                                : {})
                            }
                          }
                        }
                      : {})
                  }));
                  break;
              }
            }
          );
          await get().refresh();
          if (runSessionId && apiClient) {
            await get().loadSessionDetail(runSessionId);
          }
        } catch (error) {
          console.error("[store] 运行流中断:", error);
          set((current) => ({
            pendingTool: undefined,
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
        } finally {
          set({ isRunning: false, activeRunId: undefined });
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
        set((state) => ({
          providerId:
            state.providerId === id ? stillConfigured?.id : state.providerId
        }));
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

      clearRunState() {
        set({
          streamText: "",
          thinking: "",
          thinkingStartedAt: undefined,
          events: [],
          pendingTool: undefined,
          activeRunId: undefined
        });
      }
    }),
    {
      name: "chengxiaobang.app",
      storage: createJSONStorage(() => localStorage),
      version: 3,
      partialize: (state) => ({
        view: state.view,
        activeSessionId: state.view === "home" ? undefined : state.activeSessionId,
        activeProjectId: state.activeProjectId,
        providerId: state.providerId,
        model: state.model,
        reasoningMode: state.reasoningMode,
        planMode: state.planMode,
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
              read("chengxiaobang.accessMode") === "full_access" ? "full_access" : "approval",
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

/** Resolves a tool path (relative to the active project, or already absolute). */
function resolveProjectPath(state: AppState, path: string): string {
  const project = selectActiveProject(state);
  return path.startsWith("/") || !project ? path : `${project.path}/${path}`;
}

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
