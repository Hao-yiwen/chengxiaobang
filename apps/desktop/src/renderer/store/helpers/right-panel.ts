import { createId, type Project } from "@chengxiaobang/shared";
import type {
  AppState,
  LegacyRightPanelMode,
  LegacyRightPanelSessionState,
  RightPanelMode,
  RightPanelPatch,
  RightPanelSessionState,
  RightPanelTab
} from "../types";
import {
  HOME_COMPOSER_DRAFT_SCOPE,
  resetHomePlanMode,
  switchComposerDraftScope
} from "./composer-drafts";
import { restoreHomeModelSelection } from "./model-selection";

export const CHAT_PANEL_MIN_WIDTH = 420;
export const RIGHT_PANEL_MIN_WIDTH = 300;
export const RIGHT_PANEL_MAX_WIDTH = 720;
export const RIGHT_PANEL_REVIEW_WIDTH = 520;
export const RIGHT_PANEL_FILE_WIDTH = 520;
export const RIGHT_PANEL_PROJECT_FILES_WIDTH = 200;
export const DEFAULT_RIGHT_PANEL_WIDTH = 320;
const LEGACY_DEFAULT_RIGHT_PANEL_WIDTHS = new Set<number>([340, 380]);

// —— Tab 纯函数：不依赖运行中的 store，便于单测 ——

/** 当前活动 tab 的 kind 镜像;无活动 tab 时为 null。 */
export function activeRightPanelTabKind(
  tabs: RightPanelTab[],
  activeTabId: string | undefined
): RightPanelMode | null {
  return tabs.find((tab) => tab.id === activeTabId)?.kind ?? null;
}

export interface OpenRightPanelTabInput {
  kind: RightPanelMode;
  title?: string;
  terminalId?: string;
}

/**
 * 打开或聚焦一个 tab:所有工具按 kind 单例,已存在则聚焦并按需更新标题。
 * 返回新的 tabs 列表与应激活的 tabId。
 */
export function openOrFocusRightPanelTab(
  tabs: RightPanelTab[],
  input: OpenRightPanelTabInput
): { tabs: RightPanelTab[]; activeTabId: string } {
  const existing = tabs.find((tab) => tab.kind === input.kind);
  if (existing) {
    const nextTabs =
      input.title && input.title !== existing.title
        ? tabs.map((tab) => (tab.id === existing.id ? { ...tab, title: input.title } : tab))
        : tabs;
    return { tabs: nextTabs, activeTabId: existing.id };
  }
  const tab: RightPanelTab = {
    id: createId("rptab"),
    kind: input.kind,
    ...(input.title ? { title: input.title } : {}),
    ...(input.terminalId ? { terminalId: input.terminalId } : {})
  };
  return { tabs: [...tabs, tab], activeTabId: tab.id };
}

/** 关闭一个 tab,并在关闭的是活动 tab 时把焦点落到相邻 tab(优先左侧)。 */
export function closeRightPanelTab(
  tabs: RightPanelTab[],
  activeTabId: string | undefined,
  tabId: string
): { tabs: RightPanelTab[]; activeTabId?: string; closed?: RightPanelTab } {
  const index = tabs.findIndex((tab) => tab.id === tabId);
  if (index < 0) {
    return { tabs, activeTabId };
  }
  const closed = tabs[index];
  const nextTabs = tabs.filter((tab) => tab.id !== tabId);
  let nextActive = activeTabId;
  if (activeTabId === tabId) {
    // 过滤后:nextTabs[index-1] 是原左邻,nextTabs[index] 是原右邻。
    nextActive = nextTabs[index - 1]?.id ?? nextTabs[index]?.id ?? undefined;
  }
  return { tabs: nextTabs, activeTabId: nextActive, closed };
}

/** 终端 tab 不能跨重启恢复；侧边会话 tab 依赖当前消息锚点，持久化前一律剔除。 */
export function persistableRightPanelTabs(tabs: RightPanelTab[]): RightPanelTab[] {
  return tabs.filter((tab) => tab.kind !== "terminal" && tab.kind !== "chat");
}

/** 旧版单值 mode → tab 列表(mode 为 null 则空列表)。 */
function tabsFromLegacyMode(mode: RightPanelMode | null): RightPanelTab[] {
  return mode ? [{ id: createId("rptab"), kind: mode }] : [];
}

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

/** 最大化时占满除左侧 sidebar 外的主工作区；容器未知时回退到常规最大宽。 */
export function maximizedRightPanelWidth(containerWidth: number | undefined): number {
  if (typeof containerWidth !== "number" || !Number.isFinite(containerWidth)) {
    return RIGHT_PANEL_MAX_WIDTH;
  }
  return Math.max(0, Math.floor(containerWidth));
}

