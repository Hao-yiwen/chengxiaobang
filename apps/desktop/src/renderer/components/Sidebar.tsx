import {
  Check,
  ChevronDown,
  ChevronRight,
  FileDown,
  Folder,
  GitFork,
  MessageSquareText,
  MessageSquare,
  Pencil,
  Search,
  Settings,
  SquarePen,
  Trash2,
  X
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { Session } from "@chengxiaobang/shared";
import { useShallow } from "zustand/react/shallow";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Logo } from "@/components/Logo";
import { filterSessionsByTitle } from "@/lib/session-filter";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store";

/** Flat sidebar row: icon + label on a rule-driven navigation surface. */
function SidebarRow(props: { icon: ReactNode; label: string; onClick(): void }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className="flex h-9 w-full flex-none items-center gap-2.5 rounded-sm px-2.5 text-left text-caption text-foreground transition-colors hover:bg-soft-stone"
    >
      <span className="flex size-[18px] flex-none items-center justify-center [&_svg]:size-[17px] [&_svg]:stroke-[1.75]">
        {props.icon}
      </span>
      <span className="truncate">{props.label}</span>
    </button>
  );
}

export function Sidebar() {
  const { t } = useTranslation();
  const { projects, sessions, activeSessionId } = useAppStore(
    useShallow((state) => ({
      projects: state.projects,
      sessions: state.sessions,
      activeSessionId: state.activeSessionId
    }))
  );
  const newChat = useAppStore((state) => state.newChat);
  const setPaletteOpen = useAppStore((state) => state.setPaletteOpen);
  const setView = useAppStore((state) => state.setView);
  const selectSession = useAppStore((state) => state.selectSession);
  const renameSession = useAppStore((state) => state.renameSession);
  const deleteSession = useAppStore((state) => state.deleteSession);
  const exportSession = useAppStore((state) => state.exportSession);
  const deleteProject = useAppStore((state) => state.deleteProject);

  const [editingId, setEditingId] = useState<string>();
  const [draftTitle, setDraftTitle] = useState("");
  const [filter, setFilter] = useState("");

  const filtering = filter.trim().length > 0;
  const visibleSessions = filterSessionsByTitle(sessions, filter);
  const ungrouped = visibleSessions.filter((session) => !session.projectId);
  const projectSessions = projects
    .map((project) => ({
      project,
      sessions: visibleSessions.filter((session) => session.projectId === project.id)
    }))
    // While filtering, groups without a match disappear entirely.
    .filter((group) => !filtering || group.sessions.length > 0);

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

  function onDelete(id: string): void {
    if (!window.confirm(t("sidebar.deleteConfirm"))) {
      return;
    }
    void deleteSession(id);
  }

  const groupProps = {
    activeSessionId,
    editingId,
    draftTitle,
    onSelect: (id: string) => void selectSession(id),
    onStartRename: startRename,
    onDraftChange: setDraftTitle,
    onCommitRename: () => void commitRename(),
    onCancelRename: () => setEditingId(undefined),
    onDelete,
    onExport: (id: string) => void exportSession(id),
    // For branch indicators: parent titles looked up across all sessions.
    titleById: new Map(sessions.map((session) => [session.id, session.title])),
    // A filter match must be visible even in a collapsed group or past the
    // per-group display cap.
    forceOpen: filtering,
    showAll: filtering
  };

  return (
    <aside
      data-testid="app-sidebar"
      className="flex h-full w-[272px] min-h-0 flex-none flex-col overflow-hidden border-r border-border bg-background px-3 pb-3 max-[840px]:hidden"
    >
      {/* In Electron (hiddenInset titlebar) the macOS traffic lights occupy the
          top-left corner — reserve a draggable strip above the brand row so the
          logo sits below them, not beside them. */}
      {window.chengxiaobang ? (
        <div className="h-12 flex-none [-webkit-app-region:drag]" />
      ) : null}
      <div className="flex h-11 flex-none items-center gap-2 border-b px-2 [-webkit-app-region:drag]">
        <Logo className="size-[22px]" />
        <span className="font-mono text-mono-label uppercase text-foreground">程小帮</span>
      </div>

      <div className="mt-3 space-y-1 border-b pb-3">
        <SidebarRow icon={<SquarePen />} label={t("sidebar.newChat")} onClick={newChat} />
        <SidebarRow icon={<Search />} label={t("sidebar.search")} onClick={() => setPaletteOpen(true)} />
      </div>

      <div className="relative mt-3">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          aria-label={t("sidebar.filterPlaceholder")}
          placeholder={t("sidebar.filterPlaceholder")}
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setFilter("");
              event.currentTarget.blur();
            }
          }}
          className="h-8 pl-8 pr-7"
        />
        {filter ? (
          <button
            type="button"
            title={t("sidebar.clearFilter")}
            onClick={() => setFilter("")}
            className="absolute right-1.5 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded-xs text-muted-foreground hover:bg-soft-stone hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        ) : null}
      </div>

      <div className="mb-1 mt-5 flex-none border-t px-2.5 pt-4 font-mono text-[11px] uppercase tracking-[0.28px] text-muted-slate">
        {t("sidebar.conversations")}
      </div>
      <ScrollArea className="-mx-0.5 max-h-[34vh] flex-none px-0.5">
        {ungrouped.length > 0 ? (
          <SessionGroup
            icon={<MessageSquare className="size-4" />}
            name={t("sidebar.standalone")}
            sessions={ungrouped}
            {...groupProps}
          />
        ) : (
          <p className="px-2.5 py-1.5 text-micro text-muted-slate">
            {filtering ? t("sidebar.noMatches") : t("sidebar.noChats")}
          </p>
        )}
      </ScrollArea>

      <div className="mb-1 mt-5 flex-none border-t px-2.5 pt-4 font-mono text-[11px] uppercase tracking-[0.28px] text-muted-slate">
        {t("sidebar.projects")}
      </div>

      <ScrollArea className="-mx-0.5 mt-0.5 min-h-0 flex-1 px-0.5">
        {projectSessions.map(({ project, sessions: projectSessionList }) => (
          <SessionGroup
            key={project.id}
            icon={<Folder className="size-4" />}
            name={project.name}
            sessions={projectSessionList}
            onDeleteGroup={() => {
              if (window.confirm(t("sidebar.deleteProjectConfirm"))) {
                void deleteProject(project.id);
              }
            }}
            {...groupProps}
          />
        ))}
        {projects.length === 0 ? (
          <p className="px-2.5 py-1.5 text-micro text-muted-slate">
            {t("sidebar.noProjects")}
          </p>
        ) : null}
      </ScrollArea>

      <div className="mt-2 flex-none border-t border-border pt-2">
        <SidebarRow icon={<Settings />} label={t("sidebar.settings")} onClick={() => setView("settings")} />
      </div>
    </aside>
  );
}

