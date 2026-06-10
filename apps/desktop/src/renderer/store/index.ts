import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { createId } from "@chengxiaobang/shared";
import type {
  AccessMode,
  FeishuConfig,
  FeishuConfigInput,
  FeishuStatus,
  Message,
  Project,
  ProviderConfig,
  ProviderInput,
  Session,
  SlashCommand,
  StreamEvent,
  TokenUsage,
  ToolCall
} from "@chengxiaobang/shared";
import { createApiClient, type ApiClient } from "../lib/api";
import { downloadTextFile } from "../lib/download";
import { buildSessionMarkdown, exportFilename } from "../lib/session-export";
import i18n, { DEFAULT_LOCALE, type Locale } from "../i18n";

export type Theme = "light" | "dark" | "system";
export type View = "home" | "chat" | "settings";
export type RightPanelMode = "terminal" | "browser" | "files";

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
  // right workspace panel (mode + width persisted, content transient)
  rightPanelMode: RightPanelMode | null;
  rightPanelWidth: number;
  previewFile?: { path: string };
  browserUrl: string;
  terminalEntries: TerminalEntry[];
  terminalRunning: boolean;
  // feishu integration (transient; loaded when the settings section opens)
  feishuConfig?: FeishuConfig;
  feishuStatus?: FeishuStatus;
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
  setAccessMode(mode: AccessMode): void;
  setActiveProjectId(id: string | undefined): void;
  setTheme(theme: Theme): void;
  setLocale(locale: Locale): void;
  toggleRightPanel(mode: RightPanelMode): void;
  setRightPanelWidth(width: number): void;
  setBrowserUrl(url: string): void;
  openFilePreview(path: string): void;
  runTerminalCommand(command: string): Promise<void>;

  // actions
  initClient(injected?: ApiClient): Promise<void>;
  loadData(): Promise<
    { projects: Project[]; sessions: Session[]; providers: ProviderConfig[] } | undefined
  >;
  refresh(): Promise<void>;
  refreshSlashCommands(projectId?: string): Promise<void>;
  loadFileSuggestions(query: string): Promise<void>;
  restoreInitialState(): Promise<void>;
  loadSessionDetail(id: string): Promise<void>;
  selectSession(id: string): Promise<void>;
  renameSession(id: string, title: string): Promise<void>;
  deleteSession(id: string): Promise<void>;
  /** Downloads any session (active or not) as a Markdown document. */
  exportSession(id: string): Promise<void>;
  /** Branches the active session at a message and switches to the new branch. */
  forkSession(messageId: string): Promise<void>;
  /** Deletes a project and everything in it (sessions, messages, runs). */
  deleteProject(id: string): Promise<void>;
  newChat(): void;
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
  approve(toolCallId: string, approved: boolean): void;
  saveProvider(input: ProviderInput): Promise<void>;
  deleteProvider(id: string): Promise<void>;
  testProvider(id: string): Promise<void>;
  loadFeishuConfig(): Promise<void>;
  saveFeishuConfig(input: FeishuConfigInput): Promise<void>;
  refreshFeishuStatus(): Promise<void>;
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
  rightPanelMode: null as RightPanelMode | null,
  rightPanelWidth: 380,
  previewFile: undefined as { path: string } | undefined,
  browserUrl: "",
  terminalEntries: [] as TerminalEntry[],
  terminalRunning: false,
  feishuConfig: undefined as FeishuConfig | undefined,
  feishuStatus: undefined as FeishuStatus | undefined,
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

function isConfiguredProvider(provider: ProviderConfig | undefined): provider is ProviderConfig {
  return Boolean(provider?.apiKeyRef);
}

function firstConfiguredProvider(providers: ProviderConfig[]): ProviderConfig | undefined {
  return providers.find(isConfiguredProvider);
}

