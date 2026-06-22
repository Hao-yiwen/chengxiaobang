import type { StateCreator } from "zustand";
import type {
  AccessMode,
  AppEvent,
  ApprovalDecision,
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
  Message,
  MessageAttachment,
  MessageFeedback,
  PluginConfigValues,
  PluginDetail,
  PluginInstallInput,
  PluginSummary,
  Project,
  ProjectFileEntry,
  ProviderConfig,
  ProviderInput,
  ReasoningMode,
  RunImageAttachment,
  RunRecord,
  ScheduledTask,
  ScheduledTaskEvent,
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
  WebSearchConfigInput,
  WechatConfig,
  WechatStatus
} from "@chengxiaobang/shared";
import type { PreviewKind } from "../../common/file-preview";
import type { OnboardingPrimaryUse, OnboardingProfile } from "../../common/profile";
import type { AttachmentDescriptor } from "../lib/attachment-preparation";
import type { ArtifactKind } from "../lib/artifact";
import type { ApiClient } from "../lib/api";
import type { Locale } from "../i18n";
import type { CodePreviewSettings } from "../lib/code-preview-settings";

export type Theme = "light" | "dark" | "system";
export type View = "home" | "chat" | "settings" | "tasks" | "plugins" | "connectPhone";
export type RightPanelMode = "changes" | "terminal" | "browser" | "files" | "chat";
export type ProjectSortMode = "created" | "recent";
export type OnboardingStep = "welcome" | "profile" | "model";
export type ScheduledTaskFinishedEvent = Extract<ScheduledTaskEvent, { type: "scheduled_task_finished" }>;
export type SessionRunHistory = { runs: RunRecord[]; toolCalls: ToolCall[] };
export type FilePreviewEntrySource = "panel" | "direct" | "project-tree";

export interface ModelSelection {
  providerId?: string;
  model?: string;
  reasoningMode?: ReasoningMode;
}

export interface Attachment extends AttachmentDescriptor {
  path: string;
  name: string;
  size: number;
  kind?: PreviewKind;
  text?: string;
}

export type ComposerDraftScope = string;

export interface ComposerDraft {
  input: string;
  attachments: Attachment[];
}

export interface RunPromptDisplay {
  content?: string;
  attachments?: MessageAttachment[];
}

export interface RunPromptOptions {
  sessionId?: string;
  projectId?: string | null;
  providerId?: string;
  model?: string;
  reasoningMode?: ReasoningMode;
  accessMode?: AccessMode;
  planMode?: boolean;
  source?: string;
  preserveSelection?: boolean;
}

export interface QueuedRunItem {
  id: string;
  sessionId: string;
  projectId?: string | null;
  content: string;
  sourceAttachments: AttachmentDescriptor[];
  displayAttachments: MessageAttachment[];
  providerId: string;
  model?: string;
  reasoningMode?: ReasoningMode;
  accessMode: AccessMode;
  planMode: boolean;
  createdAt: number;
}

/** 右侧终端面板的一次命令运行；运行中暂不带 output。 */
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
  allowCwdFallback?: boolean;
}

/** 右侧面板里的一个 tab。单例工具(changes/browser/files/chat)每种至多一个;terminal 可多开。 */
export interface RightPanelTab {
  id: string;
  kind: RightPanelMode;
  /** tab 标题:终端为 user@host,其余用工具名(由组件按 kind 兜底翻译)。 */
  title?: string;
  /** 仅 terminal:稳定的 PTY id,切 tab 不重建,关 tab 才销毁。 */
  terminalId?: string;
}

export interface RightPanelSessionState {
  open: boolean;
  width: number;
  tabs: RightPanelTab[];
  activeTabId?: string;
  previewFile?: PreviewFileState;
  browserUrl: string;
}

export type LegacyRightPanelMode = RightPanelMode | "progress" | "artifacts";
/** v8 及更早的每会话快照结构(单值 mode),仅用于持久化迁移。 */
export interface LegacyRightPanelSessionState {
  open: boolean;
  mode: LegacyRightPanelMode | null;
  width: number;
  previewFile?: PreviewFileState;
  browserUrl: string;
}

