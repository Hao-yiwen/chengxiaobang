import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createDataActions } from "./actions/data-actions";
import { createRunActions } from "./actions/run-actions";
import { createSettingsActions } from "./actions/settings-actions";
import { createUiActions } from "./actions/ui-actions";
import { clearApiClient } from "./client";
import { initialState } from "./initial-state";
import { appPersistOptions } from "./persistence";
import type { AppState } from "./types";
export type {
  AppState,
  Attachment,
  ModelSelection,
  NotificationToast,
  OnboardingStep,
  PreviewFileState,
  ProjectSortMode,
  QueuedRunItem,
  RightPanelMode,
  RightPanelTab,
  TerminalEntry,
  Theme,
  View
} from "./types";
export type { OnboardingPrimaryUse, OnboardingProfile, OnboardingScenario } from "../../common/profile";
export { getApiClient } from "./client";
export { resolveRunProvider, selectActiveProject, selectActiveSession } from "./selectors";

export const useAppStore = create<AppState>()(
  persist<AppState, [], [], Partial<AppState>>(
    (set, get) => {
      const actions = {
        ...createUiActions(set, get),
        ...createDataActions(set, get),
        ...createRunActions(set, get),
        ...createSettingsActions(set, get)
      } as Omit<AppState, keyof typeof initialState>;
      return { ...initialState, ...actions };
    },
    appPersistOptions
  )
);

/** 重置全局 store 单例，供测试使用。 */
export function resetAppStore(): void {
  clearApiClient();
  useAppStore.setState({ ...initialState });
}

// store 是全局单例：dev 下若被部分热更，新组件会接到旧 store 实例上（拿不到新
// 增的 action，点击静默失效）。改动本模块时直接整页刷新，杜绝新旧实例错位。
if (import.meta.hot) {
  import.meta.hot.accept(() => {
    console.info("[store] 模块热更，强制整页刷新以避免 store 双实例");
    import.meta.hot?.invalidate();
  });
}
