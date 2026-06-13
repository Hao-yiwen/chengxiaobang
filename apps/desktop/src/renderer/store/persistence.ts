import { createJSONStorage, type PersistOptions } from "zustand/middleware";
import { DEFAULT_LOCALE } from "../i18n";
import { migrateRightPanelMemory, sanitizePersistedAppState } from "./helpers/right-panel";
import type { AppState } from "./types";

export const appPersistOptions: PersistOptions<AppState, Partial<AppState>> = {
      name: "chengxiaobang.app",
      storage: createJSONStorage(() => localStorage),
      version: 4,
      partialize: (state) => ({
        view: state.view,
        activeSessionId: state.view === "home" ? undefined : state.activeSessionId,
        activeProjectId: state.activeProjectId,
        providerId: state.providerId,
        model: state.model,
        reasoningMode: state.reasoningMode,
        planMode: state.view === "home" ? false : state.planMode,
        accessMode: state.accessMode,
        sidebarOpen: state.sidebarOpen,
        rightPanelOpen: state.rightPanelOpen,
        rightPanelMode: state.rightPanelMode,
        rightPanelWidth: state.rightPanelWidth,
        rightPanelBySession: state.rightPanelBySession,
        queuedRunsBySession: state.queuedRunsBySession,
        pausedRunQueuesBySession: state.pausedRunQueuesBySession,
        theme: state.theme,
        locale: state.locale
      }),
      migrate: (persisted, version) => {
        if (version === 1 && persisted) {
          // v1 没有 rightPanelOpen：mode 非空就表示面板可见。
          const previous = persisted as Partial<AppState>;
          return migrateRightPanelMemory(sanitizePersistedAppState({
            ...previous,
            rightPanelOpen: previous.rightPanelMode != null
          }));
        }
        if (version === 2 && persisted) {
          return migrateRightPanelMemory(
            sanitizePersistedAppState(persisted as Partial<AppState>)
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
        return migrateRightPanelMemory(sanitizePersistedAppState(persisted as Partial<AppState>));
      },
      merge: (persisted, current) => ({
        ...current,
        ...migrateRightPanelMemory(sanitizePersistedAppState((persisted ?? {}) as Partial<AppState>))
      })
};