export function rightPanelWidthForOpen(
  currentWidth: number,
  wasOpen: boolean,
  targetWidth?: number
): number {
  const baseWidth = wasOpen ? clampRightPanelWidth(currentWidth) : DEFAULT_RIGHT_PANEL_WIDTH;
  return targetWidth ? Math.max(baseWidth, clampRightPanelWidth(targetWidth)) : baseWidth;
}

export function targetRightPanelWidthForKind(kind: RightPanelMode): number | undefined {
  switch (kind) {
    case "changes":
      return RIGHT_PANEL_REVIEW_WIDTH;
    case "files":
    case "browser":
    case "terminal":
      return RIGHT_PANEL_FILE_WIDTH;
    default:
      return undefined;
  }
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

const RIGHT_PANEL_KINDS = new Set<RightPanelMode>([
  "changes",
  "terminal",
  "browser",
  "files",
  "chat"
]);

/**
 * 把一份可能是旧版(单值 mode)或新版(tabs)的会话快照统一规整为新版 tab 结构。
 * 终端 tab 一律剔除(PTY 不能跨重启恢复),宽度归一化,activeTabId 落到有效 tab。
 */
export function normalizeRightPanelSession(
  raw: LegacyRightPanelSessionState | RightPanelSessionState
): RightPanelSessionState {
  const anyRaw = raw as Partial<RightPanelSessionState> & Partial<LegacyRightPanelSessionState>;
  const width = normalizeStoredRightPanelWidth(anyRaw.width) ?? DEFAULT_RIGHT_PANEL_WIDTH;
  const browserUrl = anyRaw.browserUrl ?? "";
  const previewPart = anyRaw.previewFile ? { previewFile: anyRaw.previewFile } : {};

  if (Array.isArray(anyRaw.tabs)) {
    const tabs = persistableRightPanelTabs(anyRaw.tabs).filter((tab) =>
      RIGHT_PANEL_KINDS.has(tab.kind)
    );
    const activeTabId = tabs.some((tab) => tab.id === anyRaw.activeTabId)
      ? anyRaw.activeTabId
      : tabs[tabs.length - 1]?.id;
    return { open: Boolean(anyRaw.open), width, tabs, activeTabId, browserUrl, ...previewPart };
  }

  // 旧版单值 mode:浮层模式(progress/artifacts)直接关闭,其余转成单个 tab。
  const floating = anyRaw.mode === "progress" || anyRaw.mode === "artifacts";
  const tabs = tabsFromLegacyMode(sanitizeLegacyProgressMode(anyRaw.mode));
  return {
    open: floating ? false : Boolean(anyRaw.open),
    width,
    tabs,
    activeTabId: tabs[0]?.id,
    browserUrl,
    ...previewPart
  };
}

export function stripLegacyProgressPanelState(state: Partial<AppState>): Partial<AppState> {
  const currentMode = state.rightPanelMode as LegacyRightPanelMode | null | undefined;
  const rightPanelHadFloatingMode = currentMode === "progress" || currentMode === "artifacts";
  const rightPanelBySession = Object.fromEntries(
    Object.entries(state.rightPanelBySession ?? {}).map(([sessionId, snapshot]) => [
      sessionId,
      normalizeRightPanelSession(snapshot)
    ])
  );
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
    rightPanelTabs: [],
    rightPanelActiveTabId: undefined,
    rightPanelMaximized: false,
    previewFile: undefined,
    browserUrl: ""
  };
}

