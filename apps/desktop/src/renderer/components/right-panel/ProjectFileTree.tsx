import {
  CaretDownIcon as ChevronDown,
  CaretRightIcon as ChevronRight,
  CircleNotchIcon as Loader2,
  MagnifyingGlassIcon as Search,
  WarningCircleIcon as WarningCircle
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { Project, ProjectFileEntry } from "@chengxiaobang/shared";
import { resolveFileTypeIcon } from "@/lib/code-language-icons";
import { gitStatusKind, type GitStatusKind } from "@/lib/git-diff";
import { cn } from "@/lib/utils";
import { getApiClient } from "@/store";

interface ProjectFileTreeProps {
  project: Project;
  selectedPath?: string;
  statusByPath?: Record<string, GitStatusKind>;
  title?: string;
  className?: string;
  showProjectPath?: boolean;
  onOpenFile(path: string): void;
}

type SearchState =
  | { status: "idle"; results: string[] }
  | { status: "loading"; results: string[] }
  | { status: "error"; results: string[]; error: string };

const ROOT_DIRECTORY = ".";
const TREE_ROW_HEIGHT = "h-7";

/** 项目文件树：右侧工作台共用的文件导航、搜索与选中态。 */
export function ProjectFileTree({
  project,
  selectedPath,
  statusByPath = {},
  title,
  className,
  showProjectPath = true,
  onOpenFile
}: ProjectFileTreeProps) {
  const { t } = useTranslation();
  const [entriesByDirectory, setEntriesByDirectory] = useState<Record<string, ProjectFileEntry[]>>(
    {}
  );
  const [expandedDirectories, setExpandedDirectories] = useState<Record<string, true>>({
    [ROOT_DIRECTORY]: true
  });
  const [loadingDirectories, setLoadingDirectories] = useState<Record<string, true>>({});
  const [error, setError] = useState<string | undefined>();
  const [query, setQuery] = useState("");
  const [searchState, setSearchState] = useState<SearchState>({ status: "idle", results: [] });
  const loadedDirectoriesRef = useRef<Set<string>>(new Set());

  const selectedRelativePath = useMemo(() => normalizeTreePath(selectedPath), [selectedPath]);
  const trimmedQuery = query.trim();

  const loadDirectory = useCallback(
    async (directory: string, options: { force?: boolean } = {}) => {
      if (!options.force && loadedDirectoriesRef.current.has(directory)) {
        return;
      }
      console.debug("[ProjectFileTree] 读取项目目录", {
        projectId: project.id,
        directory
      });
      const client = getApiClient();
      if (!client?.listProjectDirectory) {
        console.warn("[ProjectFileTree] 文件树目录接口不可用", {
          projectId: project.id,
          directory
        });
        setError(t("rightPanel.projectFilesLoadFailed"));
        return;
      }
      setLoadingDirectories((current) => ({ ...current, [directory]: true }));
      setError(undefined);
      try {
        const entries = await client.listProjectDirectory(project.id, directory);
        loadedDirectoriesRef.current.add(directory);
        console.info("[ProjectFileTree] 项目目录读取完成", {
          projectId: project.id,
          directory,
          count: entries.length
        });
        setEntriesByDirectory((current) => ({ ...current, [directory]: entries }));
      } catch (loadError) {
        const message = loadError instanceof Error ? loadError.message : String(loadError);
        console.warn("[ProjectFileTree] 项目目录读取失败", {
          projectId: project.id,
          directory,
          error: message
        });
        setError(message);
      } finally {
        setLoadingDirectories((current) => {
          const next = { ...current };
          delete next[directory];
          return next;
        });
      }
    },
    [project.id, t]
  );

  useEffect(() => {
    loadedDirectoriesRef.current = new Set();
    setEntriesByDirectory({});
    setExpandedDirectories({ [ROOT_DIRECTORY]: true });
    setLoadingDirectories({});
    setError(undefined);
    void loadDirectory(ROOT_DIRECTORY, { force: true });
  }, [loadDirectory, project.id, project.path]);

  useEffect(() => {
    if (!selectedRelativePath) {
      return;
    }
    const ancestors = ancestorDirectories(selectedRelativePath);
    if (ancestors.length === 0) {
      return;
    }
    console.debug("[ProjectFileTree] 展开选中文件的父目录", {
      projectId: project.id,
      selectedPath: selectedRelativePath,
      ancestors
    });
    setExpandedDirectories((current) => {
      const next = { ...current };
      for (const directory of ancestors) {
        next[directory] = true;
      }
      return next;
    });
    void (async () => {
      for (const directory of ancestors) {
        await loadDirectory(directory);
      }
    })();
  }, [loadDirectory, project.id, selectedRelativePath]);

  useEffect(() => {
    if (!trimmedQuery) {
      setSearchState({ status: "idle", results: [] });
      return;
    }
    const client = getApiClient();
    if (!client?.listProjectFiles) {
      console.warn("[ProjectFileTree] 文件搜索接口不可用", { projectId: project.id });
      setSearchState({
        status: "error",
        results: [],
        error: t("rightPanel.projectFilesLoadFailed")
      });
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      console.debug("[ProjectFileTree] 搜索项目文件", {
        projectId: project.id,
        query: trimmedQuery
      });
      setSearchState((current) => ({ status: "loading", results: current.results }));
      void client.listProjectFiles(project.id, trimmedQuery).then(
        (results) => {
          if (cancelled) {
            return;
          }
          console.info("[ProjectFileTree] 项目文件搜索完成", {
            projectId: project.id,
            query: trimmedQuery,
            count: results.length
          });
          setSearchState({ status: "idle", results });
        },
        (searchError) => {
          if (cancelled) {
            return;
          }
          const message = searchError instanceof Error ? searchError.message : String(searchError);
          console.warn("[ProjectFileTree] 项目文件搜索失败", {
            projectId: project.id,
            query: trimmedQuery,
            error: message
          });
          setSearchState({ status: "error", results: [], error: message });
        }
      );
    }, 160);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [project.id, t, trimmedQuery]);

  function toggleDirectory(entry: ProjectFileEntry): void {
    const isExpanded = Boolean(expandedDirectories[entry.path]);
    console.debug("[ProjectFileTree] 切换目录展开状态", {
      projectId: project.id,
      path: entry.path,
      expanded: !isExpanded
    });
    setExpandedDirectories((current) => {
      const next = { ...current };
      if (isExpanded) {
        delete next[entry.path];
      } else {
        next[entry.path] = true;
      }
      return next;
    });
    if (!isExpanded) {
      void loadDirectory(entry.path);
    }
  }

  function openFile(path: string): void {
    console.info("[ProjectFileTree] 打开项目文件", {
      projectId: project.id,
      path
    });
    onOpenFile(path);
  }

  const rootEntries = entriesByDirectory[ROOT_DIRECTORY] ?? [];
  const rootLoading = Boolean(loadingDirectories[ROOT_DIRECTORY]) && rootEntries.length === 0;

  return (
    <aside className={cn("flex h-full min-h-0 flex-col bg-background", className)}>
      <div className="flex-none border-b px-4 py-3">
        <p className="text-caption font-medium text-foreground">
          {title ?? t("rightPanel.projectFilesTitle")}
        </p>
        {showProjectPath ? (
          <p className="mt-1 truncate font-mono text-micro text-muted-foreground" title={project.path}>
            {project.path}
          </p>
        ) : null}
        <label className="mt-3 flex h-8 items-center gap-2 rounded-sm border bg-card px-2.5 text-muted-foreground focus-within:border-hairline-strong">
          <Search className="size-3.5 flex-none" />
          <input
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder={t("rightPanel.projectFilesSearchPlaceholder")}
            className="min-w-0 flex-1 bg-transparent text-caption text-foreground outline-none placeholder:text-muted-foreground"
          />
          {searchState.status === "loading" ? <Loader2 className="size-3 animate-spin" /> : null}
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {trimmedQuery ? (
          <SearchResults
            query={trimmedQuery}
            state={searchState}
            selectedPath={selectedRelativePath}
            statusByPath={statusByPath}
            onOpenFile={openFile}
          />
        ) : rootLoading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <LoadFailure message={error} onRetry={() => void loadDirectory(ROOT_DIRECTORY, { force: true })} />
        ) : rootEntries.length > 0 ? (
          rootEntries.map((entry) => renderEntry(entry, 0))
        ) : (
          <div className="flex h-full items-center justify-center px-4 text-center text-caption text-muted-foreground">
            {t("rightPanel.projectFilesEmpty")}
          </div>
        )}
      </div>
    </aside>
  );

  function renderEntry(entry: ProjectFileEntry, depth: number): ReactNode {
    const isDirectory = entry.type === "directory";
    const isExpanded = Boolean(expandedDirectories[entry.path]);
    const children = entriesByDirectory[entry.path] ?? [];
    const loading = Boolean(loadingDirectories[entry.path]);
    const isSelected = selectedRelativePath === entry.path;

    return (
      <div key={entry.path}>
        <button
          type="button"
          onClick={() => (isDirectory ? toggleDirectory(entry) : openFile(entry.path))}
          className={cn(
            "flex w-full min-w-0 items-center gap-1 rounded-xs px-1.5 pr-2 text-left text-caption text-foreground transition-colors hover:bg-muted",
            TREE_ROW_HEIGHT,
            isSelected && "bg-muted"
          )}
          title={entry.path}
        >
          <TreeIndentGuides depth={depth} />
          {isDirectory ? (
            isExpanded ? (
              <ChevronDown className="size-3.5 flex-none text-muted-foreground" />
            ) : (
              <ChevronRight className="size-3.5 flex-none text-muted-foreground" />
            )
          ) : (
            <span className="w-3.5 flex-none" />
          )}
          {isDirectory ? null : <FileTypeIcon path={entry.path} />}
          <span className="min-w-0 flex-1 truncate font-mono text-micro">{entry.name}</span>
          {loading ? <Loader2 className="size-3 animate-spin text-muted-foreground" /> : null}
          {!isDirectory ? <GitStatusMark kind={statusByPath[entry.path]} /> : null}
        </button>
        {isDirectory && isExpanded
          ? children.map((child) => renderEntry(child, depth + 1))
          : null}
      </div>
    );
  }
}