/** The provider a run would use: the selected one if configured, else the first configured. */
function resolveRunProvider(state: AppState): ProviderConfig | undefined {
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
      setAccessMode: (accessMode) => set({ accessMode }),
      setActiveProjectId: (activeProjectId) => {
        set({
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
          view: "home"
        });
        void get().refreshSlashCommands(activeProjectId);
      },
      setTheme: (theme) => set({ theme }),
      setLocale: (locale) => set({ locale }),
      toggleRightPanel: (mode) =>
        set((state) => ({ rightPanelMode: state.rightPanelMode === mode ? null : mode })),
      setRightPanelWidth: (width) =>
        set({
          rightPanelWidth: Math.min(
            RIGHT_PANEL_MAX_WIDTH,
            Math.max(RIGHT_PANEL_MIN_WIDTH, Math.round(width))
          )
        }),
      setBrowserUrl: (browserUrl) => set({ browserUrl }),

      openFilePreview(path) {
        const project = selectActiveProject(get());
        const absolute =
          path.startsWith("/") || !project ? path : `${project.path}/${path}`;
        set((state) => ({
          previewFile: { path: absolute },
          rightPanelMode: "files",
          rightPanelWidth: Math.max(state.rightPanelWidth, RIGHT_PANEL_FILE_WIDTH)
        }));
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
        const { activeSessionId } = get();
        const configuredProvider = firstConfiguredProvider(nextProviders);
        set((state) => ({
          projects: nextProjects,
          sessions: nextSessions,
          providers: nextProviders,
          providerId:
            state.providerId &&
            isConfiguredProvider(nextProviders.find((p) => p.id === state.providerId))
              ? state.providerId
              : configuredProvider?.id,
          activeProjectId:
            state.activeProjectId && nextProjects.some((p) => p.id === state.activeProjectId)
              ? state.activeProjectId
              : (nextSessions.find((s) => s.id === activeSessionId)?.projectId ?? undefined)
        }));
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
            onboardingOpen: true
          });
          return;
        }
        const storedSessionId = get().activeSessionId;
        const targetSession =
          data.sessions.find((session) => session.id === storedSessionId) ?? data.sessions[0];
        if (!targetSession) {
          set({ activeSessionId: undefined, messages: [], toolHistory: [], view: "home" });
          await get().refreshSlashCommands();
          return;
        }
        set((state) => ({
          activeSessionId: targetSession.id,
          activeProjectId: targetSession.projectId ?? undefined,
          accessMode: targetSession.accessMode,
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
        await get().loadSessionDetail(targetSession.id);
      },

      async loadSessionDetail(id) {
        if (!apiClient) {
          return;
        }
        const [messages, history] = await Promise.all([
          apiClient.listMessages(id),
          apiClient.listSessionRuns(id)
        ]);
        set({ messages, toolHistory: history.toolCalls, view: "chat" });
      },

      async selectSession(id) {
        if (!apiClient) {
          return;
        }
        const session = get().sessions.find((item) => item.id === id);
        set((state) => ({
          activeSessionId: id,
          activeProjectId: session?.projectId ?? undefined,
          providerId: session?.providerId ?? state.providerId,
          accessMode: session ? session.accessMode : state.accessMode
        }));
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
          if (state.activeSessionId === id) {
            return {
              sessions,
              activeSessionId: undefined,
              messages: [],
              toolHistory: [],
              view: "home" as View
            };
          }
          return { sessions };
        });
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
          const activeGone =
            state.activeProjectId === id ||
            (state.activeSessionId &&
              !sessions.some((session) => session.id === state.activeSessionId));
          if (activeGone) {
            return {
              projects,
              sessions,
              activeProjectId: undefined,
              activeSessionId: undefined,
              messages: [],
              toolHistory: [],
              view: "home" as View
            };
          }
          return { projects, sessions };
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
        set({
          activeProjectId: undefined,
          activeSessionId: undefined,
          messages: [],
          toolHistory: [],
          view: "home"
        });
        void get().refreshSlashCommands();
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
        set({
          activeProjectId: project.id,
          activeSessionId: undefined,
          messages: [],
          toolHistory: [],
          notice: undefined,
          view: "home"
        });
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
        const { activeSessionId, accessMode } = state;
        const providerId = selectedProvider.id;
        const activeProject = selectActiveProject(get());
        set({ view: "chat" });
        let runSessionId = activeSessionId;
        try {
          await apiClient.streamRun(
            {
              sessionId: activeSessionId,
              projectId: activeProject?.id ?? null,
              prompt,
              providerId,
              accessMode
            },
            (event) => {
              set((current) => ({ events: [...current.events, event] }));
              if (event.type === "run_started") {
                runSessionId = event.sessionId;
                set({ activeRunId: event.runId, activeSessionId: event.sessionId, view: "chat" });
              }
              if (event.type === "user_message") {
                set((current) => ({ messages: appendMessage(current.messages, event.message) }));
              }
              if (event.type === "assistant_delta") {
                set((current) => ({ streamText: current.streamText + event.delta }));
              }
              if (event.type === "thinking_delta") {
                set((current) => ({
                  thinking: current.thinking + event.delta,
                  thinkingStartedAt: current.thinkingStartedAt ?? Date.now()
                }));
              }
              if (event.type === "tool_call_pending") {
                set({ pendingTool: event.toolCall });
              }
              if (event.type === "tool_call_started") {
                set({ pendingTool: undefined });
              }
              if (event.type === "tool_result") {
                set((current) => ({
                  pendingTool: undefined,
                  toolHistory: upsertToolCall(current.toolHistory, event.toolCall)
                }));
              }
              if (event.type === "assistant_done") {
                // A run may emit several assistant_done events (interim narration
                // between tool calls). The streamed reasoning is persisted on the
                // message itself (event.message.reasoning), so just flush the live
                // buffers — keep the run active until completion/abort/error.
                set((current) => ({
                  messages: appendMessage(current.messages, event.message),
                  streamText: "",
                  thinking: "",
                  thinkingStartedAt: undefined
                }));
              }
              if (event.type === "run_completed") {
                set({
                  activeRunId: undefined,
                  pendingTool: undefined,
                  lastUsage: event.usage
                });
              }
              if (event.type === "run_aborted" || event.type === "run_error") {
                set({
                  activeRunId: undefined,
                  pendingTool: undefined,
                  streamText: "",
                  thinking: "",
                  thinkingStartedAt: undefined
                });
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
                type: "run_error",
                runId: "local",
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

      approve(toolCallId, approved) {
        void apiClient?.approve(toolCallId, approved);
      },

      async saveProvider(input) {
        if (!apiClient) {
          return;
        }
        const saved = await apiClient.saveProvider(input);
        await get().refresh();
        if (isConfiguredProvider(saved)) {
          set({ providerId: saved.id, notice: undefined, onboardingOpen: false });
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
      version: 1,
      partialize: (state) => ({
        activeSessionId: state.activeSessionId,
        activeProjectId: state.activeProjectId,
        providerId: state.providerId,
        accessMode: state.accessMode,
        rightPanelMode: state.rightPanelMode,
        rightPanelWidth: state.rightPanelWidth,
        theme: state.theme,
        locale: state.locale
      }),
      migrate: (persisted, version) => {
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
        return persisted as Partial<AppState>;
      }
    }
  )
);

/** Reset the singleton store (used by tests). */
export function resetAppStore(): void {
  apiClient = undefined;
  useAppStore.setState({ ...initialState });
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

export function selectHeading(state: AppState): string {
  const project = selectActiveProject(state);
  // Reads `lng` so callers that subscribe to language changes recompute.
  // Without an explicitly selected project/directory, show a neutral prompt
  // instead of pretending we're working inside some project.
  if (!project) {
    return i18n.t("home.headingNoProject", { lng: state.locale });
  }
  return i18n.t("home.heading", { name: project.name, lng: state.locale });
}
