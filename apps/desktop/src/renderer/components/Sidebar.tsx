import {
  Check,
  ChevronDown,
  ChevronRight,
  FileDown,
  Folder,
  FolderOpen,
  MessageSquare,
  MessageSquarePlus,
  Pencil,
  Search,
  Settings,
  Trash2,
  X
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { Session } from "@chengxiaobang/shared";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Logo } from "@/components/Logo";
import { filterSessionsByTitle } from "@/lib/session-filter";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store";

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
  const openFolder = useAppStore((state) => state.openFolder);
  const setPaletteOpen = useAppStore((state) => state.setPaletteOpen);
  const setView = useAppStore((state) => state.setView);
  const selectSession = useAppStore((state) => state.selectSession);
  const renameSession = useAppStore((state) => state.renameSession);
  const deleteSession = useAppStore((state) => state.deleteSession);
  const exportSession = useAppStore((state) => state.exportSession);

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
    // A filter match must be visible even in a collapsed group or past the
    // per-group display cap.
    forceOpen: filtering,
    showAll: filtering
  };

  return (
    <aside className="flex h-full min-h-0 flex-col gap-0.5 overflow-hidden bg-surface px-2.5 pb-3 max-[840px]:hidden">
      {/* Drag strip reserving space for the macOS traffic-light buttons. */}
      <div className="h-10 flex-none [-webkit-app-region:drag]" />
      <div className="flex h-9 flex-none items-center gap-2 px-2.5 [-webkit-app-region:drag]">
        <Logo className="size-[22px]" />
        <span className="text-[13.5px] font-semibold tracking-tight">程小帮</span>
      </div>

      <Button
        variant="ghost"
        className="h-9 w-full justify-start gap-2.5 px-2.5 font-medium hover:bg-accent"
        onClick={newChat}
      >
        <MessageSquarePlus className="size-[18px] text-brand" />
        {t("sidebar.newChat")}
      </Button>
      <Button
        variant="ghost"
        className="h-9 w-full justify-start gap-2.5 px-2.5 font-medium hover:bg-accent"
        onClick={() => setPaletteOpen(true)}
      >
        <Search className="size-[18px] text-muted-foreground" />
        {t("sidebar.search")}
      </Button>

      <div className="relative mt-1">
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
          className="h-8 pl-8 pr-7 text-[13px]"
        />
        {filter ? (
          <button
            type="button"
            title={t("sidebar.clearFilter")}
            onClick={() => setFilter("")}
            className="absolute right-1.5 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        ) : null}
      </div>

      <div className="mb-1 mt-4 px-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">
        {t("sidebar.conversations")}
      </div>
      <ScrollArea className="-mx-1 max-h-[34vh] flex-none px-1">
        {ungrouped.length > 0 ? (
          <SessionGroup
            icon={<MessageSquare className="size-4 text-muted-foreground" />}
            name={t("sidebar.standalone")}
            sessions={ungrouped}
            {...groupProps}
          />
        ) : (
          <p className="px-3 py-2 text-sm text-muted-foreground">
            {filtering ? t("sidebar.noMatches") : t("sidebar.noChats")}
          </p>
        )}
      </ScrollArea>

      <div className="mb-1 mt-4 px-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">
        {t("sidebar.projects")}
      </div>
      <Button
        variant="ghost"
        className="h-9 w-full justify-start gap-2.5 px-2.5 font-normal text-muted-foreground hover:bg-accent hover:text-foreground"
        onClick={() => void openFolder()}
      >
        <FolderOpen className="size-[18px]" />
        {t("sidebar.openFolder")}
      </Button>

      <ScrollArea className="-mx-1 mt-1 min-h-0 flex-1 px-1">
        {projectSessions.map(({ project, sessions: projectSessionList }) => (
          <SessionGroup
            key={project.id}
            icon={<Folder className="size-4 text-muted-foreground" />}
            name={project.name}
            sessions={projectSessionList}
            {...groupProps}
          />
        ))}
        {projects.length === 0 ? (
          <p className="px-3 py-2 text-sm text-muted-foreground">{t("sidebar.noProjects")}</p>
        ) : null}
      </ScrollArea>

      <Button
        variant="ghost"
        className="mt-auto h-9 w-full justify-start gap-2.5 px-2.5 font-medium hover:bg-accent"
        onClick={() => setView("settings")}
      >
        <Settings className="size-[18px] text-muted-foreground" />
        {t("sidebar.settings")}
      </Button>
    </aside>
  );
}

interface GroupProps {
  icon: ReactNode;
  name: string;
  sessions: Session[];
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
    <div className="mb-2.5">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs font-semibold text-muted-foreground transition-colors hover:bg-accent/70 hover:text-foreground"
      >
        {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        {props.icon}
        <span className="truncate">{props.name}</span>
        <span className="ml-auto rounded-full bg-muted px-1.5 text-[10.5px] font-medium tabular-nums text-muted-foreground">
          {props.sessions.length}
        </span>
      </button>
      {expanded && props.sessions.length === 0 ? (
        <p className="px-3 py-1.5 pl-8 text-[12px] text-muted-foreground">
          {t("sidebar.noChats")}
        </p>
      ) : null}
      {expanded ? (props.showAll ? props.sessions : props.sessions.slice(0, 8)).map((session) =>
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
              className="h-7 text-[13px]"
            />
            <button
              type="button"
              title={t("sidebar.saveTitle")}
              onClick={props.onCommitRename}
              className="flex size-6 flex-none items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Check className="size-4" />
            </button>
            <button
              type="button"
              title={t("sidebar.cancelRename")}
              onClick={props.onCancelRename}
              className="flex size-6 flex-none items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          </div>
        ) : (
          <div
            key={session.id}
            className={cn(
              "group relative flex items-center rounded-md pl-8 pr-1 transition-colors",
              session.id === props.activeSessionId
                ? "bg-accent text-accent-foreground before:absolute before:left-2.5 before:top-1/2 before:h-3.5 before:w-[3px] before:-translate-y-1/2 before:rounded-full before:bg-brand"
                : "hover:bg-accent/60"
            )}
          >
            <button
              type="button"
              onClick={() => props.onSelect(session.id)}
              className={cn(
                "flex-1 truncate py-1.5 text-left text-[13px]",
                session.id === props.activeSessionId && "font-medium"
              )}
            >
              <span className="truncate">{session.title}</span>
            </button>
            <button
              type="button"
              title={t("sidebar.rename")}
              onClick={() => props.onStartRename(session)}
              className="flex size-6 flex-none items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-background hover:text-foreground group-hover:opacity-100"
            >
              <Pencil className="size-3.5" />
            </button>
            <button
              type="button"
              title={t("sidebar.exportSession")}
              onClick={() => props.onExport(session.id)}
              className="flex size-6 flex-none items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-background hover:text-foreground group-hover:opacity-100"
            >
              <FileDown className="size-3.5" />
            </button>
            <button
              type="button"
              title={t("sidebar.deleteSession")}
              onClick={() => props.onDelete(session.id)}
              className="flex size-6 flex-none items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-background hover:text-destructive group-hover:opacity-100"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        )
      ) : null}
    </div>
  );
}