export interface AppState {
  // 数据
  projects: Project[];
  sessions: Session[];
  messages: Message[];
  toolHistory: ToolCall[];
  runHistory: RunRecord[];
  providers: ProviderConfig[];
  slashCommands: SlashCommand[];
  // 选择状态（持久化）
  activeSessionId?: string;
  activeProjectId?: string;
  providerId?: string;
  model?: string;
  reasoningMode?: ReasoningMode;
  homeModelSelection: ModelSelection;
  planMode: boolean;
  accessMode: AccessMode;
  // 界面状态
  view: View;
  paletteOpen: boolean;
  /** 首启引导弹窗：欢迎页、用途画像与模型配置共用同一入口。 */
  onboardingOpen: boolean;
  onboardingCompleted: boolean;
  /** 用户关闭过首启欢迎引导后，不再自动弹出；主动打开模型配置不受影响。 */
  onboardingDismissed: boolean;
  onboardingStep: OnboardingStep;
  onboardingProfile: OnboardingProfile;
  notice?: string;
  notificationToasts: NotificationToast[];
  // 运行态（瞬态）
  input: string;
  attachments: Attachment[];
  composerDraftsByScope: Record<ComposerDraftScope, ComposerDraft>;
  activeComposerDraftScope: ComposerDraftScope;
  /** 输入框 @ 菜单里的项目文件建议。 */
  fileSuggestions: string[];
  streamText: string;
  thinking: string;
  // 当前轮 reasoning 流开始时间（epoch ms），用于实时计时；完成后的 reasoning 会落在 message.reasoning。
  thinkingStartedAt?: number;
  // 当前轮 reasoning 已进入工具/正文阶段但尚未落库时的冻结耗时，避免工具阶段继续累加“思考中”。
  thinkingDurationMs?: number;
  // 当前活跃 run 起点（epoch ms），跨多条中间消息保持到 run_end，用于轮次「已工作」实时计时。
  activeRunStartedAt?: number;
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
  queuedRunsBySession: Record<string, QueuedRunItem[]>;
  pausedRunQueuesBySession: Record<string, true>;
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
  // 左侧边栏（持久化）
  sidebarOpen: boolean;
  projectSortMode: ProjectSortMode;
  // 右侧工作区面板（当前会话状态 + 每会话记忆）
  rightPanelOpen: boolean;
  /** 当前活动 tab 的 kind 镜像;无 tab 时为 null。由 tab 相关 action 同步维护。 */
  rightPanelMode: RightPanelMode | null;
  /** 当前会话已打开的 tab 列表(顺序即展示顺序)。 */
  rightPanelTabs: RightPanelTab[];
  /** 当前活动 tab id。 */
  rightPanelActiveTabId?: string;
  /** 面板是否处于最大化(占满至聊天最小宽);瞬态,不持久化、不跨会话。 */
  rightPanelMaximized: boolean;
  rightPanelWidth: number;
  previewFile?: PreviewFileState;
  filePreviewEntrySource?: FilePreviewEntrySource;
  browserUrl: string;
  rightPanelBySession: Record<string, RightPanelSessionState>;
  terminalEntries: TerminalEntry[];
  terminalRunning: boolean;
  // 飞书集成（瞬态；打开对应设置区时加载）
  feishuConfig?: FeishuConfig;
  feishuStatus?: FeishuStatus;
  wechatConfig?: WechatConfig;
  wechatStatus?: WechatStatus;
  // 网络搜索集成（瞬态；打开对应设置页时加载）
  webSearchConfig?: WebSearchConfig;
  // 定时任务（瞬态；打开任务页时加载）
  tasks: ScheduledTask[];
  // skills（瞬态；打开技能页时加载）
  skills: SkillSummary[];
  /** 一次性信号：从别处（如输入框加号）进入技能页时顺带打开「添加技能」弹窗。 */
  skillsAddRequested: boolean;
  /** 一次性：打开设置时要定位到的分区 id（消费后由 clearPendingSettingsSection 清除）。 */
  pendingSettingsSection?: string;
  // plugins（瞬态；打开插件设置页时加载）
  plugins: PluginSummary[];
  // 主题（持久化）
  theme: Theme;
  // 代码预览（持久化）
  codePreviewSettings: CodePreviewSettings;
  // 语言（持久化）
  locale: Locale;
  // 初始化状态
  clientReady: boolean;

