import { createId } from "@chengxiaobang/shared";
import { normalizeOnboardingProfile, type OnboardingProfile } from "../../../common/profile";
import { isAbsolutePathLike } from "../../../common/file-preview";
import { sanitizeCodePreviewSettings } from "../../lib/code-preview-settings";
import { apiClientRef } from "../client";
import type { AppState, AppStoreGet, AppStoreSet, RightPanelPatch } from "../types";
import {
  HOME_COMPOSER_DRAFT_SCOPE,
  composerDraftScopeForView,
  resetHomePlanMode,
  switchComposerDraftScope
} from "../helpers/composer-drafts";
import {
  configuredProviderById,
  firstConfiguredProvider
} from "../helpers/providers";
import {
  normalizeModelSelectionForProvider,
  restoreHomeModelSelection
} from "../helpers/model-selection";
import {
  DEFAULT_RIGHT_PANEL_WIDTH,
  activeRightPanelTabKind,
  clampRightPanelWidth,
  closeRightPanelTab as closeRightPanelTabPure,
  openOrFocusRightPanelTab,
  rightPanelWidthForOpen,
  rememberRightPanel,
  restoredRightPanel,
  targetRightPanelWidthForKind,
  type OpenRightPanelTabInput
} from "../helpers/right-panel";
import { indexSideChatsByMessageId } from "../helpers/side-chats";
import type { RightPanelMode } from "../types";
import { selectActiveProject, selectActiveSession } from "../selectors";
import { upsertSession } from "../helpers/collections";

/** 从路径取末段作为文件 tab 标题。 */
function basename(path: string): string {
  const segments = path.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? path;
}

/** 打开或聚焦一个 tab,产出统一的右侧面板状态补丁(含活动 tab 镜像与宽度)。 */
function openTabPatch(
  state: AppState,
  input: OpenRightPanelTabInput,
  targetWidth = targetRightPanelWidthForKind(input.kind)
): RightPanelPatch {
  const { tabs, activeTabId } = openOrFocusRightPanelTab(state.rightPanelTabs, input);
  return {
    rightPanelOpen: true,
    rightPanelTabs: tabs,
    rightPanelActiveTabId: activeTabId,
    rightPanelMode: activeRightPanelTabKind(tabs, activeTabId),
    rightPanelWidth: rightPanelWidthForOpen(state.rightPanelWidth, state.rightPanelOpen, targetWidth)
  };
}

// 终端 tab 标题用的 user@host:沙箱 preload 取不到 node:os,只能异步问主进程,这里缓存一次。
let cachedTerminalHostLabel: string | undefined;

/** 终端 tab 需要稳定 PTY id 与 user@host 标签;其余工具只带 kind。标题首拿不到时先留空,稍后异步补。 */
function openTabInputForKind(kind: RightPanelMode): OpenRightPanelTabInput {
  if (kind !== "terminal") {
    return { kind };
  }
  return {
    kind,
    terminalId: createId("pty"),
    ...(cachedTerminalHostLabel ? { title: cachedTerminalHostLabel } : {})
  };
}

/** 异步取本机 user@host 标签并回填所有尚无标题的终端 tab(终端 tab 不持久化,无需进会话快照)。 */
function ensureTerminalHostLabel(set: AppStoreSet): void {
  if (cachedTerminalHostLabel) {
    return;
  }
  const fetchLabel = window.chengxiaobang?.terminalHostLabel;
  if (!fetchLabel) {
    return;
  }
  void Promise.resolve(fetchLabel())
    .then((label) => {
      if (!label) {
        return;
      }
      cachedTerminalHostLabel = label;
      set((state) => ({
        rightPanelTabs: state.rightPanelTabs.map((tab) =>
          tab.kind === "terminal" && !tab.title ? { ...tab, title: label } : tab
        )
      }));
    })
    .catch((error: unknown) => {
      console.warn("[store] 读取终端主机标签失败", {
        error: error instanceof Error ? error.message : String(error)
      });
    });
}

