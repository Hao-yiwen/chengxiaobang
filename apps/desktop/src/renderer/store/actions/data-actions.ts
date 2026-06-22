import { basenameOf } from "../../../common/file-preview";
import type { MessageFeedback } from "@chengxiaobang/shared";
import { createApiClient } from "../../lib/api";
import { downloadTextFile } from "../../lib/download";
import { buildSessionMarkdown, exportFilename } from "../../lib/session-export";
import i18n from "../../i18n";
import { apiClientRef, replaceRunEventSubscription, setApiClient } from "../client";
import type { AppState, AppStoreGet, AppStoreSet, View } from "../types";
import { upsertProject, upsertSession } from "../helpers/collections";
import { resolveContextAttachments } from "../helpers/attachments";
import {
  HOME_COMPOSER_DRAFT_SCOPE,
  dropComposerDraftMemory,
  pruneComposerDraftsByLiveSessions,
  resetHomePlanMode,
  restoredComposerDraftFrom,
  sessionComposerDraftScope,
  switchComposerDraftScope
} from "../helpers/composer-drafts";
import { dropQueuedRunsForSessions, pruneRunQueuesByLiveSessions } from "../helpers/queues";
import {
  configuredProviderById,
  firstConfiguredProvider
} from "../helpers/providers";
import {
  resolveSessionModelSelection,
  restoreHomeModelSelection
} from "../helpers/model-selection";
import {
  activeRunRecoveryPatch,
  logRecoveredFailedRuns,
  settleInterruptedRunHistory,
  settledSessionHistoryPatch
} from "../helpers/run-history";
import { indexSideChatsByMessageId } from "../helpers/side-chats";
import { latestActiveRunSnapshot } from "../helpers/run-records";
import { clearSessionRunning } from "../helpers/running";
import {
  dropRightPanelMemory,
  rememberRightPanel,
  restoredRightPanel,
  selectNewProjectState
} from "../helpers/right-panel";
import { selectActiveProject } from "../selectors";

let fileSuggestionsRequestSeq = 0;

function applyMessageFeedback(
  messages: AppState["messages"],
  messageId: string,
  feedback: MessageFeedback | null
): AppState["messages"] {
  return messages.map((message) => {
    if (message.id !== messageId) {
      return message;
    }
    if (feedback === null) {
      const { feedback: _feedback, ...withoutFeedback } = message;
      return withoutFeedback;
    }
    return { ...message, feedback };
  });
}

