import type { Project, ProviderConfig, Session } from "@chengxiaobang/shared";
import { firstConfiguredProvider, isConfiguredProvider } from "./helpers/providers";
import type { AppState } from "./types";

/** 当前运行会使用的供应商：首页新对话必须显式选择，已有会话才回退到第一个已配置供应商。 */
export function resolveRunProvider(state: AppState): ProviderConfig | undefined {
  const selected = state.providers.find((provider) => provider.id === state.providerId);
  if (isConfiguredProvider(selected)) {
    return selected;
  }
  if (state.view === "home" && !state.activeSessionId) {
    return undefined;
  }
  return firstConfiguredProvider(state.providers);
}

export function selectActiveSession(state: AppState): Session | undefined {
  return state.sessions.find((session) => session.id === state.activeSessionId);
}

export function selectActiveProject(state: AppState): Project | undefined {
  const activeSession = selectActiveSession(state);
  if (activeSession?.projectId === null) {
    return undefined;
  }
  const projectId = activeSession?.projectId ?? state.activeProjectId;
  return state.projects.find((project) => project.id === projectId);
}
