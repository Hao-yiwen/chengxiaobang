import {
  ArrowBendDownLeftIcon as CornerDownLeft,
  ChatCircleIcon as MessageSquare
} from "@phosphor-icons/react";
import type { SessionSearchResult } from "@chengxiaobang/shared";
import { useEffect, useMemo, useState } from "react";
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
  const searchSessions = useAppStore((state) => state.searchSessions);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SessionSearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  const projectName = useMemo(() => {
    const map = new Map<string, string>();
    for (const project of projects) {
      map.set(project.id, project.name);
    }
    return map;
  }, [projects]);

  const trimmedQuery = query.trim();
  const fallbackResults = useMemo<SessionSearchResult[]>(
    () => sessions.map((session) => ({ session, matchType: "title" as const })),
    [sessions]
  );
  const visibleResults = trimmedQuery ? results : fallbackResults;

  useEffect(() => {
    if (!open) {
      setQuery("");
      setResults([]);
      setSearching(false);
      return;
    }
    if (!trimmedQuery) {
      setResults([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setResults([]);
    setSearching(true);
    const timer = window.setTimeout(() => {
      void searchSessions(trimmedQuery)
        .then((nextResults) => {
          if (!cancelled) {
            setResults(nextResults);
          }
        })
        .catch((error) => {
          console.warn("[CommandPalette] 搜索对话失败", {
            query: trimmedQuery,
            error: error instanceof Error ? error.message : String(error)
          });
          if (!cancelled) {
            setResults([]);
          }
        })
        .finally(() => {
          if (!cancelled) {
            setSearching(false);
          }
        });
    }, 160);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, searchSessions, trimmedQuery]);

  return (
    <CommandDialog
      open={open}
      onOpenChange={setPaletteOpen}
      title={t("palette.title")}
      commandProps={{ shouldFilter: false }}
    >
      <CommandInput
        placeholder={t("palette.placeholder")}
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>{searching ? t("palette.searching") : t("palette.empty")}</CommandEmpty>
        <CommandGroup heading={t("palette.group")}>
          {visibleResults.map((result) => (
            <CommandItem
              key={result.session.id}
              value={`${result.session.title} ${result.session.id} ${
                result.matchType === "content" ? result.snippet : ""
              }`}
              onSelect={() => {
                void selectSession(result.session.id);
                setPaletteOpen(false);
              }}
            >
              <MessageSquare className="text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{result.session.title}</span>
                {result.matchType === "content" ? (
                  <span className="mt-0.5 block truncate text-micro text-muted-foreground">
                    {result.snippet}
                  </span>
                ) : null}
              </span>
              {result.session.projectId && projectName.has(result.session.projectId) ? (
                <span className="flex-none text-micro text-muted-foreground">
                  {projectName.get(result.session.projectId)}
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
