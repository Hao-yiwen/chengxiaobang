import {
  CheckMediumIcon,
  ChevronIcon,
  ChevronRightIcon,
  ClockIcon,
  CommentTextIcon,
  ComposeIcon,
  DownloadIcon,
  EllipsisHorizontalIcon,
  ExpandCornersIcon,
  ExpandInwardIcon,
  FolderIcon,
  FolderOpenOutlineIcon,
  PanelLeftOutlineIcon,
  PanelRightOutlineIcon,
  PencilOutlineIcon,
  PhoneOutlineIcon,
  PinFilledSmallIcon,
  PinOutlineIcon,
  PlusIcon,
  RefreshIcon,
  SearchIcon,
  PluginFocusCornersIcon,
  TrashIcon,
  XMarkIcon
} from "@/assets/file-type-icons";
import { SettingOutlined } from "@ant-design/icons";
import {
  useEffect,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode
} from "react";
import { useTranslation } from "react-i18next";
import type { GitInfo, Project, Session } from "@chengxiaobang/shared";
import { useShallow } from "zustand/react/shallow";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { useConfirmDialog } from "@/components/ConfirmDialog";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { runAfterMenuClose } from "@/lib/menu-actions";
import { cn } from "@/lib/utils";
import { getApiClient, useAppStore, type ProjectSortMode } from "@/store";

type ProjectSessionGroup = { project: Project; sessions: Session[] };
type ProjectGitInfoState =
  | { status: "loading" }
  | { status: "loaded"; info: GitInfo }
  | { status: "error" };
type ProjectSessionTooltipInfo = { projectPath: string; branchName?: string };

const DEFAULT_SIDEBAR_WIDTH = 272;
const MIN_SIDEBAR_WIDTH = 240;
const DEFAULT_VISIBLE_PROJECT_COUNT = 4;
const DEFAULT_VISIBLE_SESSION_COUNT = 6;

function clampSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) {
    return DEFAULT_SIDEBAR_WIDTH;
  }
  return Math.max(MIN_SIDEBAR_WIDTH, Math.round(width));
}

/** 左侧边栏的折叠/展开按钮：固定悬浮在窗口左上角，折叠前后位置不变。 */
export function SidebarToggle() {
  const { t } = useTranslation();
  const open = useAppStore((state) => state.sidebarOpen);
  const toggleSidebar = useAppStore((state) => state.toggleSidebar);
  const isMacDesktop = window.chengxiaobang?.platform === "darwin";
  return (
    <button
      type="button"
      title={open ? t("sidebar.collapse") : t("sidebar.expand")}
      onClick={() => {
        console.debug("[sidebar] 切换侧边栏", { openBefore: open });
        toggleSidebar();
      }}
      className={cn(
        "fixed z-[60] flex size-7 items-center justify-center rounded-xs text-muted-foreground transition-colors hover:bg-canvas-soft-2 hover:text-foreground [-webkit-app-region:no-drag] max-[840px]:hidden",
        isMacDesktop ? "left-[84px] top-[12px]" : "left-3 top-3"
      )}
    >
      {open ? <PanelLeftOutlineIcon className="size-4" /> : <PanelRightOutlineIcon className="size-4" />}
    </button>
  );
}

/** 侧边栏扁平行：图标 + 文案，用于新对话/搜索/设置等固定入口。 */
function SidebarRow(props: {
  icon: ReactNode;
  label: string;
  active?: boolean;
  compactLabel?: boolean;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      aria-current={props.active ? "page" : undefined}
      onClick={props.onClick}
      className={cn(
        "flex w-full flex-none items-center rounded-sm text-left text-foreground transition-colors hover:bg-surface-hover",
        props.compactLabel ? "h-7 gap-1.5 px-2 text-body-sm" : "h-8 gap-2 px-2.5 text-body-xs",
        props.active && "bg-surface-hover font-[500]"
      )}
    >
      <span className="flex size-4 flex-none items-center justify-center [&_svg]:size-4 [&_svg]:stroke-[1.75]">
        {props.icon}
      </span>
      <span className="truncate">{props.label}</span>
    </button>
  );
}

/**
 * 区块小标签：区块之间靠留白切分，不再使用分隔线。
 * 传入 onAction 时，悬停标签行右侧浮出加号（如「对话」新建会话、「项目」打开文件夹）。
 */
