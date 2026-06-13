import {
  CaretDownIcon as ChevronDown,
  CaretRightIcon as ChevronRight,
  ChatCenteredTextIcon as MessageSquareText,
  CheckIcon as Check,
  ClockIcon as Clock,
  DeviceMobileIcon as DeviceMobile,
  FileArrowDownIcon as FileDown,
  FolderIcon as Folder,
  FolderOpenIcon as FolderOpen,
  GearIcon as Settings,
  CircleNotchIcon as Loader2,
  MagnifyingGlassIcon as Search,
  NotePencilIcon as SquarePen,
  PencilSimpleIcon as Pencil,
  PlusIcon as Plus,
  PushPinIcon as PushPin,
  PushPinSlashIcon as PushPinSlash,
  SidebarSimpleIcon as PanelLeft,
  SparkleIcon as Sparkle,
  TrashIcon as Trash2,
  XIcon as X
} from "@phosphor-icons/react";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { Project, Session } from "@chengxiaobang/shared";
import { useShallow } from "zustand/react/shallow";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from "@/components/ui/context-menu";
import { useConfirmDialog } from "@/components/ConfirmDialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store";

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
      <PanelLeft className="size-4" />
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
        "flex h-8 w-full flex-none items-center gap-2 rounded-sm px-2.5 text-left text-body-xs text-foreground transition-colors hover:bg-surface-hover",
        props.active && "bg-surface-hover font-medium"
      )}
    >
      <span className="flex size-4 flex-none items-center justify-center [&_svg]:size-4 [&_svg]:stroke-[1.75]">
        {props.icon}
      </span>
      <span className={cn("truncate", props.compactLabel && "text-[15px]")}>{props.label}</span>
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
          <Plus className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}