export function createDataActions(set: AppStoreSet, get: AppStoreGet): Partial<AppState> {
  return {
      async initClient(injected) {
        // 防 React StrictMode 开发期重复挂载创建两个 client 实例(各自带独立事件流循环);
        // 仅拦截非注入(生产)路径,注入(测试)场景始终允许重新初始化。
        if (!injected && get().clientReady) {
          return;
        }
        const client = injected ?? (await createApiClient());
        setApiClient(client);
        replaceRunEventSubscription(undefined);
        if (client.subscribeAppEvents) {
          replaceRunEventSubscription(client.subscribeAppEvents((event) => get().handleAppEvent(event), {
            onReconnect: () => void get().recoverActiveRunSnapshot(),
            onError: (error: unknown) =>
              console.warn("[store] 全局应用事件流异常", {
                error: error instanceof Error ? error.message : String(error)
              })
          }));
        } else {
          replaceRunEventSubscription(client.subscribeRunEvents?.(
            (event) => get().handleRunEvent(event),
            {
              onReconnect: () => void get().recoverActiveRunSnapshot(),
              onError: (error: unknown) =>
                console.warn("[store] 全局运行事件流异常", {
                  error: error instanceof Error ? error.message : String(error)
                })
            }
          ));
        }
        set({ clientReady: true });
        await get().restoreInitialState();
      },

      async loadData() {
        if (!apiClientRef.current) {
          return undefined;
        }
        const [nextProjects, nextSessions, nextProviders] = await Promise.all([
          apiClientRef.current.listProjects(),
          apiClientRef.current.listSessions(),
          apiClientRef.current.listProviders()
        ]);
        set((state) => {
          const configuredProvider = firstConfiguredProvider(nextProviders);
          const activeSessionId = state.view === "home" ? undefined : state.activeSessionId;
          const liveSessionIds = new Set(nextSessions.map((session) => session.id));
          const activeSession = activeSessionId
            ? nextSessions.find((session) => session.id === activeSessionId)
            : undefined;
          const sessionProvider =
            configuredProviderById(nextProviders, activeSession?.providerId) ??
            (state.view === "home" ? undefined : configuredProviderById(nextProviders, state.providerId)) ??
            (state.view === "home" ? undefined : configuredProvider);
          const modelPatch =
            state.view === "home"
              ? restoreHomeModelSelection(state, nextProviders, "loadData.home")
              : {
                  providerId: sessionProvider?.id,
                  ...resolveSessionModelSelection(activeSession, sessionProvider, "loadData.session")
                };
          return {
            projects: nextProjects,
            sessions: nextSessions,
            providers: nextProviders,
            ...modelPatch,
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
            notificationToasts: state.notificationToasts.filter(
              (toast) => !toast.sessionId || liveSessionIds.has(toast.sessionId)
            ),
            ...pruneRunQueuesByLiveSessions(state, liveSessionIds),
            ...(state.view === "home" ? resetHomePlanMode("loadData.home", state.planMode) : {}),
            rightPanelBySession: Object.fromEntries(
              Object.entries(state.rightPanelBySession).filter(([sessionId]) =>
                liveSessionIds.has(sessionId)
              )
            ),
            composerDraftsByScope: pruneComposerDraftsByLiveSessions(state, liveSessionIds),
            activeSessionId,
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
        if (!apiClientRef.current) {
          return;
        }
        const targetProjectId = projectId ?? selectActiveProject(get())?.id;
        try {
          const { commands } = await apiClientRef.current.listSlashCommands(targetProjectId);
          set({ slashCommands: commands });
        } catch (error) {
          console.warn("加载斜杠命令失败", error);
          set({ slashCommands: [] });
        }
      },

      async loadFileSuggestions(query) {
        const project = selectActiveProject(get());
        if (!apiClientRef.current || !project) {
          fileSuggestionsRequestSeq += 1;
          console.debug("[store] 清空首页 @ 文件建议：缺少 ApiClient 或当前项目", {
            hasClient: Boolean(apiClientRef.current),
            query
          });
          set({ fileSuggestions: [] });
          return;
        }
        const requestSeq = (fileSuggestionsRequestSeq += 1);
        console.debug("[store] 加载首页 @ 文件建议", {
          projectId: project.id,
          query,
          requestSeq
        });
        try {
          const files = await apiClientRef.current.listProjectFiles(project.id, query);
          const currentProjectId = selectActiveProject(get())?.id;
          if (requestSeq !== fileSuggestionsRequestSeq || currentProjectId !== project.id) {
            console.debug("[store] 忽略过期的首页 @ 文件建议", {
              projectId: project.id,
              currentProjectId,
              query,
              requestSeq,
              latestRequestSeq: fileSuggestionsRequestSeq,
              count: files.length
            });
            return;
          }
          console.info("[store] 首页 @ 文件建议加载完成", {
            projectId: project.id,
            query,
            count: files.length
          });
          set({ fileSuggestions: files });
        } catch (error) {
          const currentProjectId = selectActiveProject(get())?.id;
          if (requestSeq !== fileSuggestionsRequestSeq || currentProjectId !== project.id) {
            console.debug("[store] 忽略过期的首页 @ 文件建议错误", {
              projectId: project.id,
              currentProjectId,
              query,
              requestSeq,
              latestRequestSeq: fileSuggestionsRequestSeq,
              error: error instanceof Error ? error.message : String(error)
            });
            return;
          }
          console.warn("[store] 首页 @ 文件建议加载失败", {
            projectId: project.id,
            query,
            error: error instanceof Error ? error.message : String(error)
          });
          set({ fileSuggestions: [] });
        }
      },

      async listProjectDirectory(path = ".") {
        const project = selectActiveProject(get());
        if (!apiClientRef.current || !project) {
          console.warn("[store] 文件树目录读取失败：缺少 ApiClient 或当前项目", {
            hasClient: Boolean(apiClientRef.current),
            path
          });
          return [];
        }
        console.debug("[store] 读取项目文件树目录", { projectId: project.id, path });
        return apiClientRef.current.listProjectDirectory(project.id, path);
      },

      async restoreInitialState() {
        const data = await get().loadData();
        if (!data) {
          return;
        }
        const configuredProvider = firstConfiguredProvider(data.providers);
        const onboardingCompleted = get().onboardingCompleted;
        const onboardingDismissed = get().onboardingDismissed;
        const shouldShowFirstRunOnboarding =
          !configuredProvider && !onboardingCompleted && !onboardingDismissed;
        const firstRunOnboardingPatch = shouldShowFirstRunOnboarding
          ? ({ onboardingOpen: true, onboardingStep: "welcome" } as const)
          : {};
        if (shouldShowFirstRunOnboarding) {
          console.info("[store] 首次启动打开欢迎引导", {
            hasConfiguredProvider: Boolean(configuredProvider)
          });
        } else if (configuredProvider && !onboardingCompleted && !onboardingDismissed) {
          console.info("[store] 跳过首次启动欢迎引导：已有可用模型配置", {
            providerId: configuredProvider.id,
            providerKind: configuredProvider.kind,
            model: configuredProvider.model
          });
        }
        if (!configuredProvider) {
          // 未配置模型时停留首页；首启未完成才展示欢迎，否则等用户发起运行再进入模型配置。
          set((state) => ({
            ...resetHomePlanMode("restoreInitialState.noProvider", get().planMode),
            ...switchComposerDraftScope(
              state,
              HOME_COMPOSER_DRAFT_SCOPE,
              "restoreInitialState.noProvider"
            ),
            activeSessionId: undefined,
            sideChatsByMessageId: {},
            activeSideChatAnchorMessageId: undefined,
            providerId: undefined,
            model: undefined,
            reasoningMode: undefined,
            homeModelSelection: {},
            messages: [],
            toolHistory: [],
            runHistory: [],
            view: "home",
            progressPanelOpen: false,
            rightPanelOpen: false,
            rightPanelMode: null,
            rightPanelTabs: [],
            rightPanelActiveTabId: undefined,
            rightPanelMaximized: false,
            previewFile: undefined,
            filePreviewEntrySource: undefined,
            browserUrl: "",
            onboardingOpen: shouldShowFirstRunOnboarding,
            ...(shouldShowFirstRunOnboarding ? { onboardingStep: "welcome" as const } : {})
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
            ...restoreHomeModelSelection(state, data.providers, "restoreInitialState.home"),
            activeSessionId: undefined,
            sideChatsByMessageId: {},
            activeSideChatAnchorMessageId: undefined,
            messages: [],
            toolHistory: [],
            runHistory: [],
            progressPanelOpen: false,
            rightPanelOpen: false,
            rightPanelMode: null,
            rightPanelTabs: [],
            rightPanelActiveTabId: undefined,
            rightPanelMaximized: false,
            previewFile: undefined,
            filePreviewEntrySource: undefined,
            browserUrl: "",
            view: "home",
            ...firstRunOnboardingPatch
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
            ...restoreHomeModelSelection(
              state,
              data.providers,
              "restoreInitialState.missingSession"
            ),
            activeSessionId: undefined,
            sideChatsByMessageId: {},
            activeSideChatAnchorMessageId: undefined,
            messages: [],
            toolHistory: [],
            runHistory: [],
            progressPanelOpen: false,
            rightPanelOpen: false,
            rightPanelMode: null,
            rightPanelTabs: [],
            rightPanelActiveTabId: undefined,
            rightPanelMaximized: false,
            previewFile: undefined,
            filePreviewEntrySource: undefined,
            browserUrl: "",
            view: "home",
            ...firstRunOnboardingPatch
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
            ? resolveSessionModelSelection(targetSession, sessionProvider, "restoreInitialState")
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
            ...modelState,
            ...firstRunOnboardingPatch
          };
        });
        await get().refreshSlashCommands();
        // 预加载活跃会话让对话视图就绪，但保留用户离开时所在的视图。
        await get().loadSessionDetail(targetSession.id, restoredView);
      },

      async loadSessionDetail(id, view = "chat", options) {
        if (!apiClientRef.current) {
          return;
        }
        const client = apiClientRef.current;
        const [messages, history, activeSnapshots, sideChats] = await Promise.all([
          client.listMessages(id),
          client.listSessionRuns(id),
          client.listActiveRuns ? client.listActiveRuns(id) : Promise.resolve([]),
          client.listSideChats ? client.listSideChats(id) : Promise.resolve([])
        ]);
        console.info("[store] 加载主会话详情及侧边会话摘要", {
          sessionId: id,
          messageCount: messages.length,
          runCount: history.runs.length,
          sideChatCount: sideChats.length
        });
        const sideChatsByMessageId = indexSideChatsByMessageId(sideChats);
        logRecoveredFailedRuns(id, history.runs, "loadSessionDetail");
        const activeSnapshot = latestActiveRunSnapshot(activeSnapshots);
        if (!activeSnapshot) {
          const settled = settleInterruptedRunHistory(id, history, "loadSessionDetail");
          console.debug("[store] 会话详情未发现后端活跃 run", {
            sessionId: id,
            source: "loadSessionDetail",
            interruptedRunIds: settled.interruptedRunIds
          });
          set((state) => ({
            ...settledSessionHistoryPatch(
              state,
              id,
              messages,
              settled.history,
              view,
              options?.settleRunId
            ),
            sideChatsByMessageId
          }));
          return;
        }
        set((state) => ({
          messages,
          view,
          sideChatsByMessageId,
          ...activeRunRecoveryPatch(state, activeSnapshot, history, "loadSessionDetail")
        }));
      },

      async selectSession(id) {
        if (!apiClientRef.current) {
          return;
        }
        const currentState = get();
        if (
          currentState.view === "chat" &&
          currentState.activeSessionId === id &&
          currentState.runningSessionsById[id]
        ) {
          console.debug("[store] 当前运行中会话已选中，跳过重复选择", {
            sessionId: id,
            activeRunId: currentState.activeRunId
          });
          return;
        }
        const session = get().sessions.find((item) => item.id === id);
        set((state) => {
          const shouldRememberRightPanel = state.view === "chat";
          const rightPanelBySession = shouldRememberRightPanel
            ? rememberRightPanel(state)
            : state.rightPanelBySession;
          if (!shouldRememberRightPanel && state.activeSessionId) {
            console.debug("[store] 非聊天页选择会话，跳过当前右侧面板快照保存", {
              fromView: state.view,
              sessionId: state.activeSessionId,
              targetSessionId: id,
              rememberedTabCount: rightPanelBySession[state.activeSessionId]?.tabs.length,
              rememberedPreviewPath: rightPanelBySession[state.activeSessionId]?.previewFile?.path
            });
          }
          const sessionProvider =
            configuredProviderById(state.providers, session?.providerId) ??
            configuredProviderById(state.providers, state.providerId) ??
            firstConfiguredProvider(state.providers);
          const modelState = sessionProvider
            ? resolveSessionModelSelection(session, sessionProvider, "selectSession")
            : { model: undefined, reasoningMode: undefined };
          return {
            rightPanelBySession,
            ...switchComposerDraftScope(state, sessionComposerDraftScope(id), "selectSession"),
            view: "chat",
            activeSessionId: id,
            activeProjectId: session?.projectId ?? undefined,
            sideChatsByMessageId: {},
            activeSideChatAnchorMessageId: undefined,
            providerId: sessionProvider?.id,
            ...modelState,
            accessMode: session ? session.accessMode : state.accessMode,
            ...restoredRightPanel({ ...state, rightPanelBySession }, id)
          };
        });
        get().clearRunState();
        await get().refreshSlashCommands(session?.projectId ?? undefined);
        await get().loadSessionDetail(id);
        await get().markSessionRead(id);
      },

      async markSessionRead(id) {
        const client = apiClientRef.current;
        if (!client?.markSessionRead) {
          console.debug("[store] 跳过标记会话已读：当前 ApiClient 不支持", { sessionId: id });
          return;
        }
        try {
          const updated = await client.markSessionRead(id);
          set((state) => ({
            sessions: upsertSession(state.sessions, updated),
            notificationToasts: state.notificationToasts.filter((toast) => toast.sessionId !== id)
          }));
          console.info("[store] 已标记会话已读并清理通知", {
            sessionId: id,
            lastViewedAt: updated.lastViewedAt,
            clearedNotice: updated.notice === undefined
          });
        } catch (error) {
          console.warn("[store] 标记会话已读失败", {
            sessionId: id,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      },

      async searchSessions(query) {
        const trimmed = query.trim();
        if (!trimmed) {
          return [];
        }
        if (!apiClientRef.current) {
          console.warn("[store] 搜索会话失败：ApiClient 尚未就绪", { query: trimmed });
          return [];
        }
        try {
          if (apiClientRef.current.searchSessions) {
            console.debug("[store] 请求远程会话搜索", { query: trimmed });
            return await apiClientRef.current.searchSessions(trimmed);
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
        if (!apiClientRef.current) {
          return;
        }
        const updated = await apiClientRef.current.updateSession(id, { title });
        set((state) => ({
          sessions: state.sessions.map((session) => (session.id === id ? updated : session))
        }));
      },

      async bindPhoneSessionToFolder(id) {
        const client = apiClientRef.current;
        const session = get().sessions.find((item) => item.id === id);
        if (!client || !session) {
          console.warn("[store] 手机会话绑定文件夹失败：缺少 ApiClient 或会话", {
            sessionId: id,
            hasClient: Boolean(client)
          });
          return;
        }
        if (!session.feishuChatId && !session.wechatChatId) {
          console.warn("[store] 拒绝为普通会话绑定手机文件夹入口", { sessionId: id });
          return;
        }
        if (!window.chengxiaobang?.pickDirectory) {
          set({ notice: i18n.t("notice.openFolderDesktopOnly") });
          return;
        }
        console.info("[store] 手机会话开始选择绑定文件夹", {
          sessionId: id,
          source: session.wechatChatId ? "wechat" : "feishu",
          currentProjectId: session.projectId
        });
        const dir = await window.chengxiaobang.pickDirectory();
        if (!dir) {
          console.debug("[store] 手机会话绑定文件夹已取消", { sessionId: id });
          return;
        }
        try {
          const project = await client.createProject({ path: dir, name: basenameOf(dir) || dir });
          const updated = await client.updateSession(id, { projectId: project.id });
          console.info("[store] 手机会话已绑定文件夹", {
            sessionId: id,
            projectId: project.id,
            path: project.path
          });
          set((state) => ({
            projects: upsertProject(state.projects, project),
            sessions: upsertSession(state.sessions, updated),
            activeProjectId:
              state.activeSessionId === id ? updated.projectId ?? undefined : state.activeProjectId
          }));
          if (get().activeSessionId === id) {
            await get().refreshSlashCommands(project.id);
          }
        } catch (error) {
          console.warn("[store] 手机会话绑定文件夹失败", {
            sessionId: id,
            dir,
            error: error instanceof Error ? error.message : String(error)
          });
          set({ notice: i18n.t("notice.openFolderFailed") });
        }
      },

      async setSessionPinned(id, pinned) {
        if (!apiClientRef.current) {
          return;
        }
        console.debug("[store] 更新会话置顶", { id, pinned });
        // 整体替换返回实体：取消置顶时返回对象不含 pinnedAt，merge 会残留旧值。
        const updated = await apiClientRef.current.updateSession(id, { pinned });
        set((state) => ({
          sessions: state.sessions.map((session) => (session.id === id ? updated : session))
        }));
      },

      async deleteSession(id) {
        if (!apiClientRef.current) {
          return;
        }
        const ok = await apiClientRef.current.deleteSession(id);
        if (!ok) {
          return;
        }
        set((state) => {
          const sessions = state.sessions.filter((session) => session.id !== id);
          const rightPanelBySession = dropRightPanelMemory(state, [id]);
          const composerDraftsByScope = dropComposerDraftMemory(state, [id]);
          const queuePatch = dropQueuedRunsForSessions(state, [id]);
          const { [id]: _runningSession, ...runningSessionsById } = state.runningSessionsById;
          const runningRunSessionById = Object.fromEntries(
            Object.entries(state.runningRunSessionById).filter(([, sessionId]) => sessionId !== id)
          ) as Record<string, string>;
          if (state.activeSessionId === id) {
            return {
              sessions,
              rightPanelBySession,
              ...queuePatch,
              ...restoredComposerDraftFrom(
                composerDraftsByScope,
                HOME_COMPOSER_DRAFT_SCOPE,
                "deleteSession"
              ),
              runningSessionsById,
              runningRunSessionById,
              notificationToasts: state.notificationToasts.filter((toast) => toast.sessionId !== id),
              ...resetHomePlanMode("deleteSession", state.planMode),
              ...restoreHomeModelSelection(state, state.providers, "deleteSession"),
              activeSessionId: undefined,
              sideChatsByMessageId: {},
              activeSideChatAnchorMessageId: undefined,
              messages: [],
              toolHistory: [],
              runHistory: [],
              progressPanelOpen: false,
              rightPanelOpen: false,
              rightPanelMode: null,
              rightPanelTabs: [],
              rightPanelActiveTabId: undefined,
              rightPanelMaximized: false,
              previewFile: undefined,
              filePreviewEntrySource: undefined,
              browserUrl: "",
              view: "home" as View
            };
          }
          return {
            sessions,
            rightPanelBySession,
            composerDraftsByScope,
            ...queuePatch,
            runningSessionsById,
            runningRunSessionById,
            notificationToasts: state.notificationToasts.filter((toast) => toast.sessionId !== id)
          };
        });
      },

      async renameProject(id, name) {
        if (!apiClientRef.current) {
          return;
        }
        console.debug("[store] 重命名项目", { id, name });
        const updated = await apiClientRef.current.renameProject(id, name);
        set((state) => ({
          projects: state.projects.map((project) => (project.id === id ? updated : project))
        }));
      },

      async setProjectPinned(id, pinned) {
        if (!apiClientRef.current) {
          return;
        }
        console.debug("[store] 更新项目置顶", { id, pinned });
        // 整体替换返回实体：取消置顶时返回对象不含 pinnedAt，merge 会残留旧值。
        const updated = await apiClientRef.current.setProjectPinned(id, pinned);
        set((state) => ({
          projects: state.projects.map((project) => (project.id === id ? updated : project))
        }));
      },

      async deleteProject(id) {
        if (!apiClientRef.current) {
          return;
        }
        const ok = await apiClientRef.current.deleteProject(id);
        if (!ok) {
          return;
        }
        set((state) => {
          const projects = state.projects.filter((project) => project.id !== id);
          const sessions = state.sessions.filter((session) => session.projectId !== id);
          const removedSessionIds = state.sessions
            .filter((session) => session.projectId === id)
            .map((session) => session.id);
          const removedSessionIdSet = new Set(removedSessionIds);
          const rightPanelBySession = dropRightPanelMemory(state, removedSessionIds);
          const composerDraftsByScope = dropComposerDraftMemory(state, removedSessionIds);
          const queuePatch = dropQueuedRunsForSessions(state, removedSessionIds);
          const activeGone =
            state.activeProjectId === id ||
            (state.activeSessionId &&
              !sessions.some((session) => session.id === state.activeSessionId));
          if (activeGone) {
            return {
              projects,
              sessions,
              rightPanelBySession,
              notificationToasts: state.notificationToasts.filter(
                (toast) => !toast.sessionId || !removedSessionIdSet.has(toast.sessionId)
              ),
              ...queuePatch,
              ...restoredComposerDraftFrom(
                composerDraftsByScope,
                HOME_COMPOSER_DRAFT_SCOPE,
                "deleteProject"
              ),
              ...resetHomePlanMode("deleteProject", state.planMode),
              ...restoreHomeModelSelection(state, state.providers, "deleteProject"),
              activeProjectId: undefined,
              activeSessionId: undefined,
              sideChatsByMessageId: {},
              activeSideChatAnchorMessageId: undefined,
              messages: [],
              toolHistory: [],
              runHistory: [],
              progressPanelOpen: false,
              rightPanelOpen: false,
              rightPanelMode: null,
              rightPanelTabs: [],
              rightPanelActiveTabId: undefined,
              rightPanelMaximized: false,
              previewFile: undefined,
              filePreviewEntrySource: undefined,
              browserUrl: "",
              view: "home" as View
            };
          }
          return {
            projects,
            sessions,
            rightPanelBySession,
            composerDraftsByScope,
            notificationToasts: state.notificationToasts.filter(
              (toast) => !toast.sessionId || !removedSessionIdSet.has(toast.sessionId)
            ),
            ...queuePatch
          };
        });
      },

      async exportSession(id) {
        const session = get().sessions.find((item) => item.id === id);
        if (!apiClientRef.current || !session) {
          return;
        }
        try {
          // 直接读取目标会话，避免导出非当前会话时扰动已打开对话的 messages/toolHistory。
          const [messages, history] = await Promise.all([
            apiClientRef.current.listMessages(id),
            apiClientRef.current.listSessionRuns(id)
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
        if (!apiClientRef.current || !state.activeSessionId || state.isRunning) {
          return;
        }
        const session = await apiClientRef.current.forkSession(state.activeSessionId, messageId);
        set((current) => ({ sessions: [session, ...current.sessions] }));
        await get().selectSession(session.id);
      },

      async setMessageFeedback(messageId, feedback) {
        const state = get();
        if (!apiClientRef.current?.setMessageFeedback || !state.activeSessionId) {
          console.warn("[store] 更新消息反馈失败：ApiClient 或会话未就绪", {
            messageId,
            feedback,
            hasClient: Boolean(apiClientRef.current),
            hasFeedbackApi: Boolean(apiClientRef.current?.setMessageFeedback),
            activeSessionId: state.activeSessionId
          });
          return;
        }
        const setFeedback = apiClientRef.current.setMessageFeedback;
        const sessionId = state.activeSessionId;
        const previousMessage = state.messages.find((message) => message.id === messageId);
        if (!previousMessage || previousMessage.role !== "assistant") {
          console.warn("[store] 更新消息反馈失败：目标不是助手消息", {
            sessionId,
            messageId,
            role: previousMessage?.role,
            feedback
          });
          return;
        }
        console.info("[store] 更新消息反馈", {
          sessionId,
          messageId,
          previousFeedback: previousMessage.feedback,
          feedback
        });
        set((current) =>
          current.activeSessionId === sessionId
            ? { messages: applyMessageFeedback(current.messages, messageId, feedback) }
            : {}
        );
        try {
          const updated = await setFeedback(sessionId, messageId, feedback);
          set((current) =>
            current.activeSessionId === sessionId
              ? {
                  messages: current.messages.map((message) =>
                    message.id === updated.id ? updated : message
                  )
                }
              : {}
          );
        } catch (error) {
          console.warn("[store] 更新消息反馈失败，已回滚", {
            sessionId,
            messageId,
            feedback,
            error: error instanceof Error ? error.message : String(error)
          });
          set((current) =>
            current.activeSessionId === sessionId
              ? {
                  messages: current.messages.map((message) =>
                    message.id === messageId ? previousMessage : message
                  ),
                  notice: i18n.t("notice.messageFeedbackFailed")
                }
              : {}
          );
        }
      },

      newChat() {
        console.info("[store] 新建普通对话");
        // 未配置模型时直接打开模型配置步骤，避免用户回到首页后无从开始。
        if (!firstConfiguredProvider(get().providers)) {
          get().openOnboarding("model");
        }
        get().clearRunState();
        set((state) => ({
          rightPanelBySession: rememberRightPanel(state),
          ...switchComposerDraftScope(state, HOME_COMPOSER_DRAFT_SCOPE, "newChat"),
          ...resetHomePlanMode("newChat", state.planMode),
          ...restoreHomeModelSelection(state, state.providers, "newChat"),
          activeProjectId: undefined,
          activeSessionId: undefined,
          sideChatsByMessageId: {},
          activeSideChatAnchorMessageId: undefined,
          messages: [],
          toolHistory: [],
          runHistory: [],
          progressPanelOpen: false,
          rightPanelOpen: false,
          rightPanelMode: null,
          rightPanelTabs: [],
          rightPanelActiveTabId: undefined,
          rightPanelMaximized: false,
          previewFile: undefined,
          filePreviewEntrySource: undefined,
          browserUrl: "",
          view: "home"
        }));
        void get().refreshSlashCommands();
      },

      newChatInProject(projectId) {
        console.debug("[store] 在项目下新建会话", { projectId });
        if (!firstConfiguredProvider(get().providers)) {
          get().openOnboarding("model");
        }
        get().clearRunState();
        set((state) => ({
          rightPanelBySession: rememberRightPanel(state),
          ...switchComposerDraftScope(state, HOME_COMPOSER_DRAFT_SCOPE, "newChatInProject"),
          ...resetHomePlanMode("newChatInProject", state.planMode),
          ...restoreHomeModelSelection(state, state.providers, "newChatInProject"),
          activeProjectId: projectId,
          activeSessionId: undefined,
          sideChatsByMessageId: {},
          activeSideChatAnchorMessageId: undefined,
          messages: [],
          toolHistory: [],
          runHistory: [],
          progressPanelOpen: false,
          rightPanelOpen: false,
          rightPanelMode: null,
          rightPanelTabs: [],
          rightPanelActiveTabId: undefined,
          rightPanelMaximized: false,
          previewFile: undefined,
          filePreviewEntrySource: undefined,
          browserUrl: "",
          view: "home"
        }));
        void get().refreshSlashCommands(projectId);
      },

      async openFolder() {
        if (!apiClientRef.current) {
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
        const project = await apiClientRef.current.createProject({ path: dir, name: basenameOf(dir) || dir });
        await get().refresh();
        get().clearRunState();
        set((state) => selectNewProjectState(state, project, "openFolder"));
        await get().refreshSlashCommands(project.id);
      },

      async createBlankProject(name) {
        console.info("[store] 新建空白项目 入口", { name });
        if (!apiClientRef.current) {
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
        const project = await apiClientRef.current.createProject({
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
  };
}
