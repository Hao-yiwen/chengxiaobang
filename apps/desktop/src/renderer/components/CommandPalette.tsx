import { CornerDownLeft, MessageSquare } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut
} from "@/components/ui/command";
import { useAppStore } from "@/store";

export function CommandPalette() {
  const { t } = useTranslation();
  const { open, sessions, projects } = useAppStore(
    useShallow((state) => ({
      open: state.paletteOpen,
      sessions: state.sessions,
      projects: state.projects
    }))
  );
  const setPaletteOpen = useAppStore((state) => state.setPaletteOpen);
  const selectSession = useAppStore((state) => state.selectSession);

  const projectName = useMemo(() => {
    const map = new Map<string, string>();
    for (const project of projects) {
      map.set(project.id, project.name);
    }
    return map;
  }, [projects]);

  return (
    <CommandDialog open={open} onOpenChange={setPaletteOpen} title={t("palette.title")}>
      <CommandInput placeholder={t("palette.placeholder")} />
      <CommandList>
        <CommandEmpty>{t("palette.empty")}</CommandEmpty>
        <CommandGroup heading={t("palette.group")}>
          {sessions.map((session) => (
            <CommandItem
              key={session.id}
              value={`${session.title} ${session.id}`}
              onSelect={() => {
                void selectSession(session.id);
                setPaletteOpen(false);
              }}
            >
              <MessageSquare className="text-muted-foreground" />
              <span className="flex-1 truncate">{session.title}</span>
              {session.projectId && projectName.has(session.projectId) ? (
                <span className="flex-none text-xs text-muted-foreground">
                  {projectName.get(session.projectId)}
                </span>
              ) : null}
              <CommandShortcut>
                <CornerDownLeft className="size-3.5" />
              </CommandShortcut>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
