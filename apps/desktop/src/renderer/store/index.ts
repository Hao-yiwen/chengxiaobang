import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type {
  AccessMode,
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
import i18n, { DEFAULT_LOCALE, type Locale } from "../i18n";

export type Theme = "light" | "dark" | "system";
export type View = "home" | "chat" | "settings";

export interface Attachment {
  path: string;
  name: string;
  size: number;
  text: string;
}

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
  onboardingOpen: boolean;
  notice?: string;
  // run (transient)
  input: string;
  attachments: Attachment[];
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

  // actions
  initClient(injected?: ApiClient): Promise<void>;
  loadData(): Promise<
    { projects: Project[]; sessions: Session[]; providers: ProviderConfig[] } | undefined
  >;
  refresh(): Promise<void>;
  refreshSlashCommands(projectId?: string): Promise<void>;
  restoreInitialState(): Promise<void>;
  loadSessionDetail(id: string): Promise<void>;
  selectSession(id: string): Promise<void>;
  renameSession(id: string, title: string): Promise<void>;
  deleteSession(id: string): Promise<void>;
  newChat(): void;
  openFolder(): Promise<void>;
  addContext(): Promise<void>;
  removeAttachment(path: string): void;
  submit(): Promise<void>;
  abortRun(): Promise<void>;
  approve(toolCallId: string, approved: boolean): void;
  saveProvider(input: ProviderInput): Promise<void>;
  deleteProvider(id: string): Promise<void>;
  testProvider(id: string): Promise<void>;
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
  streamText: "",
  thinking: "",
  thinkingStartedAt: undefined as number | undefined,
  events: [] as StreamEvent[],
  pendingTool: undefined as ToolCall | undefined,
  isRunning: false,
  activeRunId: undefined as string | undefined,
  lastUsage: undefined as TokenUsage | undefined,
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

      async restoreInitialState() {
        const data = await get().loadData();
        if (!data) {
          return;
        }
        const configuredProvider = firstConfiguredProvider(data.providers);
        if (!configuredProvider) {
          // Land on the home/input page and invite a quick API-key setup via a
          // lightweight modal instead of forcing the user into full settings.
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

      newChat() {
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
        const selectedProvider =
          state.providers.find((provider) => provider.id === state.providerId) ??
          firstConfiguredProvider(state.providers);
        if (!isConfiguredProvider(selectedProvider)) {
          // No model configured yet — prompt a quick setup instead of navigating away.
          set({ onboardingOpen: true });
          return;
        }
        if (selectedProvider.id !== state.providerId) {
          set({ providerId: selectedProvider.id });
        }
        set({ isRunning: true });
        get().clearRunState();
        const { attachments, input, activeSessionId, accessMode } = state;
        const providerId = selectedProvider.id;
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
        const prompt = contextBlock + input;
        const activeProject = selectActiveProject(get());
        set({ input: "", attachments: [], view: "chat" });
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
          set((current) => ({
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