  // 状态设置器
  setView(view: View): void;
  /** 跳到技能页；openAdd 为真时同时请求打开「添加技能」弹窗。 */
  openSkills(openAdd?: boolean): void;
  /** 消费一次性的「添加技能」请求（技能设置页打开弹窗后调用）。 */
  clearSkillsAddRequest(): void;
  clearPendingSettingsSection(): void;
  setInput(input: string): void;
  setPaletteOpen(open: boolean): void;
  setOnboardingOpen(open: boolean): void;
  openOnboarding(step?: OnboardingStep): void;
  setOnboardingStep(step: OnboardingStep): void;
  saveOnboardingProfile(profile: OnboardingProfile): void;
  completeOnboarding(): void;
  setNotice(notice: string | undefined): void;
  dismissNotificationToast(id: string): void;
  setProviderId(id: string | undefined): void;
  setModel(model: string | undefined): void;
  setReasoningMode(reasoningMode: ReasoningMode | undefined): void;
  selectComposerModel(providerId: string, model: string, reasoningMode?: ReasoningMode): Promise<void>;
  setPlanMode(enabled: boolean): void;
  setAccessMode(mode: AccessMode): void;
  setActiveProjectId(id: string | undefined): void;
  setTheme(theme: Theme): void;
  setCodePreviewSettings(patch: Partial<CodePreviewSettings>): void;
  setLocale(locale: Locale): void;
  /** 折叠/展开左侧边栏。 */
  toggleSidebar(): void;
  /** 设置项目区排序方式。 */
  setProjectSortMode(mode: ProjectSortMode): void;
  /** 关闭时打开面板;打开时关闭面板。 */
  toggleRightPanel(): void;
  /** 打开或聚焦对应工具的 tab;传 null 为 no-op(新建入口由顶栏 + 承接)。 */
  openRightPanel(mode: RightPanelMode | null): void;
  closeRightPanel(): void;
  /** 新建一个 tab(终端每次新建,其余单例则聚焦已有)。 */
  newRightPanelTab(kind: RightPanelMode): void;
  /** 关闭指定 tab;终端 tab 关闭时销毁其 PTY。 */
  closeRightPanelTab(tabId: string): void;
  /** 切换当前活动 tab。 */
  setActiveRightPanelTab(tabId: string): void;
  /** 切换面板最大化/还原。 */
  toggleRightPanelMaximized(): void;
  setRightPanelWidth(width: number): void;
  setBrowserUrl(url: string): void;
  openFilePreview(path: string, options?: { source?: FilePreviewEntrySource }): void;
  /** 打开生成物：统一进入右侧文件预览工作台，由预览器按类型处理。 */
  openArtifact(path: string, kind: ArtifactKind): void;
  runTerminalCommand(command: string): Promise<void>;

