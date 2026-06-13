import type {
  AccessMode,
  FeishuConfig,
  FeishuStatus,
  Message,
  ProviderConfig,
  Project,
  ReasoningMode,
  RunRecord,
  ScheduledTask,
  Session,
  SkillSummary,
  SlashCommand,
  StreamEvent,
  TokenUsage,
  ToolActivity,
  ToolCall,
  WebSearchConfig
} from "@chengxiaobang/shared";
import { DEFAULT_LOCALE, type Locale } from "../i18n";
import { DEFAULT_RIGHT_PANEL_WIDTH } from "./helpers/right-panel";
import type {
  AppState,
  Attachment,
  ComposerDraft,
  ComposerDraftScope,
  NotificationToast,
  PreviewFileState,
  QueuedRunItem,
  RightPanelMode,
  RightPanelSessionState,
  TerminalEntry,
  Theme,
  View
} from "./types";

export const initialState =  {
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
  queuedRunsBySession: {} as Record<string, QueuedRunItem[]>,
  pausedRunQueuesBySession: {} as Record<string, true>,
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
  rightPanelWidth: DEFAULT_RIGHT_PANEL_WIDTH,
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
