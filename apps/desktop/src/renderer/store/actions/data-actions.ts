import { basenameOf } from "../../../common/file-preview";
import { createApiClient } from "../../lib/api";
import { downloadTextFile } from "../../lib/download";
import { buildSessionMarkdown, exportFilename } from "../../lib/session-export";
import i18n from "../../i18n";
import { apiClientRef, replaceRunEventSubscription, setApiClient } from "../client";
import type { AppState, AppStoreGet, AppStoreSet, View } from "../types";
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
  firstConfiguredProvider,
  normalizeModelForProvider
} from "../helpers/providers";
import {
  activeRunRecoveryPatch,
  logRecoveredFailedRuns,
  settleInterruptedRunHistory,
  settledSessionHistoryPatch
} from "../helpers/run-history";
import { latestActiveRunSnapshot } from "../helpers/run-records";
import { clearSessionRunning } from "../helpers/running";
import {
  dropRightPanelMemory,
  rememberRightPanel,
  restoredRightPanel,
  selectNewProjectState
} from "../helpers/right-panel";
import { selectActiveProject } from "../selectors";

export function createDataActions(set: AppStoreSet, get: AppStoreGet): Partial<AppState> {
  return {
      async initClient(injected) {
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
            ...pruneRunQueuesByLiveSessions(state, liveSessionIds),
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
          set({ fileSuggestions: [] });
          return;
        }
        try {
          const files = await apiClientRef.current.listProjectFiles(project.id, query);
          set({ fileSuggestions: files });
        } catch (error) {
          console.warn("加载文件建议失败", error);
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
        if (!configuredProvider) {
          // 首次运行停留在首页，用轻量弹窗完成配置，避免直接把用户甩到设置页。
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
        if (!apiClientRef.current) {
          return;
        }
        const [messages, history, activeSnapshots] = await Promise.all([
          apiClientRef.current.listMessages(id),
          apiClientRef.current.listSessionRuns(id),
          apiClientRef.current.listActiveRuns ? apiClientRef.current.listActiveRuns(id) : Promise.resolve([])
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
        if (!apiClientRef.current) {
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
            ...queuePatch,
            runningSessionsById,
            runningRunSessionById
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
              ...queuePatch,
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
          return { projects, sessions, rightPanelBySession, composerDraftsByScope, ...queuePatch };
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

      newChat() {
        console.info("[store] 新建普通对话");
        // 未配置模型时直接打开轻量配置弹窗，避免用户回到首页后无从开始。
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
