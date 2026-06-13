import type { Project, ProviderConfig, Session } from "@chengxiaobang/shared";
import { firstConfiguredProvider, isConfiguredProvider } from "./helpers/providers";
import type { AppState } from "./types";

/** 当前运行会使用的供应商：优先选中项，否则使用第一个已配置供应商。 */
export function resolveRunProvider(state: AppState): ProviderConfig | undefined {
  const selected =
    state.providers.find((provider) => provider.id === state.providerId) ??
    firstConfiguredProvider(state.providers);
  return isConfiguredProvider(selected) ? selected : undefined;
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