  // 业务动作
  initClient(injected?: ApiClient): Promise<void>;
  loadData(): Promise<
    { projects: Project[]; sessions: Session[]; providers: ProviderConfig[] } | undefined
  >;
  refresh(): Promise<void>;
  refreshSlashCommands(projectId?: string): Promise<void>;
  loadFileSuggestions(query: string): Promise<void>;
  listProjectDirectory(path?: string): Promise<ProjectFileEntry[]>;
  restoreInitialState(): Promise<void>;
  loadSessionDetail(
    id: string,
    view?: View,
    options?: { settleRunId?: string }
  ): Promise<void>;
  selectSession(id: string): Promise<void>;
  searchSessions(query: string): Promise<SessionSearchResult[]>;
  renameSession(id: string, title: string): Promise<void>;
  /** 置顶/取消置顶会话（侧边栏置顶区）。 */
  setSessionPinned(id: string, pinned: boolean): Promise<void>;
  deleteSession(id: string): Promise<void>;
  /** 将任意会话（无论是否当前打开）导出为 Markdown。 */
  exportSession(id: string): Promise<void>;
  /** 从当前会话的某条消息处分叉，并切换到新分支。 */
  forkSession(messageId: string): Promise<void>;
  /** 更新当前会话内某条助手消息的本地赞踩反馈。 */
  setMessageFeedback(messageId: string, feedback: MessageFeedback | null): Promise<void>;
  /** 重命名项目（不修改磁盘上的文件夹）。 */
  renameProject(id: string, name: string): Promise<void>;
  /** 置顶/取消置顶项目（侧边栏置顶区）。 */
  setProjectPinned(id: string, pinned: boolean): Promise<void>;
  /** 删除项目及其下的会话、消息和运行记录。 */
  deleteProject(id: string): Promise<void>;
  newChat(): void;
  /** 新建一个已绑定指定项目的对话（首页视图，预选项目）。 */
  newChatInProject(projectId: string): void;
  openFolder(): Promise<void>;
  createBlankProject(name: string): Promise<void>;
  addContext(): Promise<void>;
  addDroppedContext(files: File[]): Promise<void>;
  removeAttachment(path: string): void;
  submit(): Promise<void>;
  /** 在当前会话运行已组装好的 prompt（submit / regenerate / edit 共用）。 */
  runPrompt(
    prompt: string,
    attachments?: RunImageAttachment[],
    display?: RunPromptDisplay,
    options?: RunPromptOptions
  ): Promise<void>;
  removeQueuedRun(id: string): void;
  editQueuedRunInComposer(id: string): void;
  clearQueuedRuns(sessionId?: string): void;
  resumeQueuedRuns(sessionId?: string): Promise<void>;
  sendQueuedRunAsSteering(id: string): Promise<void>;
  startNextQueuedRun(sessionId?: string): Promise<void>;
  /** 回退到最后一条用户消息并重新运行。 */
  regenerateLast(): Promise<void>;
  /** 回退到指定用户消息，并用编辑后的内容重新运行。 */
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
  startFeishuInstall(input: FeishuInstallStartInput): Promise<FeishuInstallStartResult>;
  pollFeishuInstall(input: FeishuInstallPollInput): Promise<FeishuInstallPollResult>;
  refreshFeishuStatus(): Promise<void>;
  loadConnectPhoneConfig(): Promise<void>;
  startConnectPhoneInstall(input: ConnectPhoneInstallStartInput): Promise<ConnectPhoneInstallStartResult>;
  pollConnectPhoneInstall(input: ConnectPhoneInstallPollInput): Promise<ConnectPhoneInstallPollResult>;
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
  /** 停用/恢复插件来源技能（kind=skill）；变更后刷新技能与命令清单。 */
  setSkillDisabled(name: string, disabled: boolean): Promise<void>;
  /** 停用/恢复插件来源提示词命令（kind=prompt_template）；变更后刷新命令清单。 */
  setCommandDisabled(name: string, disabled: boolean): Promise<void>;
  /** 拉取插件清单（已安装 + 内置），打开插件设置页时调用。 */
  loadPlugins(): Promise<void>;
  /** 拉取单个插件详情（manifest、资源清单、配置字段与当前值），用于详情弹窗。 */
  getPluginDetail(name: string): Promise<PluginDetail | undefined>;
  /** 安装插件（本地路径或 GitHub 链接）；成功后连锁刷新插件/技能/命令。 */
  installPlugin(input: PluginInstallInput): Promise<void>;
  /** 卸载已安装插件；成功后连锁刷新插件/技能/命令。 */
  uninstallPlugin(name: string): Promise<void>;
  /** 启停插件；成功后连锁刷新插件/技能/命令。 */
  setPluginEnabled(name: string, enabled: boolean): Promise<void>;
  /** 更新插件 userConfig 取值，返回更新后的详情供弹窗即时反映。 */
  setPluginConfig(name: string, values: PluginConfigValues): Promise<PluginDetail | undefined>;
  clearRunState(): void;
}

export type RightPanelPatch = Partial<
  Pick<
    AppState,
    | "rightPanelOpen"
    | "rightPanelMode"
    | "rightPanelTabs"
    | "rightPanelActiveTabId"
    | "rightPanelWidth"
    | "previewFile"
    | "browserUrl"
  >
>;

export type AppStoreSet = Parameters<StateCreator<AppState>>[0];
export type AppStoreGet = Parameters<StateCreator<AppState>>[1];
