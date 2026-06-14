import { createId } from "@chengxiaobang/shared";
import { normalizeOnboardingProfile, type OnboardingProfile } from "../../../common/profile";
import { isAbsolutePathLike } from "../../../common/file-preview";
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
  firstConfiguredProvider,
  normalizeModelForProvider
} from "../helpers/providers";
import {
  RIGHT_PANEL_FILE_WIDTH,
  RIGHT_PANEL_MAX_WIDTH,
  RIGHT_PANEL_MIN_WIDTH,
  rememberRightPanel
} from "../helpers/right-panel";
import { selectActiveProject, selectActiveSession } from "../selectors";

export function createUiActions(set: AppStoreSet, get: AppStoreGet): Partial<AppState> {
  return {
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
      setOnboardingOpen: (onboardingOpen) =>
        set((state) => {
          console.info("[store] 切换首启引导可见性", {
            onboardingOpen,
            step: state.onboardingStep,
            completed: state.onboardingCompleted
          });
          return { onboardingOpen };
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
              ? normalizeModelForProvider(
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
          providerId: undefined,
          model: undefined,
          reasoningMode: undefined,
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
      setProjectSortMode: (projectSortMode) => {
        console.info("[store] 切换项目排序方式", { projectSortMode });
        set({ projectSortMode });
      },
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
        const state = get();
        const project = selectActiveProject(state);
        const session = selectActiveSession(state);
        const sessionId = session?.id ?? state.activeSessionId;
        set((state) => {
          const patch: RightPanelPatch = {
            previewFile: {
              path,
              ...(project?.path ? { projectPath: project.path } : {}),
              ...(sessionId ? { sessionId } : {}),
              allowCwdFallback: false
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