export function Sidebar() {
  const { t } = useTranslation();
  const confirmDialog = useConfirmDialog();
  const sidebarOpen = useAppStore((state) => state.sidebarOpen);
  const { projects, sessions, activeSessionId, view, runningSessionsById } = useAppStore(
    useShallow((state) => ({
      projects: state.projects,
      sessions: state.sessions,
      activeSessionId: state.activeSessionId,
      view: state.view,
      runningSessionsById: state.runningSessionsById
    }))
  );
  const newChat = useAppStore((state) => state.newChat);
  const newChatInProject = useAppStore((state) => state.newChatInProject);
  const openFolder = useAppStore((state) => state.openFolder);
  const setPaletteOpen = useAppStore((state) => state.setPaletteOpen);
  const setView = useAppStore((state) => state.setView);
  const selectSession = useAppStore((state) => state.selectSession);
  const renameSession = useAppStore((state) => state.renameSession);
  const deleteSession = useAppStore((state) => state.deleteSession);
  const exportSession = useAppStore((state) => state.exportSession);
  const deleteProject = useAppStore((state) => state.deleteProject);
  const renameProject = useAppStore((state) => state.renameProject);
  const setSessionPinned = useAppStore((state) => state.setSessionPinned);
  const setProjectPinned = useAppStore((state) => state.setProjectPinned);

  const [editingId, setEditingId] = useState<string>();
  const [draftTitle, setDraftTitle] = useState("");
  const [editingProjectId, setEditingProjectId] = useState<string>();
  const [projectDraft, setProjectDraft] = useState("");

  // 置顶项只在置顶区展示，原「项目」/「对话」区域不再重复出现。
  const ungrouped = sessions.filter((session) => !session.projectId && !session.pinnedAt);
  const projectSessions = projects
    .map((project) => ({
      project,
      sessions: sessions.filter((session) => session.projectId === project.id)
    }));

  // 置顶区：项目组在前、单会话在后，各按置顶时间降序（ISO 字符串可直接字典序比较）。
  // 被单独置顶的会话以单行展示，置顶项目组内不再重复。
  const pinnedProjects = projectSessions
    .filter(({ project }) => project.pinnedAt)
    .map(({ project, sessions: list }) => ({
      project,
      sessions: list.filter((session) => !session.pinnedAt)
    }))
    .sort((a, b) => b.project.pinnedAt!.localeCompare(a.project.pinnedAt!));
  const pinnedSessions = sessions
    .filter((session) => session.pinnedAt)
    .sort((a, b) => b.pinnedAt!.localeCompare(a.pinnedAt!));
  const hasPinned = pinnedProjects.length > 0 || pinnedSessions.length > 0;

  // 项目区只展示未置顶项目，组内排除已单独置顶的会话。
  const unpinnedProjects = projectSessions
    .filter(({ project }) => !project.pinnedAt)
    .map(({ project, sessions: list }) => ({
      project,
      sessions: list.filter((session) => !session.pinnedAt)
    }));

  // 分支标记需要跨全部会话查找父会话标题。
  const titleById = new Map(sessions.map((session) => [session.id, session.title]));

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

  function renderSession(session: Session, indent: boolean): ReactNode {
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
        editing={editingId === session.id}
        draftTitle={draftTitle}
        branchHint={branchHint}
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

  // 置顶区与项目区共用：置顶区不截断（展示项目下全部会话），项目区维持 slice(0, 8)。
  // 注意：同一会话/项目双份显示时，editingId/editingProjectId 共享会让两份同时进入
  // 行内编辑态——受控同值，提交一次生效，接受这个行为。
  function renderProjectGroup(
    project: Project,
    projectSessionList: Session[],
    opts: { sliceTo?: number }
  ): ReactNode {
    const visible = opts.sliceTo
      ? projectSessionList.slice(0, opts.sliceTo)
      : projectSessionList;
    return (
      <ProjectGroup
        key={project.id}
        name={project.name}
        pinned={Boolean(project.pinnedAt)}
        editing={editingProjectId === project.id}
        draftName={projectDraft}
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
          <p className="py-1 pl-7 pr-2 text-micro text-foreground">{t("sidebar.noChats")}</p>
        ) : (
          visible.map((session) => renderSession(session, true))
        )}
      </ProjectGroup>
    );
  }

  return (
    // 折叠 = 外层宽度动画收到 0；内容固定在 272px 的内层里，动画期间不会被压扁。
    // 折叠态保持挂载以便展开动画，用 inert + aria-hidden 屏蔽交互与无障碍树。
    <aside
      data-testid="app-sidebar"
      aria-hidden={!sidebarOpen}
      inert={!sidebarOpen}
      className={cn(
        "h-full min-h-0 flex-none overflow-hidden bg-background transition-[width] duration-200 ease-out max-[840px]:hidden",
        sidebarOpen ? "w-[272px] border-r border-border" : "w-0"
      )}
    >
      <div className="flex h-full w-[272px] min-h-0 flex-col px-3 pb-3">
      {/* macOS hiddenInset 标题栏会占据左上角；这里预留一条空白，
          给系统按钮和悬浮的 SidebarToggle 留出位置。注意不能挂 app-region:drag——
          它会盖住折叠按钮并抢走点击（窗口拖拽由 .titlebar-drag 提供）。 */}
      <div className="h-10 flex-none" />

      <div className="mt-1 flex-none space-y-0.5">
        <SidebarRow icon={<SquarePen />} label={t("sidebar.newChat")} compactLabel onClick={newChat} />
        <SidebarRow icon={<Search />} label={t("sidebar.search")} compactLabel onClick={() => setPaletteOpen(true)} />
        <SidebarRow
          icon={<Clock />}
          label={t("sidebar.tasks")}
          compactLabel
          active={view === "tasks"}
          onClick={() => setView("tasks")}
        />
        <SidebarRow
          icon={<Sparkle />}
          label={t("sidebar.skills")}
          compactLabel
          active={view === "skills"}
          onClick={() => setView("skills")}
        />
        <SidebarRow
          icon={<DeviceMobile />}
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
          className="sidebar-scroll-area h-full min-h-0 overflow-y-auto px-1 pb-6"
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
          <SectionLabel
            className={hasPinned ? "mt-6" : undefined}
            actionLabel={t("sidebar.openFolder")}
            onAction={() => {
              console.debug("[sidebar] 点击「项目」区块加号，打开文件夹选择");
              void openFolder();
            }}
          >
            {t("sidebar.projects")}
          </SectionLabel>
          {unpinnedProjects.map(({ project, sessions: projectSessionList }) =>
            renderProjectGroup(project, projectSessionList, { sliceTo: 8 })
          )}
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
            ungrouped.map((session) => renderSession(session, false))
          )}
        </div>
        <div
          data-sidebar-bottom-fade="true"
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-b from-background/0 via-background/80 to-background"
        />
      </div>

      <div className="mt-2 flex-none border-t border-border pt-2">
        <SidebarRow
          icon={<Settings />}
          label={t("sidebar.settings")}
          active={view === "settings"}
          onClick={() => setView("settings")}
        />
      </div>
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
  editing: boolean;
  draftName: string;
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
  const [open, setOpen] = useState(true);
  const onOpenChange = (nextOpen: boolean) => {
    console.debug("[sidebar] 切换项目组折叠状态", { name: props.name, open: nextOpen });
    setOpen(nextOpen);
  };

  if (props.editing) {
    return (
      <Collapsible open={open} onOpenChange={onOpenChange} className="mb-1">
        <div className="flex items-center gap-1 py-1 pl-1.5 pr-1">
          <Folder className="size-4 flex-none stroke-[1.75] text-muted-slate" />
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
            <Check className="size-4" />
          </button>
          <button
            type="button"
            title={t("sidebar.cancelRename")}
            onClick={props.onCancelRename}
            className="flex size-6 flex-none items-center justify-center rounded-xs text-muted-foreground hover:bg-canvas-soft-2 hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
        <CollapsibleContent>{props.children}</CollapsibleContent>
      </Collapsible>
    );
  }

  return (
    <Collapsible open={open} onOpenChange={onOpenChange} className="mb-1">
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div className="group/header relative mb-0.5 flex w-full min-w-0 max-w-full items-center">
            <CollapsibleTrigger asChild>
              <button
                type="button"
                title={open ? t("sidebar.collapseFolder") : t("sidebar.expandFolder")}
                className="flex h-7 w-full min-w-0 max-w-full flex-1 items-center gap-1.5 overflow-hidden rounded-sm px-1.5 pr-8 text-left text-body-sm text-foreground transition-colors hover:bg-surface-hover"
              >
                {open ? (
                  <FolderOpen className="size-4 flex-none stroke-[1.75] text-muted-slate" />
                ) : (
                  <Folder className="size-4 flex-none stroke-[1.75] text-muted-slate" />
                )}
                <span className="block min-w-0 max-w-[174px] truncate" title={props.name}>
                  {props.name}
                </span>
                {/* 展开/收起指示：紧跟名字，悬停浮现。 */}
                <span className="ml-0.5 flex size-4 flex-none items-center justify-center text-muted-slate opacity-0 transition-opacity group-hover/header:opacity-100">
                  {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                </span>
              </button>
            </CollapsibleTrigger>
            {/* 最右侧固定：新建对话加号。 */}
            <button
              type="button"
              title={t("sidebar.newChatInProject")}
              onClick={props.onNewChat}
              className="absolute right-1 flex size-6 flex-none items-center justify-center rounded-xs text-muted-slate opacity-0 transition-opacity hover:bg-canvas-soft-2 hover:text-foreground group-hover/header:opacity-100"
            >
              <Plus className="size-3.5" />
            </button>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={props.onStartRename}>
            <Pencil className="size-3.5" />
            {t("sidebar.rename")}
          </ContextMenuItem>
          <ContextMenuItem onSelect={props.onTogglePin}>
            {props.pinned ? (
              <PushPinSlash className="size-3.5" />
            ) : (
              <PushPin className="size-3.5" />
            )}
            {props.pinned ? t("sidebar.unpin") : t("sidebar.pin")}
          </ContextMenuItem>
          <ContextMenuItem onSelect={props.onNewChat}>
            <Plus className="size-3.5" />
            {t("sidebar.newChatInProject")}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            onSelect={props.onDelete}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="size-3.5" />
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
  /** 项目组内的行额外缩进，与组名文本对齐。 */
  indent: boolean;
  editing: boolean;
  draftTitle: string;
  /** 分支会话的来源提示，悬停整行可见；不再显示图标。 */
  branchHint?: string;
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
          <Check className="size-4" />
        </button>
        <button
          type="button"
          title={t("sidebar.cancelRename")}
          onClick={props.onCancelRename}
          className="flex size-6 flex-none items-center justify-center rounded-xs text-muted-foreground hover:bg-canvas-soft-2 hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>
    );
  }
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
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
            title={props.branchHint}
            className={cn(
              "flex h-full min-w-0 flex-1 items-center gap-1.5 overflow-hidden pr-7 text-left text-caption",
              props.active ? "font-medium text-foreground" : "text-foreground"
            )}
          >
            {props.session.feishuChatId ? (
              <span className="flex-none text-muted-slate" title={t("sidebar.feishuSession")}>
                <MessageSquareText className="size-3.5" />
              </span>
            ) : null}
            <span className="min-w-0 flex-1 truncate">{props.session.title}</span>
          </button>
          {props.running ? (
            <span
              title={t("sidebar.sessionRunning")}
              className="absolute right-1 top-0 flex h-full w-6 flex-none items-center justify-center text-muted-foreground"
            >
              <Loader2 className="size-3.5 animate-spin" />
            </span>
          ) : null}
          <div
            className={cn(
              "absolute right-1 top-0 h-full flex-none items-center",
              props.running ? "hidden" : "hidden group-hover:flex"
            )}
          >
            <button
              type="button"
              title={props.session.pinnedAt ? t("sidebar.unpin") : t("sidebar.pin")}
              onClick={props.onTogglePin}
              className="flex size-6 flex-none items-center justify-center rounded-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              {props.session.pinnedAt ? (
                <PushPinSlash className="size-3.5" />
              ) : (
                <PushPin className="size-3.5" />
              )}
            </button>
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={props.onStartRename}>
          <Pencil className="size-3.5" />
          {t("sidebar.rename")}
        </ContextMenuItem>
        <ContextMenuItem onSelect={props.onTogglePin}>
          {props.session.pinnedAt ? (
            <PushPinSlash className="size-3.5" />
          ) : (
            <PushPin className="size-3.5" />
          )}
          {props.session.pinnedAt ? t("sidebar.unpin") : t("sidebar.pin")}
        </ContextMenuItem>
        <ContextMenuItem onSelect={props.onExport}>
          <FileDown className="size-3.5" />
          {t("sidebar.exportSession")}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={props.onDelete} className="text-destructive focus:text-destructive">
          <Trash2 className="size-3.5" />
          {t("sidebar.deleteSession")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
