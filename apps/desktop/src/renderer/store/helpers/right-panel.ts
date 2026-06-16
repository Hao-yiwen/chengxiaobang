import type { Project } from "@chengxiaobang/shared";
import type {
  AppState,
  LegacyRightPanelMode,
  LegacyRightPanelSessionState,
  RightPanelMode,
  RightPanelPatch,
  RightPanelSessionState
} from "../types";
import {
  HOME_COMPOSER_DRAFT_SCOPE,
  resetHomePlanMode,
  switchComposerDraftScope
} from "./composer-drafts";
import { restoreHomeModelSelection } from "./model-selection";

export const CHAT_PANEL_MIN_WIDTH = 560;
export const RIGHT_PANEL_MIN_WIDTH = 300;
export const RIGHT_PANEL_MAX_WIDTH = 720;
export const RIGHT_PANEL_REVIEW_WIDTH = 640;
export const RIGHT_PANEL_FILE_WIDTH = 640;
export const DEFAULT_RIGHT_PANEL_WIDTH = 320;
const LEGACY_DEFAULT_RIGHT_PANEL_WIDTHS = new Set<number>([340, 380]);

export function rightPanelMaxWidthForContainer(containerWidth: number | undefined): number {
  if (typeof containerWidth !== "number" || !Number.isFinite(containerWidth)) {
    return RIGHT_PANEL_MAX_WIDTH;
  }
  return Math.min(
    RIGHT_PANEL_MAX_WIDTH,
    Math.max(0, Math.floor(containerWidth - CHAT_PANEL_MIN_WIDTH))
  );
}

export function clampRightPanelWidth(width: number, maxWidth = RIGHT_PANEL_MAX_WIDTH): number {
  const boundedMaxWidth = Math.max(0, Math.min(RIGHT_PANEL_MAX_WIDTH, Math.round(maxWidth)));
  if (boundedMaxWidth < RIGHT_PANEL_MIN_WIDTH) {
    return boundedMaxWidth;
  }
  return Math.min(boundedMaxWidth, Math.max(RIGHT_PANEL_MIN_WIDTH, Math.round(width)));
}

export function visibleRightPanelWidth(
  width: number,
  containerWidth: number | undefined
): number {
  return clampRightPanelWidth(width, rightPanelMaxWidthForContainer(containerWidth));
}

export function rightPanelWidthForOpen(
  currentWidth: number,
  wasOpen: boolean,
  targetWidth?: number
): number {
  const baseWidth = wasOpen ? clampRightPanelWidth(currentWidth) : DEFAULT_RIGHT_PANEL_WIDTH;
  return targetWidth ? Math.max(baseWidth, clampRightPanelWidth(targetWidth)) : baseWidth;
}

function normalizeStoredRightPanelWidth(width: number | undefined): number | undefined {
  if (width === undefined) {
    return undefined;
  }
  const normalizedWidth = LEGACY_DEFAULT_RIGHT_PANEL_WIDTHS.has(width)
    ? DEFAULT_RIGHT_PANEL_WIDTH
    : width;
  return clampRightPanelWidth(normalizedWidth);
}

function normalizeStoredRightPanelWidths(state: Partial<AppState>): Partial<AppState> {
  const normalizedRootWidth = normalizeStoredRightPanelWidth(state.rightPanelWidth);
  let sessionWidthMigrated = false;
  const rightPanelBySession = Object.fromEntries(
    Object.entries(state.rightPanelBySession ?? {}).map(([sessionId, snapshot]) => {
      const normalizedWidth = normalizeStoredRightPanelWidth(snapshot.width);
      if (normalizedWidth === snapshot.width) {
        return [sessionId, snapshot];
      }
      sessionWidthMigrated = true;
      return [
        sessionId,
        {
          ...snapshot,
          width: normalizedWidth ?? DEFAULT_RIGHT_PANEL_WIDTH
        }
      ];
    })
  );
  const rootWidthMigrated = normalizedRootWidth !== state.rightPanelWidth;
  if (!rootWidthMigrated && !sessionWidthMigrated) {
    return state;
  }
  console.info("[store] 迁移右侧面板旧宽度设置", {
    from: Array.from(LEGACY_DEFAULT_RIGHT_PANEL_WIDTHS),
    to: DEFAULT_RIGHT_PANEL_WIDTH,
    max: RIGHT_PANEL_MAX_WIDTH,
    rootWidthMigrated,
    sessionWidthMigrated
  });
  return {
    ...state,
    ...(rootWidthMigrated ? { rightPanelWidth: normalizedRootWidth } : {}),
    rightPanelBySession
  };
}