function TreeIndentGuides({ depth }: { depth: number }) {
  if (depth <= 0) {
    return null;
  }
  return (
    <span className="flex h-full flex-none" aria-hidden="true">
      {Array.from({ length: depth }).map((_, index) => (
        <span key={index} className="relative h-full w-3.5 flex-none">
          <span
            data-testid="project-file-tree-guide"
            className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border"
          />
        </span>
      ))}
    </span>
  );
}

function SearchResults(props: {
  query: string;
  state: SearchState;
  selectedPath?: string;
  statusByPath: Record<string, GitStatusKind>;
  onOpenFile(path: string): void;
}) {
  const { t } = useTranslation();
  if (props.state.status === "error") {
    return <LoadFailure message={props.state.error} />;
  }
  if (props.state.status === "loading" && props.state.results.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (props.state.results.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-caption text-muted-foreground">
        {t("rightPanel.projectFilesSearchEmpty", { query: props.query })}
      </div>
    );
  }
  return (
    <div className="space-y-0.5">
      {props.state.results.map((path) => {
        const isSelected = props.selectedPath === path;
        return (
          <button
            key={path}
            type="button"
            onClick={() => props.onOpenFile(path)}
            className={cn(
              "flex h-7 w-full min-w-0 items-center gap-1.5 rounded-xs px-2 text-left text-caption text-foreground transition-colors hover:bg-muted",
              isSelected && "bg-muted"
            )}
            title={path}
          >
            <FileTypeIcon path={path} />
            <span className="min-w-0 flex-1 truncate font-mono text-micro">{path}</span>
            <GitStatusMark kind={props.statusByPath[path]} />
          </button>
        );
      })}
    </div>
  );
}

