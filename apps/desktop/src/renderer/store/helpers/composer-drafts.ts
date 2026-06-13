import type { AppState, ComposerDraft, ComposerDraftScope, View } from "../types";

export function resetHomePlanMode(source: string, wasEnabled?: boolean): Pick<AppState, "planMode"> {
  if (wasEnabled) {
    console.info("[store] 进入首页时关闭计划模式", { source });
  }
  return { planMode: false };
}

export const HOME_COMPOSER_DRAFT_SCOPE = "home";

export function sessionComposerDraftScope(sessionId: string): ComposerDraftScope {
  return `session:${sessionId}`;
}

export function composerDraftScopeForView(
  view: View,
  activeSessionId?: string
): ComposerDraftScope | undefined {
  if (view === "home") {
    return HOME_COMPOSER_DRAFT_SCOPE;
  }
  if (view === "chat" && activeSessionId) {
    return sessionComposerDraftScope(activeSessionId);
  }
  return undefined;
}

export function isEmptyComposerDraft(draft: ComposerDraft): boolean {
  return draft.input.length === 0 && draft.attachments.length === 0;
}

export function emptyComposerDraft(): ComposerDraft {
  return { input: "", attachments: [] };
}

export function rememberComposerDraft(
  state: AppState,
  source: string,
  scope = state.activeComposerDraftScope,
  draft: ComposerDraft = { input: state.input, attachments: state.attachments }
): Record<ComposerDraftScope, ComposerDraft> {
  const next = { ...state.composerDraftsByScope };
  if (isEmptyComposerDraft(draft)) {
    delete next[scope];
  } else {
    next[scope] = draft;
  }
  console.debug("[store] 保存输入草稿", {
    source,
    scope,
    inputChars: draft.input.length,
    attachmentCount: draft.attachments.length
  });
  return next;
}

export function restoreComposerDraft(
  drafts: Record<ComposerDraftScope, ComposerDraft>,
  scope: ComposerDraftScope,
  source: string
): Pick<AppState, "input" | "attachments"> {
  const draft = drafts[scope] ?? emptyComposerDraft();
  console.debug("[store] 恢复输入草稿", {
    source,
    scope,
    inputChars: draft.input.length,
    attachmentCount: draft.attachments.length
  });
  return {
    input: draft.input,
    attachments: draft.attachments
  };
}

export function switchComposerDraftScope(
  state: AppState,
  targetScope: ComposerDraftScope,
  source: string
): Pick<AppState, "composerDraftsByScope" | "activeComposerDraftScope" | "input" | "attachments"> {
  const drafts = rememberComposerDraft(state, source);
  if (state.activeComposerDraftScope !== targetScope) {
    console.info("[store] 切换输入草稿作用域", {
      source,
      from: state.activeComposerDraftScope,
      to: targetScope
    });
  }
  return {
    composerDraftsByScope: drafts,
    activeComposerDraftScope: targetScope,
    ...restoreComposerDraft(drafts, targetScope, source)
  };
}

export function clearActiveComposerDraft(
  state: AppState,
  source: string
): Pick<AppState, "composerDraftsByScope" | "input" | "attachments"> {
  const drafts = { ...state.composerDraftsByScope };
  delete drafts[state.activeComposerDraftScope];
  console.info("[store] 清空当前输入草稿", {
    source,
    scope: state.activeComposerDraftScope,
    inputChars: state.input.length,
    attachmentCount: state.attachments.length
  });
  return {
    composerDraftsByScope: drafts,
    input: "",
    attachments: []
  };
}

export function clearActiveComposerInput(
  state: AppState,
  source: string
): Pick<AppState, "composerDraftsByScope" | "input"> {
  return {
    composerDraftsByScope: rememberComposerDraft(state, source, state.activeComposerDraftScope, {
      input: "",
      attachments: state.attachments
    }),
    input: ""
  };
}

export function restoredComposerDraftFrom(
  drafts: Record<ComposerDraftScope, ComposerDraft>,
  targetScope: ComposerDraftScope,
  source: string
): Pick<AppState, "composerDraftsByScope" | "activeComposerDraftScope" | "input" | "attachments"> {
  return {
    composerDraftsByScope: drafts,
    activeComposerDraftScope: targetScope,
    ...restoreComposerDraft(drafts, targetScope, source)
  };
}

export function dropComposerDraftMemory(
  state: AppState,
  sessionIds: string[]
): Record<ComposerDraftScope, ComposerDraft> {
  if (sessionIds.length === 0) {
    return state.composerDraftsByScope;
  }
  const remove = new Set(sessionIds.map(sessionComposerDraftScope));
  return Object.fromEntries(
    Object.entries(state.composerDraftsByScope).filter(([scope]) => !remove.has(scope))
  );
}

export function pruneComposerDraftsByLiveSessions(
  state: AppState,
  liveSessionIds: Set<string>
): Record<ComposerDraftScope, ComposerDraft> {
  return Object.fromEntries(
    Object.entries(state.composerDraftsByScope).filter(([scope]) => {
      if (!scope.startsWith("session:")) {
        return true;
      }
      return liveSessionIds.has(scope.slice("session:".length));
    })
  );
}