export function sanitizeLegacyProgressMode(
  mode: LegacyRightPanelMode | null | undefined
): RightPanelMode | null {
  return mode === "progress" || mode === "artifacts" ? null : mode ?? null;
}

export function stripLegacyProgressPanelState(state: Partial<AppState>): Partial<AppState> {
  const currentMode = state.rightPanelMode as LegacyRightPanelMode | null | undefined;
  const rightPanelHadFloatingMode = currentMode === "progress" || currentMode === "artifacts";
  let memoryHadFloatingMode = false;
  const rightPanelBySession = Object.fromEntries(
    Object.entries(state.rightPanelBySession ?? {}).map(([sessionId, snapshot]) => {
      const legacySnapshot = snapshot as LegacyRightPanelSessionState;
      if (legacySnapshot.mode !== "progress" && legacySnapshot.mode !== "artifacts") {
        return [sessionId, snapshot];
      }
      memoryHadFloatingMode = true;
      return [
        sessionId,
        {
          ...legacySnapshot,
          open: false,
          mode: null
        } satisfies RightPanelSessionState
      ];
    })
  );
  if (!rightPanelHadFloatingMode && !memoryHadFloatingMode) {
    return state;
  }
  console.info("[store] 迁移旧版右侧面板浮层状态", {
    rightPanelHadFloatingMode,
    memoryHadFloatingMode
  });
  return {
    ...state,
    rightPanelOpen: rightPanelHadFloatingMode ? false : state.rightPanelOpen,
    rightPanelMode: sanitizeLegacyProgressMode(currentMode),
    rightPanelBySession
  };
}

export function sanitizePersistedAppState(state: Partial<AppState>): Partial<AppState> {
  const nextState = normalizeStoredRightPanelWidths(stripLegacyProgressPanelState(state));
  if (nextState.view !== "home") {
    return nextState;
  }
  return {
    ...nextState,
    planMode: false,
    activeSessionId: undefined,
    progressPanelOpen: false,
    rightPanelOpen: false,
    rightPanelMode: null,
    previewFile: undefined,
    browserUrl: ""
  };
}

export function migrateRightPanelMemory(state: Partial<AppState>): Partial<AppState> {
  const rightPanelBySession = state.rightPanelBySession ?? {};
  const activeSessionId = state.activeSessionId;
  if (!activeSessionId || rightPanelBySession[activeSessionId]) {
    return { ...state, rightPanelBySession };
  }
  if (
    !state.rightPanelOpen &&
    !state.rightPanelMode &&
    !state.browserUrl &&
    !state.previewFile
  ) {
    return { ...state, rightPanelBySession };
  }
  return {
    ...state,
    rightPanelBySession: {
      ...rightPanelBySession,
      [activeSessionId]: {
        open: Boolean(state.rightPanelOpen),
        mode: sanitizeLegacyProgressMode(
          state.rightPanelMode as LegacyRightPanelMode | null | undefined
        ),
        width: normalizeStoredRightPanelWidth(state.rightPanelWidth) ?? DEFAULT_RIGHT_PANEL_WIDTH,
        browserUrl: state.browserUrl ?? "",
        ...(state.previewFile ? { previewFile: state.previewFile } : {})
      }
    }
  };
}

function hasPatchKey<K extends keyof RightPanelPatch>(
  patch: RightPanelPatch,
  key: K
): patch is RightPanelPatch & Required<Pick<RightPanelPatch, K>> {
  return Object.prototype.hasOwnProperty.call(patch, key);
}