function FileTypeIcon({ path }: { path: string }) {
  const Icon = resolveFileTypeIcon(path);
  return <Icon aria-hidden className="cxb-svg-icon size-3.5 flex-none" />;
}

function LoadFailure(props: { message: string; onRetry?: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center text-caption text-muted-foreground">
      <WarningCircle className="size-5 text-warning" />
      <p>{`${t("rightPanel.projectFilesLoadFailed")}：${props.message}`}</p>
      {props.onRetry ? (
        <button
          type="button"
          onClick={props.onRetry}
          className="rounded-sm border bg-card px-3 py-1.5 text-micro text-foreground transition-colors hover:bg-muted"
        >
          {t("rightPanel.refresh")}
        </button>
      ) : null}
    </div>
  );
}

function GitStatusMark({ kind }: { kind?: GitStatusKind }) {
  const { t } = useTranslation();
  if (!kind) {
    return null;
  }
  return (
    <span
      title={t(`rightPanel.gitStatus.${kind}`)}
      className={cn(
        "size-1.5 flex-none rounded-full",
        kind === "deleted"
          ? "bg-destructive"
          : kind === "untracked" || kind === "added"
            ? "bg-link"
            : "bg-warning"
      )}
    />
  );
}

function normalizeTreePath(path: string | undefined): string | undefined {
  if (!path) {
    return undefined;
  }
  const normalized = path.replace(/\\/gu, "/").replace(/^\.\/+/u, "");
  if (!normalized || normalized === "." || normalized.startsWith("/")) {
    return undefined;
  }
  return normalized;
}

function ancestorDirectories(path: string): string[] {
  const parts = path.split("/").filter(Boolean);
  if (parts.length <= 1) {
    return [];
  }
  const directories: string[] = [];
  for (let index = 1; index < parts.length; index += 1) {
    directories.push(parts.slice(0, index).join("/"));
  }
  return directories;
}

export function gitStatusKindByPath(files: Array<{ path: string; status: string }>): Record<string, GitStatusKind> {
  return Object.fromEntries(files.map((file) => [file.path, gitStatusKind(file.status)]));
}
