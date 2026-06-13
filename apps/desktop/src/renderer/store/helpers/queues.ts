import type { AppState, QueuedRunItem } from "../types";

export function queuedRunsForSession(state: AppState, sessionId?: string): QueuedRunItem[] {
  return sessionId ? (state.queuedRunsBySession[sessionId] ?? []) : [];
}

export function upsertQueuedRunsForSession(
  state: AppState,
  sessionId: string,
  items: QueuedRunItem[]
): Pick<AppState, "queuedRunsBySession"> {
  const queuedRunsBySession = { ...state.queuedRunsBySession };
  if (items.length === 0) {
    delete queuedRunsBySession[sessionId];
  } else {
    queuedRunsBySession[sessionId] = items;
  }
  return { queuedRunsBySession };
}

export function dropQueuedRun(
  state: AppState,
  id: string
): Pick<AppState, "queuedRunsBySession" | "pausedRunQueuesBySession"> {
  let removedSessionId: string | undefined;
  const queuedRunsBySession = Object.fromEntries(
    Object.entries(state.queuedRunsBySession)
      .map(([sessionId, items]) => {
        const next = items.filter((item) => item.id !== id);
        if (next.length !== items.length) {
          removedSessionId = sessionId;
        }
        return [sessionId, next] as const;
      })
      .filter(([, items]) => items.length > 0)
  ) as Record<string, QueuedRunItem[]>;
  if (!removedSessionId || queuedRunsBySession[removedSessionId]?.length) {
    return { queuedRunsBySession, pausedRunQueuesBySession: state.pausedRunQueuesBySession };
  }
  const { [removedSessionId]: _removed, ...pausedRunQueuesBySession } =
    state.pausedRunQueuesBySession;
  return { queuedRunsBySession, pausedRunQueuesBySession };
}

export function dropQueuedRunsForSessions(
  state: AppState,
  sessionIds: string[]
): Pick<AppState, "queuedRunsBySession" | "pausedRunQueuesBySession"> {
  if (sessionIds.length === 0) {
    return {
      queuedRunsBySession: state.queuedRunsBySession,
      pausedRunQueuesBySession: state.pausedRunQueuesBySession
    };
  }
  const remove = new Set(sessionIds);
  return {
    queuedRunsBySession: Object.fromEntries(
      Object.entries(state.queuedRunsBySession).filter(([sessionId]) => !remove.has(sessionId))
    ),
    pausedRunQueuesBySession: Object.fromEntries(
      Object.entries(state.pausedRunQueuesBySession).filter(
        ([sessionId]) => !remove.has(sessionId)
      )
    ) as Record<string, true>
  };
}

export function pruneRunQueuesByLiveSessions(
  state: AppState,
  liveSessionIds: Set<string>
): Pick<AppState, "queuedRunsBySession" | "pausedRunQueuesBySession"> {
  return {
    queuedRunsBySession: Object.fromEntries(
      Object.entries(state.queuedRunsBySession).filter(([sessionId]) =>
        liveSessionIds.has(sessionId)
      )
    ),
    pausedRunQueuesBySession: Object.fromEntries(
      Object.entries(state.pausedRunQueuesBySession).filter(([sessionId]) =>
        liveSessionIds.has(sessionId)
      )
    ) as Record<string, true>
  };
}

export function pauseRunQueue(
  state: AppState,
  sessionId?: string
): Pick<AppState, "pausedRunQueuesBySession"> {
  if (!sessionId || queuedRunsForSession(state, sessionId).length === 0) {
    return { pausedRunQueuesBySession: state.pausedRunQueuesBySession };
  }
  console.warn("[store] 暂停会话排队运行", {
    sessionId,
    queuedCount: queuedRunsForSession(state, sessionId).length
  });
  return { pausedRunQueuesBySession: { ...state.pausedRunQueuesBySession, [sessionId]: true } };
}

export function unpauseRunQueue(
  state: AppState,
  sessionId: string
): Pick<AppState, "pausedRunQueuesBySession"> {
  if (!state.pausedRunQueuesBySession[sessionId]) {
    return { pausedRunQueuesBySession: state.pausedRunQueuesBySession };
  }
  const { [sessionId]: _removed, ...pausedRunQueuesBySession } = state.pausedRunQueuesBySession;
  console.info("[store] 恢复会话排队运行", { sessionId });
  return { pausedRunQueuesBySession };
}
