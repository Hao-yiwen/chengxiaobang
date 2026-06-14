import { createJSONStorage, type PersistOptions } from "zustand/middleware";
import { DEFAULT_LOCALE } from "../i18n";
import { migrateRightPanelMemory, sanitizePersistedAppState } from "./helpers/right-panel";
import type { AppState, ModelSelection } from "./types";

function homeModelSelectionFromLegacyState(state: Partial<AppState>): ModelSelection | undefined {
  if (state.homeModelSelection || state.view !== "home" || !state.providerId) {
    return state.homeModelSelection;
  }
  return {
    providerId: state.providerId,
    ...(state.model ? { model: state.model } : {}),
    ...(state.reasoningMode ? { reasoningMode: state.reasoningMode } : {})
  };
}

function migrateHomeModelSelection(state: Partial<AppState>): Partial<AppState> {
  const homeModelSelection = homeModelSelectionFromLegacyState(state);
  return homeModelSelection ? { ...state, homeModelSelection } : state;
}

export const appPersistOptions: PersistOptions<AppState, Partial<AppState>> = {
  name: "chengxiaobang.app",
  storage: createJSONStorage(() => localStorage),
  version: 6,
  partialize: (state) => ({
    view: state.view,
    activeSessionId: state.view === "home" ? undefined : state.activeSessionId,
    activeProjectId: state.activeProjectId,
    providerId: state.providerId,
    model: state.model,
    reasoningMode: state.reasoningMode,
    homeModelSelection: state.homeModelSelection,
    planMode: state.view === "home" ? false : state.planMode,
    accessMode: state.accessMode,
    sidebarOpen: state.sidebarOpen,
    rightPanelOpen: state.rightPanelOpen,
    rightPanelMode: state.rightPanelMode,
    rightPanelWidth: state.rightPanelWidth,
    rightPanelBySession: state.rightPanelBySession,
    queuedRunsBySession: state.queuedRunsBySession,
    pausedRunQueuesBySession: state.pausedRunQueuesBySession,
    projectSortMode: state.projectSortMode,
    theme: state.theme,
    locale: state.locale,
    onboardingCompleted: state.onboardingCompleted,
    onboardingStep: state.onboardingStep,
    onboardingProfile: state.onboardingProfile
  }),
  migrate: (persisted, version) => {
    if (version === 1 && persisted) {
      // v1 没有 rightPanelOpen：mode 非空就表示面板可见。
      const previous = persisted as Partial<AppState>;
      return migrateHomeModelSelection(migrateRightPanelMemory(sanitizePersistedAppState({
        ...previous,
        rightPanelOpen: previous.rightPanelMode != null
      })));
    }
    if (version === 2 && persisted) {
      return migrateHomeModelSelection(
        migrateRightPanelMemory(sanitizePersistedAppState(persisted as Partial<AppState>))
      );
    }
    if (version < 1 || !persisted) {
      // 从旧版按 key 分散存储的 localStorage 结构迁移。
      const read = (key: string) => localStorage.getItem(key) ?? undefined;
      return {
        activeSessionId: read("chengxiaobang.activeSessionId"),
        activeProjectId: read("chengxiaobang.activeProjectId"),
        providerId: read("chengxiaobang.activeProviderId"),
        accessMode:
          read("chengxiaobang.accessMode") === "full_access"
            ? "full_access"
            : read("chengxiaobang.accessMode") === "smart_approval"
              ? "smart_approval"
              : "approval",
        theme: "system",
        locale: DEFAULT_LOCALE
      } satisfies Partial<AppState>;
    }
    return migrateHomeModelSelection(
      migrateRightPanelMemory(sanitizePersistedAppState(persisted as Partial<AppState>))
    );
  },
  merge: (persisted, current) => {
    const sanitized = migrateHomeModelSelection(migrateRightPanelMemory(
      sanitizePersistedAppState((persisted ?? {}) as Partial<AppState>)
    ));
    return {
      ...current,
      ...sanitized
    };
  }
};
