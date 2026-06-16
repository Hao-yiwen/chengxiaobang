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
  RIGHT_PANEL_FILE_WIDTH,
  RIGHT_PANEL_REVIEW_WIDTH,
  clampRightPanelWidth,
  rightPanelWidthForOpen,
  rememberRightPanel
} from "../helpers/right-panel";
import { selectActiveProject, selectActiveSession } from "../selectors";
import { upsertSession } from "../helpers/collections";

export function createUiActions(set: AppStoreSet, get: AppStoreGet): Partial<AppState> {
  return {
      setView: (view) =>
        set((state) => {
          const targetScope = composerDraftScopeForView(view, state.activeSessionId);
          return {
            view,
            ...(view === "home"
              ? {
                  ...resetHomePlanMode("setView", state.planMode),
                  ...restoreHomeModelSelection(state, state.providers, "setView")
                }
              : {}),
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
        set((state) => ({
          rightPanelBySession: rememberRightPanel(state),
          ...switchComposerDraftScope(state, HOME_COMPOSER_DRAFT_SCOPE, "setActiveProjectId"),
          ...resetHomePlanMode("setActiveProjectId", state.planMode),
          ...restoreHomeModelSelection(state, state.providers, "setActiveProjectId"),
          activeProjectId,
          activeSessionId: undefined,
          messages: [],
          toolHistory: [],
          runHistory: [],
          streamText: "",
          thinking: "",
          thinkingStartedAt: undefined,
          thinkingDurationMs: undefined,
          activeRunStartedAt: undefined,
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
      toggleRightPanel: () =>
        set((state) => {
          const patch: RightPanelPatch = state.rightPanelOpen
            ? { rightPanelOpen: false }
            : {
                rightPanelOpen: true,
                rightPanelMode: null,
                rightPanelWidth: DEFAULT_RIGHT_PANEL_WIDTH
              };
          return {
            ...patch,
            rightPanelBySession: rememberRightPanel(state, undefined, patch)
          };
        }),
      openRightPanel: (mode) =>
        set((state) => {
          const targetWidth =
            mode === "changes"
              ? RIGHT_PANEL_REVIEW_WIDTH
              : mode === "files"
                ? RIGHT_PANEL_FILE_WIDTH
                : undefined;
          const patch: RightPanelPatch = {
            rightPanelOpen: true,
            rightPanelMode: mode,
            rightPanelWidth: rightPanelWidthForOpen(
              state.rightPanelWidth,
              state.rightPanelOpen,
              targetWidth
            )
          };
          console.info("[store] 打开右侧面板", {
            mode,
            targetWidth,
            nextWidth: patch.rightPanelWidth ?? state.rightPanelWidth
          });
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
          const nextWidth = clampRightPanelWidth(width);
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
          pathKind: isAbsolutePathLike(path) ? "absolute" : "relative"
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
            rightPanelWidth: rightPanelWidthForOpen(
              state.rightPanelWidth,
              state.rightPanelOpen,
              RIGHT_PANEL_FILE_WIDTH
            )
          };
          return {
            ...patch,
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
              previewFile: {
                path,
                ...previewContext
              },
              rightPanelOpen: true,
              rightPanelMode: "files",
              rightPanelWidth: rightPanelWidthForOpen(
                state.rightPanelWidth,
                state.rightPanelOpen,
                RIGHT_PANEL_FILE_WIDTH
              )
            };
            return {
              ...patch,
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
              previewFile: undefined,
              browserUrl: result.url,
              rightPanelOpen: true,
              rightPanelMode: "browser",
              rightPanelWidth: rightPanelWidthForOpen(state.rightPanelWidth, state.rightPanelOpen)
            };
            return {
              ...patch,
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