interface GroupProps {
  icon: ReactNode;
  name: string;
  sessions: Session[];
  /** Present for project groups: shows a hover delete action on the header. */
  onDeleteGroup?(): void;
  activeSessionId?: string;
  editingId?: string;
  draftTitle: string;
  onSelect(id: string): void;
  onStartRename(session: Session): void;
  onDraftChange(value: string): void;
  onCommitRename(): void;
  onCancelRename(): void;
  onDelete(id: string): void;
  onExport(id: string): void;
  titleById: Map<string, string>;
  /** Render expanded regardless of the group's own collapse state (filtering). */
  forceOpen?: boolean;
  /** Bypass the per-group display cap (filtering). */
  showAll?: boolean;
}

function SessionGroup(props: GroupProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  const expanded = open || props.forceOpen;
  return (
    <div className="mb-2">
      <div className="group/header relative flex items-center">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-sm px-2 py-1.5 text-left text-micro font-medium text-muted-foreground transition-colors hover:bg-soft-stone hover:text-foreground"
        >
          {expanded ? (
            <ChevronDown className="size-3.5 flex-none" />
          ) : (
            <ChevronRight className="size-3.5 flex-none" />
          )}
          <span className="flex flex-none items-center text-muted-foreground/80">{props.icon}</span>
          <span className="truncate">{props.name}</span>
          <span className="ml-auto text-micro tabular-nums text-muted-slate">
            {props.sessions.length}
          </span>
        </button>
        {props.onDeleteGroup ? (
          <button
            type="button"
            title={t("sidebar.deleteProject")}
            onClick={props.onDeleteGroup}
            className="absolute right-1 flex size-6 flex-none items-center justify-center rounded-xs bg-background text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover/header:opacity-100"
          >
            <Trash2 className="size-3.5" />
          </button>
        ) : null}
      </div>
      {expanded && props.sessions.length === 0 ? (
        <p className="py-1 pl-9 pr-2 text-micro text-muted-slate">{t("sidebar.noChats")}</p>
      ) : null}
      {expanded
        ? (props.showAll ? props.sessions : props.sessions.slice(0, 8)).map((session) =>
            props.editingId === session.id ? (
              <div key={session.id} className="flex items-center gap-1 py-1 pl-7 pr-1">
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
                  className="flex size-6 flex-none items-center justify-center rounded-xs text-muted-foreground hover:bg-soft-stone hover:text-foreground"
                >
                  <Check className="size-4" />
                </button>
                <button
                  type="button"
                  title={t("sidebar.cancelRename")}
                  onClick={props.onCancelRename}
                  className="flex size-6 flex-none items-center justify-center rounded-xs text-muted-foreground hover:bg-soft-stone hover:text-foreground"
                >
                  <X className="size-4" />
                </button>
              </div>
            ) : (
              <div
                key={session.id}
                className={cn(
                  "group relative flex items-center rounded-sm pl-9 pr-1 transition-colors",
                  session.id === props.activeSessionId ? "bg-soft-stone" : "hover:bg-soft-stone/70"
                )}
              >
                <button
                  type="button"
                  onClick={() => props.onSelect(session.id)}
                  className="flex min-w-0 flex-1 items-center gap-1 py-1.5 text-left text-caption text-foreground/90"
                >
                  {session.parentSessionId ? (
                    <span
                      className="flex-none"
                      title={
                        props.titleById.has(session.parentSessionId)
                          ? t("sidebar.branchOf", {
                              title: props.titleById.get(session.parentSessionId)
                            })
                          : t("sidebar.branchUnknown")
                      }
                    >
                      <GitFork className="size-3 text-muted-foreground" />
                    </span>
                  ) : null}
                  {session.feishuChatId ? (
                    <span className="flex-none" title={t("sidebar.feishuSession")}>
                      <MessageSquareText className="size-3 text-muted-foreground" />
                    </span>
                  ) : null}
                  <span className="truncate">{session.title}</span>
                </button>
                <button
                  type="button"
                  title={t("sidebar.rename")}
                  onClick={() => props.onStartRename(session)}
                  className="flex size-6 flex-none items-center justify-center rounded-xs text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100"
                >
                  <Pencil className="size-3.5" />
                </button>
                <button
                  type="button"
                  title={t("sidebar.exportSession")}
                  onClick={() => props.onExport(session.id)}
                  className="flex size-6 flex-none items-center justify-center rounded-xs text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100"
                >
                  <FileDown className="size-3.5" />
                </button>
                <button
                  type="button"
                  title={t("sidebar.deleteSession")}
                  onClick={() => props.onDelete(session.id)}
                  className="flex size-6 flex-none items-center justify-center rounded-xs text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-destructive group-hover:opacity-100"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            )
          )
        : null}
    </div>
  );
}