function rightPanelSnapshot(state: AppState, patch: RightPanelPatch = {}): RightPanelSessionState {
  return {
    open: patch.rightPanelOpen ?? state.rightPanelOpen,
    mode: sanitizeLegacyProgressMode(patch.rightPanelMode ?? state.rightPanelMode),
    width:
      normalizeStoredRightPanelWidth(patch.rightPanelWidth ?? state.rightPanelWidth) ??
      DEFAULT_RIGHT_PANEL_WIDTH,
    browserUrl: patch.browserUrl ?? state.browserUrl,
    ...(hasPatchKey(patch, "previewFile")
      ? patch.previewFile
        ? { previewFile: patch.previewFile }
        : {}
      : state.previewFile
        ? { previewFile: state.previewFile }
        : {})
  };
}

export function rememberRightPanel(
  state: AppState,
  sessionId = state.activeSessionId,
  patch: RightPanelPatch = {}
): Record<string, RightPanelSessionState> {
  if (!sessionId) {
    return state.rightPanelBySession;
  }
  const snapshot = rightPanelSnapshot(state, patch);
  console.debug("[store] 保存会话右侧面板状态", {
    sessionId,
    open: snapshot.open,
    mode: snapshot.mode,
    previewPath: snapshot.previewFile?.path
  });
  return { ...state.rightPanelBySession, [sessionId]: snapshot };
}

/** 创建新项目（打开文件夹 / 新建空白）后选中它并回到首页的统一状态片段。 */
export function selectNewProjectState(state: AppState, project: Project, source: string) {
  return {
    rightPanelBySession: rememberRightPanel(state),
    ...switchComposerDraftScope(state, HOME_COMPOSER_DRAFT_SCOPE, source),
    ...resetHomePlanMode(source, state.planMode),
    ...restoreHomeModelSelection(state, state.providers, source),
    activeProjectId: project.id,
    activeSessionId: undefined,
    messages: [] as AppState["messages"],
    toolHistory: [] as AppState["toolHistory"],
    runHistory: [] as AppState["runHistory"],
    progressPanelOpen: false,
    rightPanelOpen: false,
    rightPanelMode: null,
    previewFile: undefined,
    browserUrl: "",
    notice: undefined,
    view: "home" as const
  };
}

export function restoredRightPanel(
  state: AppState,
  sessionId: string | undefined
): Pick<
  AppState,
  | "progressPanelOpen"
  | "rightPanelOpen"
  | "rightPanelMode"
  | "rightPanelWidth"
  | "previewFile"
  | "browserUrl"
> {
  const snapshot = sessionId ? state.rightPanelBySession[sessionId] : undefined;
  if (!snapshot) {
    const keepOpenOnSessionSwitch = Boolean(
      sessionId &&
        state.activeSessionId &&
        state.activeSessionId !== sessionId &&
        state.rightPanelOpen &&
        (state.rightPanelMode === "changes" || state.rightPanelMode === "terminal")
    );
    console.debug("[store] 目标会话没有右侧面板记忆", {
      sessionId,
      keepOpenOnSessionSwitch
    });
    return {
      progressPanelOpen: false,
      rightPanelOpen: keepOpenOnSessionSwitch,
      rightPanelMode: null,
      rightPanelWidth:
        normalizeStoredRightPanelWidth(state.rightPanelWidth) ?? DEFAULT_RIGHT_PANEL_WIDTH,
      previewFile: undefined,
      browserUrl: ""
    };
  }
  console.debug("[store] 恢复会话右侧面板状态", {
    sessionId,
    open: snapshot.open,
    mode: snapshot.mode,
    previewPath: snapshot.previewFile?.path
  });
  return {
    progressPanelOpen: false,
    rightPanelOpen: snapshot.open,
    rightPanelMode: snapshot.mode,
    rightPanelWidth: normalizeStoredRightPanelWidth(snapshot.width) ?? DEFAULT_RIGHT_PANEL_WIDTH,
    previewFile: snapshot.previewFile,
    browserUrl: snapshot.browserUrl
  };
}

export function dropRightPanelMemory(
  state: AppState,
  sessionIds: string[]
): Record<string, RightPanelSessionState> {
  if (sessionIds.length === 0) {
    return state.rightPanelBySession;
  }
  const remove = new Set(sessionIds);
  return Object.fromEntries(
    Object.entries(state.rightPanelBySession).filter(([sessionId]) => !remove.has(sessionId))
  );
}
