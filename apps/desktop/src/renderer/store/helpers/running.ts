import type { AppState } from "../types";

export function markSessionRunning(state: AppState, sessionId: string): Pick<AppState, "runningSessionsById"> {
  if (state.runningSessionsById[sessionId]) {
    return { runningSessionsById: state.runningSessionsById };
  }
  console.debug("[store] 标记会话运行中", { sessionId });
  return { runningSessionsById: { ...state.runningSessionsById, [sessionId]: true } };
}

export function clearSessionRunning(state: AppState, sessionId: string): Pick<AppState, "runningSessionsById"> {
  if (!state.runningSessionsById[sessionId]) {
    return { runningSessionsById: state.runningSessionsById };
  }
  const { [sessionId]: _removed, ...rest } = state.runningSessionsById;
  console.debug("[store] 清理会话运行态", { sessionId });
  return { runningSessionsById: rest };
}

export function markRunRunning(
  state: AppState,
  runId: string,
  sessionId: string
): Pick<AppState, "runningSessionsById" | "runningRunSessionById"> {
  const sessionPatch = markSessionRunning(state, sessionId);
  if (state.runningRunSessionById[runId] === sessionId) {
    return {
      ...sessionPatch,
      runningRunSessionById: state.runningRunSessionById
    };
  }
  console.debug("[store] 记录运行归属", { runId, sessionId });
  return {
    ...sessionPatch,
    runningRunSessionById: {
      ...state.runningRunSessionById,
      [runId]: sessionId
    }
  };
}

export function clearRunRunning(
  state: AppState,
  runId: string,
  fallbackSessionId?: string
): Pick<AppState, "runningSessionsById" | "runningRunSessionById"> {
  const sessionId = state.runningRunSessionById[runId] ?? fallbackSessionId;
  if (!sessionId) {
    return {
      runningSessionsById: state.runningSessionsById,
      runningRunSessionById: state.runningRunSessionById
    };
  }
  const { [runId]: _removed, ...runningRunSessionById } = state.runningRunSessionById;
  const hasOtherRunningRun = Object.values(runningRunSessionById).some((id) => id === sessionId);
  console.debug("[store] 清理运行归属", { runId, sessionId, hasOtherRunningRun });
  return {
    runningRunSessionById,
    ...(hasOtherRunningRun
      ? { runningSessionsById: state.runningSessionsById }
      : clearSessionRunning(state, sessionId))
  };
}

export function clearSessionRunTracking(
  state: AppState,
  sessionId: string
): Pick<AppState, "runningSessionsById" | "runningRunSessionById"> {
  const runningRunSessionById = Object.fromEntries(
    Object.entries(state.runningRunSessionById).filter(([, id]) => id !== sessionId)
  ) as Record<string, string>;
  return {
    runningRunSessionById,
    ...clearSessionRunning(state, sessionId)
  };
}