function SectionLabel(props: {
  children: ReactNode;
  className?: string;
  actionLabel?: string;
  onAction?(): void;
}) {
  return (
    <div
      className={cn(
        "group/section relative mb-1 flex items-center px-2.5 font-mono text-caption tracking-[0.28px] text-mute",
        props.className
      )}
    >
      <span className="min-w-0 truncate">{props.children}</span>
      {props.onAction ? (
        <button
          type="button"
          title={props.actionLabel}
          onClick={props.onAction}
          className="absolute right-1 flex size-5 flex-none items-center justify-center rounded-xs text-muted-slate opacity-0 transition-opacity hover:text-foreground group-hover/section:opacity-100"
        >
          <PlusIcon className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}

function latestProjectActivityAt(group: ProjectSessionGroup): string {
  return group.sessions.reduce(
    (latest, session) => (session.updatedAt > latest ? session.updatedAt : latest),
    group.project.updatedAt
  );
}

function isPhoneBoundSession(session: Session): boolean {
  return Boolean(session.feishuChatId || session.wechatChatId);
}

function compareProjectGroups(
  left: ProjectSessionGroup,
  right: ProjectSessionGroup,
  mode: ProjectSortMode
): number {
  if (mode === "recent") {
    const recent = latestProjectActivityAt(right).localeCompare(latestProjectActivityAt(left));
    if (recent !== 0) {
      return recent;
    }
  }
  const created = right.project.createdAt.localeCompare(left.project.createdAt);
  if (created !== 0) {
    return created;
  }
  return (
    left.project.name.localeCompare(right.project.name) ||
    left.project.id.localeCompare(right.project.id)
  );
}

function ProjectSectionLabel(props: {
  className?: string;
  allCollapsed: boolean;
  canToggleAll: boolean;
  sortMode: ProjectSortMode;
  onToggleAll(): void;
  onSortModeChange(mode: ProjectSortMode): void;
  onOpenFolder(): void;
}) {
  const { t } = useTranslation();
  const toggleLabel = props.allCollapsed
    ? t("sidebar.expandAllProjects")
    : t("sidebar.collapseAllProjects");
  const selectSortMode = (mode: ProjectSortMode) => {
    if (mode === props.sortMode) {
      return;
    }
    props.onSortModeChange(mode);
  };
  return (
    <div
      className={cn(
        "group/section relative mb-1 flex items-center px-2.5 font-mono text-caption tracking-[0.28px] text-mute",
        props.className
      )}
    >
      <span className="min-w-0 truncate pr-16">{t("sidebar.projects")}</span>
      <div className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5 opacity-0 transition-opacity group-hover/section:opacity-100 focus-within:opacity-100">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={toggleLabel}
              disabled={!props.canToggleAll}
              onClick={props.onToggleAll}
              className="flex size-6 flex-none items-center justify-center rounded-xs p-1 text-muted-slate transition-colors hover:bg-canvas-soft-2 hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
            >
              {props.allCollapsed ? (
                <ExpandCornersIcon className="size-4" />
              ) : (
                <ExpandInwardIcon className="size-4" />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent>{toggleLabel}</TooltipContent>
        </Tooltip>
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={t("sidebar.projectSortMenu")}
                  className="flex size-6 flex-none items-center justify-center rounded-xs p-1 text-muted-slate transition-colors hover:bg-canvas-soft-2 hover:text-foreground data-[state=open]:bg-canvas-soft-2 data-[state=open]:text-foreground"
                >
                  <EllipsisHorizontalIcon className="size-4" />
                </button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>{t("sidebar.projectSortMenu")}</TooltipContent>
          </Tooltip>
          <DropdownMenuContent
            side="right"
            align="start"
            sideOffset={8}
            className="min-w-[136px]"
          >
            <DropdownMenuItem onSelect={() => selectSortMode("created")}>
              <span>{t("sidebar.sortByCreated")}</span>
              {props.sortMode === "created" ? <CheckMediumIcon className="ml-auto size-3.5" /> : null}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => selectSortMode("recent")}>
              <span>{t("sidebar.sortByRecent")}</span>
              {props.sortMode === "recent" ? <CheckMediumIcon className="ml-auto size-3.5" /> : null}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={t("sidebar.openFolder")}
              onClick={props.onOpenFolder}
              className="flex size-6 flex-none items-center justify-center rounded-xs p-1 text-muted-slate transition-colors hover:bg-canvas-soft-2 hover:text-foreground"
            >
              <PlusIcon className="size-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>{t("sidebar.openFolder")}</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}

function SidebarMoreButton(props: {
  label: string;
  title?: string;
  indent?: boolean;
  loading?: boolean;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      title={props.title ?? props.label}
      disabled={props.loading}
      onClick={props.onClick}
      className={cn(
        "mx-1 mb-1 flex h-6 w-[calc(100%-0.5rem)] items-center rounded-sm px-2 text-left text-micro text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-50",
        props.indent ? "pl-7" : "pl-2.5"
      )}
    >
      <span className="truncate">{props.label}</span>
    </button>
  );
}

export function Sidebar() {
  const { t } = useTranslation();
  const confirmDialog = useConfirmDialog();
  const sidebarOpen = useAppStore((state) => state.sidebarOpen);
  const {
    projects,
    sessions,
    activeSessionId,
    activeProjectId,
    view,
    runningSessionsById,
    clientReady,
    projectSortMode,
    sidebarProjectsExpanded,
    sidebarExpandedProjectSessionIds,
    sidebarUngroupedExpanded,
    sidebarProjectsPage,
    sidebarUngroupedSessionsPage,
    sidebarProjectSessionsPageByProjectId
  } = useAppStore(
    useShallow((state) => ({
      projects: state.projects,
      sessions: state.sessions,
      activeSessionId: state.activeSessionId,
      activeProjectId: state.activeProjectId,
      view: state.view,
      runningSessionsById: state.runningSessionsById,
      clientReady: state.clientReady,
      projectSortMode: state.projectSortMode,
      sidebarProjectsExpanded: state.sidebarProjectsExpanded,
      sidebarExpandedProjectSessionIds: state.sidebarExpandedProjectSessionIds,
      sidebarUngroupedExpanded: state.sidebarUngroupedExpanded,
      sidebarProjectsPage: state.sidebarProjectsPage,
      sidebarUngroupedSessionsPage: state.sidebarUngroupedSessionsPage,
      sidebarProjectSessionsPageByProjectId: state.sidebarProjectSessionsPageByProjectId
    }))
  );
  const newChat = useAppStore((state) => state.newChat);
  const newChatInProject = useAppStore((state) => state.newChatInProject);
  const openFolder = useAppStore((state) => state.openFolder);
  const setPaletteOpen = useAppStore((state) => state.setPaletteOpen);
  const setView = useAppStore((state) => state.setView);
  const setActiveProjectId = useAppStore((state) => state.setActiveProjectId);
  const selectSession = useAppStore((state) => state.selectSession);
  const renameSession = useAppStore((state) => state.renameSession);
  const deleteSession = useAppStore((state) => state.deleteSession);
  const exportSession = useAppStore((state) => state.exportSession);
  const deleteProject = useAppStore((state) => state.deleteProject);
  const renameProject = useAppStore((state) => state.renameProject);
  const setSessionPinned = useAppStore((state) => state.setSessionPinned);
  const setProjectPinned = useAppStore((state) => state.setProjectPinned);
  const setProjectSortMode = useAppStore((state) => state.setProjectSortMode);
  const setSidebarProjectsExpanded = useAppStore((state) => state.setSidebarProjectsExpanded);
  const setSidebarProjectSessionsExpanded = useAppStore(
    (state) => state.setSidebarProjectSessionsExpanded
  );
  const setSidebarUngroupedExpanded = useAppStore(
    (state) => state.setSidebarUngroupedExpanded
  );
  const resetSidebarExpansion = useAppStore((state) => state.resetSidebarExpansion);
  const loadData = useAppStore((state) => state.loadData);
  const loadMoreSidebarProjects = useAppStore((state) => state.loadMoreSidebarProjects);
  const loadMoreSidebarProjectSessions = useAppStore(
    (state) => state.loadMoreSidebarProjectSessions
  );
  const loadMoreSidebarUngroupedSessions = useAppStore(
    (state) => state.loadMoreSidebarUngroupedSessions
  );

  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [resizing, setResizing] = useState(false);
  const [editingId, setEditingId] = useState<string>();
  const [draftTitle, setDraftTitle] = useState("");
  const [editingProjectId, setEditingProjectId] = useState<string>();
  const [projectDraft, setProjectDraft] = useState("");
  const [collapsedProjectIds, setCollapsedProjectIds] = useState<Set<string>>(() => new Set());
  const [loadingMoreProjects, setLoadingMoreProjects] = useState(false);
  const [loadingProjectSessionIds, setLoadingProjectSessionIds] = useState<Set<string>>(
    () => new Set()
  );
  const [loadingUngrouped, setLoadingUngrouped] = useState(false);
  const [projectGitInfoByProjectId, setProjectGitInfoByProjectId] = useState<
    Record<string, ProjectGitInfoState>
  >({});

  // 手机绑定会话由「连接手机」页直接管理，不进入左侧项目/对话/置顶列表。
  const sidebarSessions = sessions.filter((session) => !isPhoneBoundSession(session));

  // 置顶项只在置顶区展示，原「项目」/「对话」区域不再重复出现。
  const ungrouped = sidebarSessions.filter((session) => !session.projectId && !session.pinnedAt);
  const projectSessions = projects.map((project) => ({
    project,
    sessions: sidebarSessions.filter((session) => session.projectId === project.id)
  }));
  const allProjectIds = projectSessions.map(({ project }) => project.id);
  const allProjectGroupsCollapsed =
    allProjectIds.length > 0 && allProjectIds.every((id) => collapsedProjectIds.has(id));

  // 置顶区：项目组在前、单会话在后，各按置顶时间降序（ISO 字符串可直接字典序比较）。
  // 被单独置顶的会话以单行展示，置顶项目组内不再重复。
  const pinnedProjects = projectSessions
    .filter(({ project }) => project.pinnedAt)
    .map(({ project, sessions: list }) => ({
      project,
      sessions: list.filter((session) => !session.pinnedAt)
    }))
    .sort((a, b) => b.project.pinnedAt!.localeCompare(a.project.pinnedAt!));
  const pinnedSessions = sidebarSessions
    .filter((session) => session.pinnedAt)
    .sort((a, b) => b.pinnedAt!.localeCompare(a.pinnedAt!));
  const hasPinned = pinnedProjects.length > 0 || pinnedSessions.length > 0;

  // 项目区只展示未置顶项目，组内排除已单独置顶的会话。
  const unpinnedProjects = projectSessions
    .filter(({ project }) => !project.pinnedAt)
    .sort((left, right) => compareProjectGroups(left, right, projectSortMode))
    .map(({ project, sessions: list }) => ({
      project,
      sessions: list.filter((session) => !session.pinnedAt)
    }));
  const visibleUnpinnedProjects = sidebarProjectsExpanded
    ? unpinnedProjects
    : unpinnedProjects.slice(0, DEFAULT_VISIBLE_PROJECT_COUNT);
  const canToggleMoreProjects =
    unpinnedProjects.length > DEFAULT_VISIBLE_PROJECT_COUNT ||
    sidebarProjectsPage.hasMore ||
    sidebarProjectsPage.total > DEFAULT_VISIBLE_PROJECT_COUNT;
  const visibleUngrouped = sidebarUngroupedExpanded
    ? ungrouped
    : ungrouped.slice(0, DEFAULT_VISIBLE_SESSION_COUNT);
  const canToggleMoreUngrouped =
    ungrouped.length > DEFAULT_VISIBLE_SESSION_COUNT ||
    sidebarUngroupedSessionsPage.hasMore ||
    sidebarUngroupedSessionsPage.total > DEFAULT_VISIBLE_SESSION_COUNT;

  // 分支标记需要跨全部会话查找父会话标题。
  const titleById = new Map(sessions.map((session) => [session.id, session.title]));
  const projectIdsWithVisibleSessions = [...pinnedProjects, ...visibleUnpinnedProjects]
    .filter(({ sessions: list }) => list.length > 0)
    .map(({ project }) => project.id);
  const projectGitInfoLoadKey = projectIdsWithVisibleSessions.join("\u0000");

  useEffect(() => {
    if (!clientReady || projectIdsWithVisibleSessions.length === 0) {
      return;
    }
    const client = getApiClient();
    if (!client?.getGitInfo) {
      console.debug("[sidebar] Git 信息接口不可用，项目会话提示仅展示路径", {
        projectCount: projectIdsWithVisibleSessions.length
      });
      return;
    }
    const pendingProjectIds = projectIdsWithVisibleSessions.filter(
      (projectId) => !projectGitInfoByProjectId[projectId]
    );
    if (pendingProjectIds.length === 0) {
      return;
    }
    setProjectGitInfoByProjectId((current) => {
      const next = { ...current };
      for (const projectId of pendingProjectIds) {
        next[projectId] = { status: "loading" };
      }
      return next;
    });
    for (const projectId of pendingProjectIds) {
      const project = projects.find((item) => item.id === projectId);
      console.debug("[sidebar] 开始读取项目会话提示 Git 信息", {
        projectId,
        path: project?.path
      });
      void client.getGitInfo(projectId).then(
        (info) => {
          console.debug("[sidebar] 项目会话提示 Git 信息读取完成", {
            projectId,
            isRepo: info.isRepo,
            hasBranchName: Boolean(info.branchName)
          });
          setProjectGitInfoByProjectId((current) => ({
            ...current,
            [projectId]: { status: "loaded", info }
          }));
        },
        (error) => {
          const message = error instanceof Error ? error.message : String(error);
          console.warn("[sidebar] 项目会话提示 Git 信息读取失败", {
            projectId,
            error: message
          });
          setProjectGitInfoByProjectId((current) => ({
            ...current,
            [projectId]: { status: "error" }
          }));
        }
      );
    }
  }, [
    clientReady,
    projectGitInfoByProjectId,
    projectGitInfoLoadKey,
    projectIdsWithVisibleSessions.length,
    projects
  ]);

  function startRename(session: Session): void {
    setEditingId(session.id);
    setDraftTitle(session.title);
  }

  async function commitRename(): Promise<void> {
    if (!editingId) {
      return;
    }
    const title = draftTitle.trim();
    if (title) {
      await renameSession(editingId, title);
    }
    setEditingId(undefined);
  }

  async function onDelete(id: string): Promise<void> {
    console.debug("[sidebar] 请求删除会话", { id });
    const confirmed = await confirmDialog({
      title: t("sidebar.deleteTitle"),
      description: t("sidebar.deleteConfirm"),
      confirmLabel: t("sidebar.confirmDelete"),
      cancelLabel: t("sidebar.cancel"),
      tone: "danger",
      source: "sidebar.deleteSession"
    });
    if (!confirmed) {
      console.debug("[sidebar] 用户取消删除会话", { id });
      return;
    }
    console.debug("[sidebar] 用户确认删除会话", { id });
    void deleteSession(id);
  }

  async function onDeleteProject(id: string): Promise<void> {
    console.debug("[sidebar] 请求删除项目", { id });
    const confirmed = await confirmDialog({
      title: t("sidebar.deleteProjectTitle"),
      description: t("sidebar.deleteProjectConfirm"),
      confirmLabel: t("sidebar.confirmDelete"),
      cancelLabel: t("sidebar.cancel"),
      tone: "danger",
      source: "sidebar.deleteProject"
    });
    if (!confirmed) {
      console.debug("[sidebar] 用户取消删除项目", { id });
      return;
    }
    console.debug("[sidebar] 用户确认删除项目", { id });
    void deleteProject(id);
  }

  async function commitRenameProject(): Promise<void> {
    if (!editingProjectId) {
      return;
    }
    const name = projectDraft.trim();
    if (name) {
      await renameProject(editingProjectId, name);
    }
    setEditingProjectId(undefined);
  }

  function setProjectOpen(project: Project, open: boolean): void {
    console.debug("[sidebar] 切换项目组折叠状态", {
      projectId: project.id,
      name: project.name,
      open
    });
    setCollapsedProjectIds((current) => {
      const next = new Set(current);
      if (open) {
        next.delete(project.id);
      } else {
        next.add(project.id);
      }
      return next;
    });
  }

  function toggleAllProjectGroups(): void {
    const shouldExpand = allProjectGroupsCollapsed;
    console.info("[sidebar] 批量切换项目组折叠状态", {
      action: shouldExpand ? "expand" : "collapse",
      projectCount: allProjectIds.length
    });
    setCollapsedProjectIds((current) => {
      const next = new Set(current);
      for (const id of allProjectIds) {
        if (shouldExpand) {
          next.delete(id);
        } else {
          next.add(id);
        }
      }
      return next;
    });
  }

  async function toggleProjectsExpanded(): Promise<void> {
    if (sidebarProjectsExpanded) {
      console.debug("[sidebar] 折叠项目区显示数量", {
        visibleLimit: DEFAULT_VISIBLE_PROJECT_COUNT
      });
      setSidebarProjectsExpanded(false);
      return;
    }
    try {
      if (sidebarProjectsPage.hasMore) {
        setLoadingMoreProjects(true);
        console.info("[sidebar] 展开项目区并加载剩余项目", {
          loaded: sidebarProjectsPage.loaded,
          total: sidebarProjectsPage.total
        });
        await loadMoreSidebarProjects();
      }
      setSidebarProjectsExpanded(true);
    } catch (error) {
      console.warn("[sidebar] 展开项目区失败", {
        error: error instanceof Error ? error.message : String(error)
      });
    } finally {
      setLoadingMoreProjects(false);
    }
  }

  async function toggleProjectSessionsExpanded(projectId: string): Promise<void> {
    if (sidebarExpandedProjectSessionIds[projectId]) {
      console.debug("[sidebar] 折叠项目会话显示数量", {
        projectId,
        visibleLimit: DEFAULT_VISIBLE_SESSION_COUNT
      });
      setSidebarProjectSessionsExpanded(projectId, false);
      return;
    }
    try {
      const page = sidebarProjectSessionsPageByProjectId[projectId];
      if (page?.hasMore) {
        setLoadingProjectSessionIds((current) => new Set(current).add(projectId));
        console.info("[sidebar] 展开项目会话并加载剩余会话", {
          projectId,
          loaded: page.loaded,
          total: page.total
        });
        await loadMoreSidebarProjectSessions(projectId);
      }
      setSidebarProjectSessionsExpanded(projectId, true);
    } catch (error) {
      console.warn("[sidebar] 展开项目会话失败", {
        projectId,
        error: error instanceof Error ? error.message : String(error)
      });
    } finally {
      setLoadingProjectSessionIds((current) => {
        const next = new Set(current);
        next.delete(projectId);
        return next;
      });
    }
  }

  async function toggleUngroupedSessionsExpanded(): Promise<void> {
    if (sidebarUngroupedExpanded) {
      console.debug("[sidebar] 折叠普通对话显示数量", {
        visibleLimit: DEFAULT_VISIBLE_SESSION_COUNT
      });
      setSidebarUngroupedExpanded(false);
      return;
    }
    try {
      if (sidebarUngroupedSessionsPage.hasMore) {
        setLoadingUngrouped(true);
        console.info("[sidebar] 展开普通对话并加载剩余对话", {
          loaded: sidebarUngroupedSessionsPage.loaded,
          total: sidebarUngroupedSessionsPage.total
        });
        await loadMoreSidebarUngroupedSessions();
      }
      setSidebarUngroupedExpanded(true);
    } catch (error) {
      console.warn("[sidebar] 展开普通对话失败", {
        error: error instanceof Error ? error.message : String(error)
      });
    } finally {
      setLoadingUngrouped(false);
    }
  }

  function changeProjectSortMode(mode: ProjectSortMode): void {
    if (mode === projectSortMode) {
      return;
    }
    console.info("[sidebar] 切换项目排序并重置侧边栏分页", { mode });
    resetSidebarExpansion();
    setProjectSortMode(mode);
    void loadData();
  }

  function openProjectHome(project: Project): void {
    console.info("[sidebar] 进入项目首页", {
      projectId: project.id,
      name: project.name
    });
    setActiveProjectId(project.id);
  }

  function renderSession(
    session: Session,
    indent: boolean,
    projectTooltipInfo?: ProjectSessionTooltipInfo
  ): ReactNode {
    const branchHint = session.parentSessionId
      ? titleById.has(session.parentSessionId)
        ? t("sidebar.branchOf", { title: titleById.get(session.parentSessionId) })
        : t("sidebar.branchUnknown")
      : undefined;
    return (
      <SessionRow
        key={session.id}
        session={session}
        indent={indent}
        active={view === "chat" && session.id === activeSessionId}
        running={Boolean(runningSessionsById[session.id])}
        notice={session.notice}
        pendingAction={session.pendingAction}
        editing={editingId === session.id}
        draftTitle={draftTitle}
        branchHint={branchHint}
        projectTooltipInfo={projectTooltipInfo}
        onSelect={() => void selectSession(session.id)}
        onStartRename={() => startRename(session)}
        onDraftChange={setDraftTitle}
        onCommitRename={() => void commitRename()}
        onCancelRename={() => setEditingId(undefined)}
        onDelete={() => void onDelete(session.id)}
        onExport={() => void exportSession(session.id)}
        onTogglePin={() => void setSessionPinned(session.id, !session.pinnedAt)}
      />
    );
  }

  // 置顶区与项目区共用：置顶区不截断；项目区默认展示前 6 条会话。
  // 注意：同一会话/项目双份显示时，editingId/editingProjectId 共享会让两份同时进入
  // 行内编辑态——受控同值，提交一次生效，接受这个行为。
  function renderProjectGroup(
    project: Project,
    projectSessionList: Session[],
    opts: { sessionLimit?: number }
  ): ReactNode {
    const expanded = Boolean(sidebarExpandedProjectSessionIds[project.id]);
    const page = sidebarProjectSessionsPageByProjectId[project.id];
    const sessionLimit = opts.sessionLimit;
    const visible =
      sessionLimit !== undefined && !expanded
        ? projectSessionList.slice(0, sessionLimit)
        : projectSessionList;
    const canToggleMore =
      sessionLimit !== undefined &&
      (projectSessionList.length > sessionLimit ||
        Boolean(page?.hasMore) ||
        (page?.total ?? 0) > sessionLimit);
    const gitInfoState = projectGitInfoByProjectId[project.id];
    const branchName =
      gitInfoState?.status === "loaded" ? gitInfoState.info.branchName?.trim() : undefined;
    const projectTooltipInfo = {
      projectPath: project.path,
      ...(branchName ? { branchName } : {})
    };
    return (
      <ProjectGroup
        key={project.id}
        name={project.name}
        pinned={Boolean(project.pinnedAt)}
        active={view === "home" && activeProjectId === project.id}
        open={!collapsedProjectIds.has(project.id)}
        editing={editingProjectId === project.id}
        draftName={projectDraft}
        onOpenChange={(open) => setProjectOpen(project, open)}
        onSelectProject={() => openProjectHome(project)}
        onNewChat={() => newChatInProject(project.id)}
        onStartRename={() => {
          setEditingProjectId(project.id);
          setProjectDraft(project.name);
        }}
        onDraftChange={setProjectDraft}
        onCommitRename={() => void commitRenameProject()}
        onCancelRename={() => setEditingProjectId(undefined)}
        onTogglePin={() => void setProjectPinned(project.id, !project.pinnedAt)}
        onDelete={() => void onDeleteProject(project.id)}
      >
        {projectSessionList.length === 0 ? (
          <button
            type="button"
            onClick={() => openProjectHome(project)}
            className="mx-1 mb-0.5 flex h-7 min-w-0 cursor-pointer items-center rounded-sm pl-7 pr-2 text-left text-micro text-foreground"
          >
            <span className="truncate">{t("sidebar.noChats")}</span>
          </button>
        ) : (
          <>
            {visible.map((session) => renderSession(session, true, projectTooltipInfo))}
            {canToggleMore ? (
              <SidebarMoreButton
                indent
                loading={loadingProjectSessionIds.has(project.id)}
                label={
                  expanded
                    ? t("sidebar.collapseVisibleSessions")
                    : t("sidebar.expandMoreSessions")
                }
                onClick={() => void toggleProjectSessionsExpanded(project.id)}
              />
            ) : null}
          </>
        )}
      </ProjectGroup>
    );
  }

  const visualSidebarWidth = clampSidebarWidth(sidebarWidth);
  const sidebarStyle = {
    "--sidebar-width": `${visualSidebarWidth}px`,
    width: sidebarOpen ? "var(--sidebar-width)" : "0px"
  } as CSSProperties & { "--sidebar-width": string };

  function onResizeStart(event: ReactPointerEvent<HTMLDivElement>): void {
    if (!sidebarOpen) {
      return;
    }
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = visualSidebarWidth;
    let latestWidth = startWidth;
    console.debug("[sidebar] 开始拖拽调整宽度", {
      startWidth,
      minWidth: MIN_SIDEBAR_WIDTH
    });
    setResizing(true);

    const onMove = (move: globalThis.PointerEvent) => {
      latestWidth = clampSidebarWidth(startWidth + (move.clientX - startX));
      setSidebarWidth(latestWidth);
    };
    const onStop = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onStop);
      window.removeEventListener("pointercancel", onStop);
      setResizing(false);
      console.debug("[sidebar] 结束拖拽调整宽度", { width: latestWidth });
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onStop, { once: true });
    window.addEventListener("pointercancel", onStop, { once: true });
  }

  return (
    // 折叠 = 外层宽度动画收到 0；内容固定在当前宽度的内层里，动画期间不会被压扁。
    // 折叠态保持挂载以便展开动画，用 inert + aria-hidden 屏蔽交互与无障碍树。
    <aside
      data-testid="app-sidebar"
      aria-hidden={!sidebarOpen}
      inert={!sidebarOpen}
      style={sidebarStyle}
      className={cn(
        "relative h-full min-h-0 flex-none overflow-hidden bg-background max-[840px]:hidden",
        !resizing && "transition-[width] duration-200 ease-out",
        sidebarOpen && "border-r border-border"
      )}
    >
      <div className="flex h-full min-h-0 w-[var(--sidebar-width)] flex-col px-3 pb-3">
      {/* macOS hiddenInset 标题栏会占据左上角；这里预留一条空白，
          给系统按钮和悬浮的 SidebarToggle 留出位置。注意不能挂 app-region:drag——
          它会盖住折叠按钮并抢走点击（窗口拖拽由 .titlebar-drag 提供）。 */}
      <div className="h-10 flex-none" />

      <div className="mt-1 flex-none space-y-0.5">
        <SidebarRow icon={<ComposeIcon />} label={t("sidebar.newChat")} compactLabel onClick={newChat} />
        <SidebarRow icon={<SearchIcon />} label={t("sidebar.search")} compactLabel onClick={() => setPaletteOpen(true)} />
        <SidebarRow
          icon={<ClockIcon />}
          label={t("sidebar.tasks")}
          compactLabel
          active={view === "tasks"}
          onClick={() => setView("tasks")}
        />
        <SidebarRow
          icon={<PluginFocusCornersIcon />}
          label={t("sidebar.plugins")}
          compactLabel
          active={view === "plugins"}
          onClick={() => setView("plugins")}
        />
        <SidebarRow
          icon={<PhoneOutlineIcon />}
          label={t("sidebar.connectPhone")}
          compactLabel
          active={view === "connectPhone"}
          onClick={() => setView("connectPhone")}
        />
      </div>

      {/* 原生滚动：Radix ScrollArea 的 viewport 会用 display:table 按内容宽排版，
          导致行的 absolute 悬停按钮相对超宽容器定位、右侧被裁，故改回原生滚动。 */}
      <div className="relative -mx-1 mt-4 min-h-0 flex-1">
        <div
          data-scrollbar-hidden="true"
          className="sidebar-scroll-area h-full min-h-0 overflow-y-auto px-1 pb-6 font-normal"
        >
          {hasPinned ? (
            <>
              <SectionLabel>{t("sidebar.pinned")}</SectionLabel>
              {pinnedProjects.map(({ project, sessions: projectSessionList }) =>
                renderProjectGroup(project, projectSessionList, {})
              )}
              {pinnedSessions.map((session) => renderSession(session, false))}
            </>
          ) : null}
          <ProjectSectionLabel
            className={hasPinned ? "mt-6" : undefined}
            allCollapsed={allProjectGroupsCollapsed}
            canToggleAll={allProjectIds.length > 0}
            sortMode={projectSortMode}
            onToggleAll={toggleAllProjectGroups}
            onSortModeChange={changeProjectSortMode}
            onOpenFolder={() => {
              console.debug("[sidebar] 点击「项目」区块加号，打开文件夹选择");
              void openFolder();
            }}
          />
          {visibleUnpinnedProjects.map(({ project, sessions: projectSessionList }) =>
            renderProjectGroup(project, projectSessionList, {
              sessionLimit: DEFAULT_VISIBLE_SESSION_COUNT
            })
          )}
          {canToggleMoreProjects ? (
            <SidebarMoreButton
              loading={loadingMoreProjects}
              label={
                sidebarProjectsExpanded
                  ? t("sidebar.collapseVisibleProjects")
                  : t("sidebar.expandMore")
              }
              onClick={() => void toggleProjectsExpanded()}
            />
          ) : null}
          {projects.length === 0 ? (
            <p className="px-2.5 py-1 text-micro text-foreground">{t("sidebar.noProjects")}</p>
          ) : null}

          <SectionLabel
            className="mt-6"
            actionLabel={t("sidebar.newChat")}
            onAction={() => {
              console.debug("[sidebar] 点击「对话」区块加号，新建对话");
              newChat();
            }}
          >
            {t("sidebar.conversations")}
          </SectionLabel>
          {ungrouped.length === 0 ? (
            <p className="px-2.5 py-1 text-micro text-foreground">{t("sidebar.noChats")}</p>
          ) : (
            <>
              {visibleUngrouped.map((session) => renderSession(session, false))}
              {canToggleMoreUngrouped ? (
                <SidebarMoreButton
                  loading={loadingUngrouped}
                  label={
                    sidebarUngroupedExpanded
                      ? t("sidebar.collapseVisibleSessions")
                      : t("sidebar.expandMoreSessions")
                  }
                  onClick={() => void toggleUngroupedSessionsExpanded()}
                />
              ) : null}
            </>
          )}
        </div>
        <div
          data-sidebar-bottom-fade="true"
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 -bottom-3 h-5 bg-gradient-to-b from-background/0 via-background/80 to-background"
        />
      </div>

      <div className="mt-2 flex-none pt-2">
        <SidebarRow
          icon={<SettingOutlined />}
          label={t("sidebar.settings")}
          active={view === "settings"}
          onClick={() => setView("settings")}
        />
      </div>
      {sidebarOpen ? (
        <div
          role="separator"
          aria-orientation="vertical"
          title={t("sidebar.resize")}
          onPointerDown={onResizeStart}
          className="absolute right-0 top-0 z-10 h-full w-1.5 cursor-col-resize"
        />
      ) : null}
      </div>
    </aside>
  );
}

/**
 * 可折叠的项目分组：组头是项目名，悬停时右侧浮出「新建会话」加号；
 * 右键组头弹出菜单提供重命名 / 置顶 / 删除；重命名时组头切换为行内输入框。
 */
function ProjectGroup(props: {
  name: string;
  /** 当前置顶状态，决定菜单项显示「置顶」还是「取消置顶」。 */
  pinned: boolean;
  active: boolean;
  open: boolean;
  editing: boolean;
  draftName: string;
  onOpenChange(open: boolean): void;
  onSelectProject(): void;
  onNewChat(): void;
  onStartRename(): void;
  onDraftChange(value: string): void;
  onCommitRename(): void;
  onCancelRename(): void;
  onTogglePin(): void;
  onDelete(): void;
  children: ReactNode;
}) {
  const { t } = useTranslation();

  if (props.editing) {
    return (
      <Collapsible open={props.open} onOpenChange={props.onOpenChange} className="mb-1">
        <div className="flex items-center gap-1 py-1 pl-1.5 pr-1">
          <FolderIcon className="size-4 flex-none text-foreground" />
          <Input
            aria-label={t("sidebar.projectName")}
            autoFocus
            value={props.draftName}
            onChange={(event) => props.onDraftChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") props.onCommitRename();
              if (event.key === "Escape") props.onCancelRename();
            }}
            className="h-7"
          />
          <button
            type="button"
            title={t("sidebar.saveTitle")}
            onClick={props.onCommitRename}
            className="flex size-6 flex-none items-center justify-center rounded-xs text-muted-foreground hover:bg-canvas-soft-2 hover:text-foreground"
          >
            <CheckMediumIcon className="size-4" />
          </button>
          <button
            type="button"
            title={t("sidebar.cancelRename")}
            onClick={props.onCancelRename}
            className="flex size-6 flex-none items-center justify-center rounded-xs text-muted-foreground hover:bg-canvas-soft-2 hover:text-foreground"
          >
            <XMarkIcon className="size-4" />
          </button>
        </div>
        <CollapsibleContent>{props.children}</CollapsibleContent>
      </Collapsible>
    );
  }

  return (
    <Collapsible open={props.open} onOpenChange={props.onOpenChange} className="mb-1">
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div className="group/header relative mb-0.5 flex w-full min-w-0 max-w-full items-center">
            <button
              type="button"
              aria-current={props.active ? "page" : undefined}
              onClick={props.onSelectProject}
              className={cn(
                "flex h-7 w-full min-w-0 max-w-full flex-1 items-center gap-1.5 overflow-hidden rounded-sm px-1.5 pr-14 text-left text-caption font-normal text-foreground transition-colors hover:bg-surface-hover",
                props.active && "bg-surface-hover font-[500]"
              )}
            >
              {props.open ? (
                <FolderOpenOutlineIcon className="size-4 flex-none text-foreground" />
              ) : (
                <FolderIcon className="size-4 flex-none text-foreground" />
              )}
              <span className="block min-w-0 max-w-[174px] truncate" title={props.name}>
                {props.name}
              </span>
            </button>
            <button
              type="button"
              aria-label={props.open ? t("sidebar.collapseFolder") : t("sidebar.expandFolder")}
              title={props.open ? t("sidebar.collapseFolder") : t("sidebar.expandFolder")}
              onClick={() => props.onOpenChange(!props.open)}
              className="absolute right-7 flex size-6 flex-none items-center justify-center rounded-xs text-muted-slate opacity-0 transition-opacity hover:bg-canvas-soft-2 hover:text-foreground group-hover/header:opacity-100"
            >
              {props.open ? (
                <ChevronIcon className="size-3.5" />
              ) : (
                <ChevronRightIcon className="size-3.5" />
              )}
            </button>
            {/* 最右侧固定：新建对话加号。 */}
            <button
              type="button"
              title={t("sidebar.newChatInProject")}
              onClick={props.onNewChat}
              className="absolute right-1 flex size-6 flex-none items-center justify-center rounded-xs text-muted-slate opacity-0 transition-opacity hover:bg-canvas-soft-2 hover:text-foreground group-hover/header:opacity-100"
            >
              <PlusIcon className="size-3.5" />
            </button>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={props.onStartRename}>
            <PencilOutlineIcon className="size-3.5" />
            {t("sidebar.rename")}
          </ContextMenuItem>
          <ContextMenuItem onSelect={props.onTogglePin}>
            {props.pinned ? (
              <PinFilledSmallIcon className="size-3.5" />
            ) : (
              <PinOutlineIcon className="size-3.5" />
            )}
            {props.pinned ? t("sidebar.unpin") : t("sidebar.pin")}
          </ContextMenuItem>
          <ContextMenuItem onSelect={props.onNewChat}>
            <PlusIcon className="size-3.5" />
            {t("sidebar.newChatInProject")}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            onSelect={() => runAfterMenuClose(props.onDelete)}
            className="text-destructive focus:text-destructive"
          >
            <TrashIcon className="size-3.5" />
            {t("sidebar.deleteProject")}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      <CollapsibleContent>{props.children}</CollapsibleContent>
    </Collapsible>
  );
}

interface SessionRowProps {
  session: Session;
  active: boolean;
  running: boolean;
  notice?: Session["notice"];
  pendingAction?: Session["pendingAction"];
  /** 项目组内的行额外缩进，与组名文本对齐。 */
  indent: boolean;
  editing: boolean;
  draftTitle: string;
  /** 分支会话的来源提示，悬停整行可见；不再显示图标。 */
  branchHint?: string;
  /** 项目分组内会话的项目上下文提示；普通对话不传。 */
  projectTooltipInfo?: ProjectSessionTooltipInfo;
  onSelect(): void;
  onStartRename(): void;
  onDraftChange(value: string): void;
  onCommitRename(): void;
  onCancelRename(): void;
  onDelete(): void;
  onExport(): void;
  onTogglePin(): void;
}

function SessionRow(props: SessionRowProps) {
  const { t } = useTranslation();
  const showRunningSpinner = props.running && !props.pendingAction;
  if (props.editing) {
    return (
      <div className={cn("flex items-center gap-1 py-1 pr-1", props.indent ? "pl-7" : "pl-2.5")}>
        <Input
          aria-label={t("sidebar.sessionTitle")}
          autoFocus
          value={props.draftTitle}
          onChange={(event) => props.onDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") props.onCommitRename();
            if (event.key === "Escape") props.onCancelRename();
          }}
          className="h-7"
        />
        <button
          type="button"
          title={t("sidebar.saveTitle")}
          onClick={props.onCommitRename}
          className="flex size-6 flex-none items-center justify-center rounded-xs text-muted-foreground hover:bg-canvas-soft-2 hover:text-foreground"
        >
          <CheckMediumIcon className="size-4" />
        </button>
        <button
          type="button"
          title={t("sidebar.cancelRename")}
          onClick={props.onCancelRename}
          className="flex size-6 flex-none items-center justify-center rounded-xs text-muted-foreground hover:bg-canvas-soft-2 hover:text-foreground"
        >
          <XMarkIcon className="size-4" />
        </button>
      </div>
    );
  }
  const row = (
    <div
      className={cn(
        "group relative mx-1 mb-0.5 flex h-7 min-w-0 items-center rounded-sm transition-colors",
        props.indent ? "pl-7" : "pl-2.5",
        props.active ? "bg-surface-hover" : "hover:bg-surface-hover"
      )}
    >
      <button
        type="button"
        aria-current={props.active ? "page" : undefined}
        onClick={props.onSelect}
        title={props.projectTooltipInfo ? undefined : props.branchHint}
        className={cn(
          "flex h-full min-w-0 flex-1 items-center gap-1.5 overflow-hidden pr-7 text-left text-caption",
          props.active ? "font-[500] text-foreground" : "text-foreground"
        )}
      >
        {props.session.feishuChatId || props.session.wechatChatId ? (
          <span
            className="flex-none text-muted-slate"
            title={t(props.session.wechatChatId ? "sidebar.wechatSession" : "sidebar.feishuSession")}
          >
            <CommentTextIcon className="size-3.5" />
          </span>
        ) : null}
        <span className="min-w-0 flex-1 truncate">{props.session.title}</span>
        {props.pendingAction ? (
          <span
            data-testid={`session-pending-action-${props.session.id}`}
            title={t(
              props.pendingAction.kind === "ask_user"
                ? "sidebar.pendingAskUser"
                : "sidebar.pendingApproval"
            )}
            className={cn(
              "flex-none rounded-xs border px-1.5 py-0.5 text-micro font-medium leading-3",
              props.pendingAction.kind === "ask_user"
                ? "border-soft-blue-border bg-soft-blue-surface text-soft-blue-foreground"
                : "border-warning/25 bg-warning-soft/70 text-warning-deep"
            )}
          >
            {t(
              props.pendingAction.kind === "ask_user"
                ? "sidebar.pendingAskUser"
                : "sidebar.pendingApproval"
            )}
          </span>
        ) : null}
        {props.notice ? (
          <span
            data-testid={`session-notice-${props.session.id}`}
            aria-hidden="true"
            className="flex size-3 flex-none items-center justify-center"
          >
            <span
              className={cn(
                "size-1.5 rounded-full",
                props.notice.status === "failed" ? "bg-error-deep" : "bg-link"
              )}
            />
          </span>
        ) : null}
      </button>
      {showRunningSpinner ? (
        <span
          title={t("sidebar.sessionRunning")}
          className="absolute right-1 top-0 flex h-full w-6 flex-none items-center justify-center text-muted-foreground"
        >
          <RefreshIcon className="size-3.5 animate-spin" />
        </span>
      ) : null}
      <div
        className={cn(
          "absolute right-1 top-0 h-full flex-none items-center",
          showRunningSpinner ? "hidden" : "hidden group-hover:flex"
        )}
      >
        <button
          type="button"
          title={props.session.pinnedAt ? t("sidebar.unpin") : t("sidebar.pin")}
          onClick={props.onTogglePin}
          className="flex size-6 flex-none items-center justify-center rounded-xs text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          {props.session.pinnedAt ? (
            <PinFilledSmallIcon className="size-3.5" />
          ) : (
            <PinOutlineIcon className="size-3.5" />
          )}
        </button>
      </div>
    </div>
  );

  return (
    <ContextMenu>
      {props.projectTooltipInfo ? (
        <Tooltip delayDuration={120}>
          <ContextMenuTrigger asChild>
            <TooltipTrigger asChild>{row}</TooltipTrigger>
          </ContextMenuTrigger>
          <ProjectSessionTooltip info={props.projectTooltipInfo} />
        </Tooltip>
      ) : (
        <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
      )}
      <ContextMenuContent>
        <ContextMenuItem onSelect={props.onStartRename}>
          <PencilOutlineIcon className="size-3.5" />
          {t("sidebar.rename")}
        </ContextMenuItem>
        <ContextMenuItem onSelect={props.onTogglePin}>
          {props.session.pinnedAt ? (
            <PinFilledSmallIcon className="size-3.5" />
          ) : (
            <PinOutlineIcon className="size-3.5" />
          )}
          {props.session.pinnedAt ? t("sidebar.unpin") : t("sidebar.pin")}
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => runAfterMenuClose(props.onExport)}>
          <DownloadIcon className="size-3.5" />
          {t("sidebar.exportSession")}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onSelect={() => runAfterMenuClose(props.onDelete)}
          className="text-destructive focus:text-destructive"
        >
          <TrashIcon className="size-3.5" />
          {t("sidebar.deleteSession")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function ProjectSessionTooltip(props: { info: ProjectSessionTooltipInfo }) {
  const { t } = useTranslation();
  return (
    <TooltipContent
      side="right"
      align="start"
      sideOffset={8}
      className="max-w-60 px-2.5 py-1.5 text-left"
    >
      <div className="space-y-1">
        <div>
          <div className="text-micro text-primary-foreground/70">
            {t("sidebar.projectSessionPath")}
          </div>
          <div className="break-all font-mono text-micro leading-3.5 text-primary-foreground">
            {props.info.projectPath}
          </div>
        </div>
        {props.info.branchName ? (
          <div>
            <div className="text-micro text-primary-foreground/70">
              {t("sidebar.projectSessionBranch")}
            </div>
            <div className="break-all font-mono text-micro leading-3.5 text-primary-foreground">
              {props.info.branchName}
            </div>
          </div>
        ) : null}
      </div>
    </TooltipContent>
  );
}