export function createUiActions(set: AppStoreSet, get: AppStoreGet): Partial<AppState> {
  return {
      setView: (view) =>
        set((state) => {
          const fromView = state.view;
          const sessionId = state.activeSessionId;
          const shouldRememberRightPanel = fromView === "chat" && Boolean(sessionId);
          const rightPanelBySession = shouldRememberRightPanel
            ? rememberRightPanel(state)
            : state.rightPanelBySession;
          const stateWithRightPanelMemory = { ...state, rightPanelBySession };
          const restoredRightPanelPatch =
            view === "chat" && sessionId
              ? restoredRightPanel(stateWithRightPanelMemory, sessionId)
              : undefined;
          const targetScope = composerDraftScopeForView(view, sessionId);
          if (fromView !== view && (shouldRememberRightPanel || view === "chat")) {
            console.info("[store] 切换页面时同步右侧面板记忆", {
              fromView,
              toView: view,
              sessionId,
              savedTabCount: shouldRememberRightPanel
                ? rightPanelBySession[sessionId ?? ""]?.tabs.length
                : undefined,
              restoredMode: restoredRightPanelPatch?.rightPanelMode,
              previewPath:
                restoredRightPanelPatch?.previewFile?.path ??
                (sessionId ? rightPanelBySession[sessionId]?.previewFile?.path : undefined)
            });
          }
          return {
            rightPanelBySession,
            view,
            ...(view === "home"
              ? {
                  ...resetHomePlanMode("setView", state.planMode),
                  ...restoreHomeModelSelection(state, state.providers, "setView")
                }
              : {}),
            ...(targetScope ? switchComposerDraftScope(state, targetScope, "setView") : {}),
            ...(restoredRightPanelPatch ?? {})
          };
        }),
      openSkills: (openAdd) => {
        console.debug("[store] 打开设置-技能页", { openAdd: Boolean(openAdd) });
        set({
          view: "settings",
          pendingSettingsSection: "skills",
          skillsAddRequested: Boolean(openAdd)
        });
      },
      clearSkillsAddRequest: () => set({ skillsAddRequested: false }),
      clearPendingSettingsSection: () => set({ pendingSettingsSection: undefined }),
      setInput: (input) => set({ input }),
      setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
      setOnboardingOpen: (onboardingOpen) =>
        set((state) => {
          const shouldDismiss = !onboardingOpen && !state.onboardingCompleted;
          console.info("[store] 切换首启引导可见性", {
            onboardingOpen,
            step: state.onboardingStep,
            completed: state.onboardingCompleted,
            dismissed: state.onboardingDismissed,
            markDismissed: shouldDismiss
          });
          return {
            onboardingOpen,
            ...(shouldDismiss ? { onboardingDismissed: true } : {})
          };
        }),
      openOnboarding: (step = "welcome") =>
        set((state) => {
          console.info("[store] 打开首启引导", {
            step,
            completed: state.onboardingCompleted,
            hasConfiguredProvider: Boolean(firstConfiguredProvider(state.providers))
          });
          return { onboardingOpen: true, onboardingStep: step };
        }),
      setOnboardingStep: (onboardingStep) =>
        set((state) => {
          console.info("[store] 切换首启引导步骤", {
            from: state.onboardingStep,
            to: onboardingStep,
            completed: state.onboardingCompleted
          });
          return { onboardingStep };
        }),
      saveOnboardingProfile: (onboardingProfile) => {
        const normalizedProfile = normalizeOnboardingProfile(onboardingProfile);
        console.info("[store] 保存首启用途画像", {
          primaryUse: normalizedProfile.primaryUse,
          scenarios: normalizedProfile.scenarios,
          scenarioCount: normalizedProfile.scenarios.length
        });
        set({ onboardingProfile: normalizedProfile });
        persistProfileFile(normalizedProfile);
      },
      completeOnboarding: () =>
        set((state) => {
          console.info("[store] 完成首启引导", {
            step: state.onboardingStep,
            primaryUse: state.onboardingProfile.primaryUse,
            scenarioCount: state.onboardingProfile.scenarios.length,
            hasConfiguredProvider: Boolean(firstConfiguredProvider(state.providers))
          });
          return {
            onboardingOpen: false,
            onboardingCompleted: true,
            onboardingDismissed: true,
            onboardingStep: "welcome"
          };
        }),
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
              ? normalizeModelSelectionForProvider(
                  provider,
                  state.model,
                  undefined,
                  "setProviderId"
                )
              : { model: undefined, reasoningMode: undefined })
          };
        }),
      setModel: (model) => set({ model }),
      setReasoningMode: (reasoningMode) => set({ reasoningMode }),
      async selectComposerModel(providerId, model, reasoningMode) {
        const state = get();
        const provider = configuredProviderById(state.providers, providerId);
        if (!provider) {
          console.warn("[store] 模型选择失败：供应商配置不可用", {
            providerId,
            model,
            activeSessionId: state.activeSessionId,
            view: state.view
          });
          set({ notice: "模型配置已不可用" });
          return;
        }
        const modelState = normalizeModelSelectionForProvider(
          provider,
          model,
          reasoningMode,
          "selectComposerModel"
        );
        const selection = { providerId: provider.id, ...modelState };
        if (state.view === "home" || !state.activeSessionId) {
          console.info("[store] 保存首页模型选择", {
            providerId: provider.id,
            model: modelState.model,
            reasoningMode: modelState.reasoningMode ?? "default"
          });
          set({
            providerId: provider.id,
            ...modelState,
            homeModelSelection: selection
          });
          return;
        }

        const sessionId = state.activeSessionId;
        console.info("[store] 保存会话模型选择", {
          sessionId,
          providerId: provider.id,
          model: modelState.model,
          reasoningMode: modelState.reasoningMode ?? "default"
        });
        set((current) => {
          const session = current.sessions.find((item) => item.id === sessionId);
          const optimisticSession = session
            ? {
                ...session,
                providerId: provider.id,
                model: modelState.model,
                reasoningMode: modelState.reasoningMode
              }
            : undefined;
          return {
            providerId: provider.id,
            ...modelState,
            ...(optimisticSession
              ? { sessions: upsertSession(current.sessions, optimisticSession) }
              : {})
          };
        });

        if (!apiClientRef.current?.updateSession) {
          console.warn("[store] 会话模型选择未写回：ApiClient 不可用", {
            sessionId,
            providerId: provider.id,
            model: modelState.model
          });
          return;
        }
        try {
          const updated = await apiClientRef.current.updateSession(sessionId, {
            providerId: provider.id,
            model: modelState.model,
            reasoningMode: modelState.reasoningMode ?? null
          });
          set((current) => {
            const updatedProvider =
              configuredProviderById(current.providers, updated.providerId) ?? provider;
            const updatedModelState = normalizeModelSelectionForProvider(
              updatedProvider,
              updated.model,
              updated.reasoningMode,
              "selectComposerModel.persisted"
            );
            return {
              sessions: upsertSession(current.sessions, updated),
              ...(current.activeSessionId === sessionId
                ? {
                    providerId: updatedProvider.id,
                    ...updatedModelState
                  }
                : {})
            };
          });
        } catch (error) {
          console.warn("[store] 会话模型选择写回失败", {
            sessionId,
            providerId: provider.id,
            model: modelState.model,
            error: error instanceof Error ? error.message : String(error)
          });
          set({ notice: "模型选择保存失败" });
        }
      },
      setPlanMode: (planMode) => {
        console.info("[store] 切换计划模式", { planMode });
        set({ planMode });
      },
      setAccessMode: (accessMode) => {
        console.info("[store] 更新权限模式", { accessMode });
        set({ accessMode });
      },
      setActiveProjectId: (activeProjectId) => {
        console.info("[store] 切换首页项目并清空 @ 文件建议", {
          fromProjectId: get().activeProjectId,
          toProjectId: activeProjectId
        });
        set((state) => ({
          rightPanelBySession: rememberRightPanel(state),
          ...switchComposerDraftScope(state, HOME_COMPOSER_DRAFT_SCOPE, "setActiveProjectId"),
          ...resetHomePlanMode("setActiveProjectId", state.planMode),
          ...restoreHomeModelSelection(state, state.providers, "setActiveProjectId"),
          activeProjectId,
          activeSessionId: undefined,
          fileSuggestions: [],
          messages: [],
          toolHistory: [],
          runHistory: [],
          modelDebugRecords: [],
          streamText: "",
          thinking: "",
          thinkingStartedAt: undefined,
          thinkingDurationMs: undefined,
          activeRunStartedAt: undefined,
          events: [],
          streamingPlan: undefined,
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
          rightPanelTabs: [],
          rightPanelActiveTabId: undefined,
          rightPanelMaximized: false,
          previewFile: undefined,
          filePreviewEntrySource: undefined,
          browserUrl: "",
          view: "home"
        }));
        void get().refreshSlashCommands(activeProjectId);
      },
      setTheme: (theme) => set({ theme }),
      setCodePreviewSettings: (patch) =>
        set((state) => {
          const next = sanitizeCodePreviewSettings({
            ...state.codePreviewSettings,
            ...patch
          });
          console.info("[store] 更新代码预览设置", {
            lightTheme: next.lightTheme,
            darkTheme: next.darkTheme,
            wrapLongLines: next.wrapLongLines,
            fontSize: next.fontSize
          });
          return { codePreviewSettings: next };
        }),
      setLocale: (locale) => set({ locale }),
      toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
      setProjectSortMode: (projectSortMode) => {
        console.info("[store] 切换项目排序方式", { projectSortMode });
        set({ projectSortMode });
      },
      setSidebarProjectsExpanded: (sidebarProjectsExpanded) => {
        console.debug("[store] 更新项目区分页展开状态", {
          expanded: sidebarProjectsExpanded
        });
        set({ sidebarProjectsExpanded });
      },
      setSidebarProjectSessionsExpanded: (projectId, expanded) => {
        console.debug("[store] 更新项目会话分页展开状态", { projectId, expanded });
        set((state) => {
          const next = { ...state.sidebarExpandedProjectSessionIds };
          if (expanded) {
            next[projectId] = true;
          } else {
            delete next[projectId];
          }
          return { sidebarExpandedProjectSessionIds: next };
        });
      },
      setSidebarUngroupedExpanded: (sidebarUngroupedExpanded) => {
        console.debug("[store] 更新普通对话分页展开状态", {
          expanded: sidebarUngroupedExpanded
        });
        set({ sidebarUngroupedExpanded });
      },
      resetSidebarExpansion: () => {
        console.info("[store] 重置侧边栏分页展开状态");
        set({
          sidebarProjectsExpanded: false,
          sidebarExpandedProjectSessionIds: {},
          sidebarUngroupedExpanded: false
        });
      },
      toggleRightPanel: () =>
        set((state) => {
          if (state.rightPanelOpen) {
            const patch: RightPanelPatch = { rightPanelOpen: false };
            return {
              ...patch,
              rightPanelMaximized: false,
              rightPanelBySession: rememberRightPanel(state, undefined, patch)
            };
          }
          // 打开:有记忆的 tab 直接恢复显示;没有则开一个空面板(顶栏 + 让用户新建)。
          const patch: RightPanelPatch = {
            rightPanelOpen: true,
            rightPanelWidth:
              state.rightPanelTabs.length > 0
                ? rightPanelWidthForOpen(state.rightPanelWidth, state.rightPanelOpen)
                : DEFAULT_RIGHT_PANEL_WIDTH
          };
          return {
            ...patch,
            rightPanelBySession: rememberRightPanel(state, undefined, patch)
          };
        }),
      openRightPanel: (mode) => {
        if (mode === null) {
          // 旧「回菜单」语义已由顶栏 + 承接,这里不再改变状态。
          return;
        }
        set((state) => {
          const targetWidth = targetRightPanelWidthForKind(mode);
          const patch = openTabPatch(state, openTabInputForKind(mode), targetWidth);
          console.info("[store] 打开/聚焦右侧面板 tab", {
            mode,
            activeTabId: patch.rightPanelActiveTabId,
            tabCount: patch.rightPanelTabs?.length,
            targetWidth: targetWidth ?? null,
            nextWidth: patch.rightPanelWidth ?? state.rightPanelWidth
          });
          return {
            ...patch,
            ...(mode === "chat" ? { activeSideChatAnchorMessageId: undefined } : {}),
            filePreviewEntrySource: mode === "files" ? "panel" : undefined,
            rightPanelBySession: rememberRightPanel(state, undefined, patch)
          };
        });
        if (mode === "terminal") {
          ensureTerminalHostLabel(set);
        }
      },
      newRightPanelTab: (kind) => {
        set((state) => {
          const targetWidth = targetRightPanelWidthForKind(kind);
          const patch = openTabPatch(state, openTabInputForKind(kind), targetWidth);
          console.info("[store] 新建右侧面板 tab", {
            kind,
            activeTabId: patch.rightPanelActiveTabId,
            tabCount: patch.rightPanelTabs?.length,
            targetWidth: targetWidth ?? null,
            nextWidth: patch.rightPanelWidth ?? state.rightPanelWidth
          });
          return {
            ...patch,
            ...(kind === "chat" ? { activeSideChatAnchorMessageId: undefined } : {}),
            filePreviewEntrySource: kind === "files" ? "panel" : undefined,
            rightPanelBySession: rememberRightPanel(state, undefined, patch)
          };
        });
        if (kind === "terminal") {
          ensureTerminalHostLabel(set);
        }
      },
      closeRightPanelTab: (tabId) =>
        set((state) => {
          const result = closeRightPanelTabPure(
            state.rightPanelTabs,
            state.rightPanelActiveTabId,
            tabId
          );
          const closedTerminalId =
            result.closed?.kind === "terminal"
              ? (result.closed.terminalId ?? result.closed.id)
              : undefined;
          if (closedTerminalId) {
            // 关 tab 才真正销毁 PTY;切 tab 仅隐藏不销毁。
            console.info("[store] 关闭终端 tab,销毁 PTY", {
              tabId,
              terminalId: closedTerminalId
            });
            void window.chengxiaobang?.terminalClose?.(closedTerminalId);
          }
          if (result.closed?.kind === "browser") {
            console.info("[store] 关闭浏览器 tab,清空内置浏览器地址", {
              tabId,
              browserUrl: state.browserUrl
            });
          }
          const patch: RightPanelPatch = {
            rightPanelTabs: result.tabs,
            rightPanelActiveTabId: result.activeTabId,
            rightPanelMode: activeRightPanelTabKind(result.tabs, result.activeTabId),
            ...(result.closed?.kind === "browser" ? { browserUrl: "" } : {})
          };
          return {
            ...patch,
            rightPanelBySession: rememberRightPanel(state, undefined, patch)
          };
        }),
      setActiveRightPanelTab: (tabId) =>
        set((state) => {
          const target = state.rightPanelTabs.find((tab) => tab.id === tabId);
          if (!target) {
            console.warn("[store] 切换右侧面板 tab 失败：目标不存在", {
              tabId,
              tabCount: state.rightPanelTabs.length
            });
            return {};
          }
          const patch: RightPanelPatch = {
            rightPanelActiveTabId: tabId,
            rightPanelMode: target.kind
          };
          console.info("[store] 切换右侧面板 tab", {
            tabId,
            kind: target.kind,
            tabCount: state.rightPanelTabs.length
          });
          return {
            ...patch,
            rightPanelBySession: rememberRightPanel(state, undefined, patch)
          };
        }),
      toggleRightPanelMaximized: () =>
        set((state) => {
          const next = !state.rightPanelMaximized;
          console.info("[store] 切换右侧面板最大化", { maximized: next });
          return { rightPanelMaximized: next };
        }),
      closeRightPanel: () =>
        set((state) => {
          const patch: RightPanelPatch = { rightPanelOpen: false };
          return {
            ...patch,
            rightPanelMaximized: false,
            rightPanelBySession: rememberRightPanel(state, undefined, patch)
          };
        }),
      setRightPanelWidth: (width) =>
        set((state) => {
          const nextWidth = clampRightPanelWidth(width);
          const patch: RightPanelPatch = { rightPanelWidth: nextWidth };
          return {
            ...patch,
            // 手动拖拽宽度即退出最大化。
            rightPanelMaximized: false,
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
      notifyGitChanged: (projectId) =>
        set((state) => {
          const nextToken = (state.gitRefreshTokenByProjectId[projectId] ?? 0) + 1;
          console.info("[store] 通知项目 Git 状态已变化", { projectId, token: nextToken });
          return {
            gitRefreshTokenByProjectId: {
              ...state.gitRefreshTokenByProjectId,
              [projectId]: nextToken
            }
          };
        }),

      async openSideChatForMessage(messageId) {
        const state = get();
        const message = state.messages.find((item) => item.id === messageId);
        if (!message || (message.role !== "user" && message.role !== "assistant")) {
          console.warn("[store] 打开消息侧边会话失败：锚点消息不可用", {
            messageId,
            activeSessionId: state.activeSessionId,
            found: Boolean(message),
            role: message?.role,
            kind: message?.kind
          });
          return;
        }
        if (message.kind === "compaction_summary") {
          console.warn("[store] 打开消息侧边会话失败：压缩摘要不能作为锚点", {
            messageId,
            activeSessionId: state.activeSessionId
          });
          return;
        }
        console.info("[store] 打开消息绑定侧边会话", {
          messageId,
          sessionId: message.sessionId,
          hasExistingSideChat: Boolean(state.sideChatsByMessageId[messageId])
        });
        set((current) => {
          const patch = openTabPatch(current, { kind: "chat" });
          return {
            ...patch,
            activeSideChatAnchorMessageId: messageId,
            rightPanelBySession: rememberRightPanel(current, undefined, patch)
          };
        });
        await get().refreshSideChat(messageId);
      },

      async loadSideChats(sessionId) {
        const targetSessionId = sessionId ?? get().activeSessionId;
        const listSideChats = apiClientRef.current?.listSideChats;
        if (!listSideChats || !targetSessionId) {
          set({ sideChatsByMessageId: {} });
          return;
        }
        try {
          const sideChats = await listSideChats(targetSessionId);
          if (get().activeSessionId !== targetSessionId) {
            console.debug("[store] 忽略过期的侧边会话摘要结果", {
              targetSessionId,
              activeSessionId: get().activeSessionId,
              count: sideChats.length
            });
            return;
          }
          console.info("[store] 刷新主会话侧边会话摘要", {
            sessionId: targetSessionId,
            count: sideChats.length
          });
          set({ sideChatsByMessageId: indexSideChatsByMessageId(sideChats) });
        } catch (error) {
          console.warn("[store] 刷新主会话侧边会话摘要失败", {
            sessionId: targetSessionId,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      },

      async refreshSideChat(messageId) {
        if (!apiClientRef.current?.getSideChat) {
          return;
        }
        const activeSessionId = get().activeSessionId;
        try {
          const detail = await apiClientRef.current.getSideChat(messageId);
          const session = detail?.session;
          const userMessageCount =
            detail?.messages.filter((message) => message.role === "user").length ?? 0;
          if (
            session?.sideChatParentSessionId &&
            activeSessionId &&
            session.sideChatParentSessionId !== activeSessionId
          ) {
            console.debug("[store] 忽略非当前主会话的侧边会话摘要", {
              messageId,
              activeSessionId,
              sideChatParentSessionId: session.sideChatParentSessionId
            });
            return;
          }
          console.info("[store] 刷新单条消息侧边会话摘要", {
            messageId,
            activeSessionId,
            hasSideChat: Boolean(session),
            userMessageCount
          });
          set((current) => {
            const next = { ...current.sideChatsByMessageId };
            if (session) {
              next[messageId] = {
                anchorMessageId: messageId,
                session,
                userMessageCount,
                updatedAt: session.updatedAt
              };
            } else {
              delete next[messageId];
            }
            return { sideChatsByMessageId: next };
          });
        } catch (error) {
          console.warn("[store] 刷新单条消息侧边会话摘要失败", {
            messageId,
            activeSessionId,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      },

      openFilePreview(path, options) {
        const state = get();
        const project = selectActiveProject(state);
        const session = selectActiveSession(state);
        const sessionId = session?.id ?? state.activeSessionId;
        const source = options?.source ?? "direct";
        console.info("[store] 打开文件预览", {
          path,
          projectPath: project?.path,
          sessionId,
          pathKind: isAbsolutePathLike(path) ? "absolute" : "relative",
          source
        });
        set((state) => {
          const patch: RightPanelPatch = {
            ...openTabPatch(state, { kind: "files", title: basename(path) }),
            previewFile: {
              path,
              ...(project?.path ? { projectPath: project.path } : {}),
              ...(sessionId ? { sessionId } : {})
            }
          };
          return {
            ...patch,
            filePreviewEntrySource: source,
            rightPanelBySession: rememberRightPanel(state, undefined, patch)
          };
        });
      },

      openArtifact(path, kind) {
        console.info("[store] 打开生成物预览", { path, kind });
        const state = get();
        const project = selectActiveProject(state);
        const session = selectActiveSession(state);
        const sessionId = session?.id ?? state.activeSessionId;
        const previewContext = {
          ...(project?.path ? { projectPath: project.path } : {}),
          ...(sessionId ? { sessionId } : {}),
          allowCwdFallback: false
        };
        const openFilePreviewFallback = () =>
          set((state) => {
            const patch: RightPanelPatch = {
              ...openTabPatch(state, { kind: "files", title: basename(path) }),
              previewFile: {
                path,
                ...previewContext
              }
            };
            return {
              ...patch,
              filePreviewEntrySource: "direct",
              rightPanelBySession: rememberRightPanel(state, undefined, patch)
            };
          });
        if (kind !== "html") {
          openFilePreviewFallback();
          return;
        }

        const bridge = window.chengxiaobang;
        const getFilePreviewInfo = bridge?.getFilePreviewInfo;
        const createFileUrl = bridge?.createFileUrl;
        if (!getFilePreviewInfo || !createFileUrl) {
          console.warn("[store] HTML 生成物缺少本地浏览器预览能力，回退文件预览", {
            path,
            hasInfoBridge: Boolean(getFilePreviewInfo),
            hasFileUrlBridge: Boolean(createFileUrl)
          });
          openFilePreviewFallback();
          return;
        }

        void (async () => {
          const info = await getFilePreviewInfo(path, previewContext);
          if (!info.ok) {
            console.warn("[store] HTML 生成物路径解析失败，回退文件预览", {
              path,
              error: info.error
            });
            openFilePreviewFallback();
            return;
          }
          const result = await createFileUrl(info.path);
          if (!result.ok) {
            console.warn("[store] HTML 生成物本地 URL 创建失败，回退文件预览", {
              path,
              resolvedPath: info.path,
              error: result.error
            });
            openFilePreviewFallback();
            return;
          }
          console.info("[store] HTML 生成物进入内置浏览器", {
            path,
            resolvedPath: info.path,
            url: result.url
          });
          set((state) => {
            const patch: RightPanelPatch = {
              ...openTabPatch(state, { kind: "browser" }),
              previewFile: undefined,
              browserUrl: result.url
            };
            return {
              ...patch,
              filePreviewEntrySource: undefined,
              rightPanelBySession: rememberRightPanel(state, undefined, patch)
            };
          });
        })().catch((error) => {
          console.warn("[store] HTML 生成物打开内置浏览器异常，回退文件预览", {
            path,
            error: error instanceof Error ? error.message : String(error)
          });
          openFilePreviewFallback();
        });
      },

      async runTerminalCommand(command) {
        const state = get();
        const project = selectActiveProject(state);
        const trimmed = command.trim();
        if (!apiClientRef.current || !project || !trimmed || state.terminalRunning) {
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
          const result = await apiClientRef.current.terminalExec({
            projectId: project.id,
            command: trimmed
          });
          finish(result.output, result.exitCode);
        } catch (error) {
          finish(error instanceof Error ? error.message : String(error), -1);
        }
      },
  };
}

function persistProfileFile(onboardingProfile: OnboardingProfile): void {
  const saveProfile = window.chengxiaobang?.saveProfile;
  if (!saveProfile) {
    console.debug("[store] 当前环境没有本地 profile.json 写入桥，跳过用户画像文件持久化", {
      primaryUse: onboardingProfile.primaryUse,
      scenarioCount: onboardingProfile.scenarios.length
    });
    return;
  }
  void saveProfile(onboardingProfile)
    .then((result) => {
      if (result.ok) {
        console.info("[store] 用户画像已持久化到 profile.json", {
          path: result.path,
          primaryUse: onboardingProfile.primaryUse,
          scenarioCount: onboardingProfile.scenarios.length
        });
        return;
      }
      console.warn("[store] 用户画像写入 profile.json 失败", {
        path: result.path,
        error: result.error,
        primaryUse: onboardingProfile.primaryUse
      });
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.warn("[store] 用户画像写入 profile.json 异常", {
        error: message,
        primaryUse: onboardingProfile.primaryUse,
        scenarioCount: onboardingProfile.scenarios.length
      });
    });
}