export function migrateRightPanelMemory(state: Partial<AppState>): Partial<AppState> {
  const rightPanelBySession = state.rightPanelBySession ?? {};
  // 顶层镜像:旧版只持久化了 rightPanelMode,这里据此补出 tabs/activeTabId,保证首帧一致。
  const topLevelMode = sanitizeLegacyProgressMode(
    state.rightPanelMode as LegacyRightPanelMode | null | undefined
  );
  const topLevelTabs = Array.isArray(state.rightPanelTabs)
    ? persistableRightPanelTabs(state.rightPanelTabs).filter((tab) => RIGHT_PANEL_KINDS.has(tab.kind))
    : tabsFromLegacyMode(topLevelMode);
  const topLevelActiveTabId = topLevelTabs.some((tab) => tab.id === state.rightPanelActiveTabId)
    ? state.rightPanelActiveTabId
    : topLevelTabs[topLevelTabs.length - 1]?.id;
  const topLevelPatch: Partial<AppState> = {
    rightPanelMode: activeRightPanelTabKind(topLevelTabs, topLevelActiveTabId),
    rightPanelTabs: topLevelTabs,
    rightPanelActiveTabId: topLevelActiveTabId,
    rightPanelMaximized: false
  };

  const activeSessionId = state.activeSessionId;
  if (!activeSessionId || rightPanelBySession[activeSessionId]) {
    return { ...state, ...topLevelPatch, rightPanelBySession };
  }
  if (
    !state.rightPanelOpen &&
    !state.rightPanelMode &&
    !state.browserUrl &&
    !state.previewFile
  ) {
    return { ...state, ...topLevelPatch, rightPanelBySession };
  }
  return {
    ...state,
    ...topLevelPatch,
    rightPanelBySession: {
      ...rightPanelBySession,
      [activeSessionId]: {
        open: Boolean(state.rightPanelOpen),
        width: normalizeStoredRightPanelWidth(state.rightPanelWidth) ?? DEFAULT_RIGHT_PANEL_WIDTH,
        tabs: topLevelTabs,
        activeTabId: topLevelActiveTabId,
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
  // 保存时剔除终端 tab(PTY 不可恢复),并把 activeTabId 落到剩余有效 tab。
  const rawTabs = patch.rightPanelTabs ?? state.rightPanelTabs;
  const tabs = persistableRightPanelTabs(rawTabs);
  const rawActiveTabId = hasPatchKey(patch, "rightPanelActiveTabId")
    ? patch.rightPanelActiveTabId
    : state.rightPanelActiveTabId;
  const activeTabId = tabs.some((tab) => tab.id === rawActiveTabId)
    ? rawActiveTabId
    : tabs[tabs.length - 1]?.id;
  return {
    open: patch.rightPanelOpen ?? state.rightPanelOpen,
    width:
      normalizeStoredRightPanelWidth(patch.rightPanelWidth ?? state.rightPanelWidth) ??
      DEFAULT_RIGHT_PANEL_WIDTH,
    tabs,
    activeTabId,
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
    tabCount: snapshot.tabs.length,
    activeTabId: snapshot.activeTabId,
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
    modelDebugRecords: [] as AppState["modelDebugRecords"],
    progressPanelOpen: false,
    rightPanelOpen: false,
    rightPanelMode: null,
    rightPanelTabs: [] as RightPanelTab[],
    rightPanelActiveTabId: undefined,
    rightPanelMaximized: false,
    previewFile: undefined,
    filePreviewEntrySource: undefined,
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
  | "rightPanelTabs"
  | "rightPanelActiveTabId"
  | "rightPanelMaximized"
  | "rightPanelWidth"
  | "previewFile"
  | "filePreviewEntrySource"
  | "browserUrl"
> {
  const snapshot = sessionId ? state.rightPanelBySession[sessionId] : undefined;
  if (!snapshot) {
    // 目标会话无记忆:若当前正在审查(项目级视图),为新会话开一个全新的审查 tab 延续上下文;
    // 终端不跨会话延续(PTY 与 terminalId 唯一,复用会冲突)。
    const keepChanges = Boolean(
      sessionId &&
        state.activeSessionId &&
        state.activeSessionId !== sessionId &&
        state.rightPanelOpen &&
        activeRightPanelTabKind(state.rightPanelTabs, state.rightPanelActiveTabId) === "changes"
    );
    const tabs = keepChanges
      ? [{ id: createId("rptab"), kind: "changes" as RightPanelMode }]
      : [];
    console.debug("[store] 目标会话没有右侧面板记忆", { sessionId, keepChanges });
    return {
      progressPanelOpen: false,
      rightPanelOpen: keepChanges,
      rightPanelMode: tabs[0]?.kind ?? null,
      rightPanelTabs: tabs,
      rightPanelActiveTabId: tabs[0]?.id,
      rightPanelMaximized: false,
      rightPanelWidth:
        normalizeStoredRightPanelWidth(state.rightPanelWidth) ?? DEFAULT_RIGHT_PANEL_WIDTH,
      previewFile: undefined,
      filePreviewEntrySource: undefined,
      browserUrl: ""
    };
  }
  console.debug("[store] 恢复会话右侧面板状态", {
    sessionId,
    open: snapshot.open,
    tabCount: snapshot.tabs.length,
    activeTabId: snapshot.activeTabId,
    previewPath: snapshot.previewFile?.path
  });
  return {
    progressPanelOpen: false,
    rightPanelOpen: snapshot.open,
    rightPanelMode: activeRightPanelTabKind(snapshot.tabs, snapshot.activeTabId),
    rightPanelTabs: snapshot.tabs,
    rightPanelActiveTabId: snapshot.activeTabId,
    rightPanelMaximized: false,
    rightPanelWidth: normalizeStoredRightPanelWidth(snapshot.width) ?? DEFAULT_RIGHT_PANEL_WIDTH,
    previewFile: snapshot.previewFile,
    filePreviewEntrySource: undefined,
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
