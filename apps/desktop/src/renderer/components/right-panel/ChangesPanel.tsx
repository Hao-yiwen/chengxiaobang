import {
  ChevronIcon,
  FolderIcon,
  GitBranchIcon,
  RefreshIcon
} from "@/assets/file-type-icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { GitChangeScope, GitChangesResult, GitFileChange } from "@chengxiaobang/shared";
import { DiffView } from "@/components/DiffView";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@/components/ui/tooltip";
import { resolveFileTypeIcon } from "@/lib/code-language-icons";
import { parseGitPatchDiff, type PatchDiffBlock } from "@/lib/diff";
import {
  gitStatusKind,
  type GitStatusKind
} from "@/lib/git-diff";
import { cn } from "@/lib/utils";
import { getApiClient, selectActiveProject, useAppStore } from "@/store";

const ICON_BUTTON =
  "flex size-7 flex-none items-center justify-center rounded-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40";

const CHANGE_GROUP_SCOPES: GitChangeScope[] = ["staged", "unstaged"];

/** 当前项目未提交变更的审查列表，默认折叠每个文件的 diff。 */
export function ChangesPanel() {
  const { t } = useTranslation();
  const project = useAppStore(selectActiveProject);
  const [changes, setChanges] = useState<GitChangesResult>();
  const [expandedFileKeys, setExpandedFileKeys] = useState<Set<string>>(() => new Set());
  const [expandedGroups, setExpandedGroups] = useState<Set<GitChangeScope>>(
    defaultExpandedGroups
  );
  const [expandedDirectoryKeys, setExpandedDirectoryKeys] = useState<Set<string>>(() => new Set());
  const [diffFiles, setDiffFiles] = useState<Map<string, GitFileChange>>(() => new Map());
  const [loadingDiffKeys, setLoadingDiffKeys] = useState<Set<string>>(() => new Set());
  const [diffErrors, setDiffErrors] = useState<Map<string, string>>(() => new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const projectId = project?.id;
  const gitRefreshToken = useAppStore((state) =>
    projectId ? (state.gitRefreshTokenByProjectId[projectId] ?? 0) : 0
  );

  const load = useCallback(async (reason: "initial" | "refresh" = "initial") => {
    const client = getApiClient();
    if (!client || !projectId) {
      return;
    }
    logChangesPanelInfo("开始加载项目审查变更", { projectId, reason });
    setLoading(true);
    setError(undefined);
    try {
      const nextChanges = await client.getGitChanges(projectId);
      logChangesPanelInfo("项目审查变更加载完成", {
        projectId,
        reason,
        isRepo: nextChanges.isRepo,
        fileCount: uniqueChangedFileCount(nextChanges.files),
        stagedCount: nextChanges.files.filter((file) => file.scope === "staged").length,
        unstagedCount: nextChanges.files.filter((file) => file.scope === "unstaged").length
      });
      setChanges(nextChanges);
      setExpandedDirectoryKeys(defaultExpandedDirectoryKeys(nextChanges.files));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      logChangesPanelError("加载 git 变更失败", { projectId, reason, error: message });
      setChanges(undefined);
      setExpandedDirectoryKeys(new Set());
      setDiffFiles(new Map());
      setLoadingDiffKeys(new Set());
      setDiffErrors(new Map());
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    setChanges(undefined);
    setExpandedFileKeys(new Set());
    setExpandedGroups(defaultExpandedGroups());
    setExpandedDirectoryKeys(new Set());
    setDiffFiles(new Map());
    setLoadingDiffKeys(new Set());
    setDiffErrors(new Map());
    setError(undefined);
    void load(gitRefreshToken > 0 ? "refresh" : "initial");
  }, [gitRefreshToken, load]);

  const stats = useMemo(() => sumGitChangeStats(changes?.files ?? []), [changes?.files]);

  const refresh = useCallback(() => {
    if (!projectId) {
      return;
    }
    logChangesPanelInfo("手动刷新审查变更", { projectId });
    setExpandedFileKeys(new Set());
    setExpandedGroups(defaultExpandedGroups());
    setExpandedDirectoryKeys(new Set());
    setDiffFiles(new Map());
    setLoadingDiffKeys(new Set());
    setDiffErrors(new Map());
    void load("refresh");
  }, [load, projectId]);

  const loadFileDiff = useCallback(async (file: GitFileChange) => {
    const key = changedFileKey(file);
    if (diffFiles.has(key) || loadingDiffKeys.has(key)) {
      return;
    }
    const client = getApiClient();
    if (!client?.getGitChangeDiff || !projectId) {
      setDiffErrors((current) => new Map(current).set(key, "当前后端不支持按文件加载 diff"));
      return;
    }
    logChangesPanelInfo("开始加载单文件审查 diff", {
      projectId,
      path: file.path,
      scope: file.scope
    });
    setLoadingDiffKeys((current) => new Set(current).add(key));
    setDiffErrors((current) => {
      const next = new Map(current);
      next.delete(key);
      return next;
    });
    try {
      const nextFile = await client.getGitChangeDiff(projectId, {
        scope: file.scope,
        path: file.path
      });
      setDiffFiles((current) => new Map(current).set(key, nextFile));
      setChanges((current) =>
        current
          ? {
              ...current,
              files: current.files.map((item) => (changedFileKey(item) === key ? nextFile : item))
            }
          : current
      );
      logChangesPanelInfo("单文件审查 diff 加载完成", {
        projectId,
        path: nextFile.path,
        scope: nextFile.scope,
        status: nextFile.status,
        additions: nextFile.additions,
        deletions: nextFile.deletions,
        emptyDiff: nextFile.diff.length === 0
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      logChangesPanelError("加载单文件审查 diff 失败", {
        projectId,
        path: file.path,
        scope: file.scope,
        error: message
      });
      setDiffErrors((current) => new Map(current).set(key, message));
    } finally {
      setLoadingDiffKeys((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  }, [diffFiles, loadingDiffKeys, projectId]);

  const toggleFile = useCallback((file: GitFileChange) => {
    const key = changedFileKey(file);
    const open = !expandedFileKeys.has(key);
    const nextFileKeys = new Set(expandedFileKeys);
    if (open) {
      nextFileKeys.add(key);
    } else {
      nextFileKeys.delete(key);
    }
    setExpandedFileKeys(nextFileKeys);
    logChangesPanelInfo("切换变更文件展开状态", {
      projectId,
      path: file.path,
      scope: file.scope,
      status: file.status,
      open
    });
    if (open) {
      void loadFileDiff(file);
    }
  }, [expandedFileKeys, loadFileDiff, projectId]);

  const toggleGroup = useCallback((scope: GitChangeScope) => {
    setExpandedGroups((current) => {
      const next = new Set(current);
      const open = !next.has(scope);
      if (open) {
        next.add(scope);
      } else {
        next.delete(scope);
      }
      logChangesPanelInfo("切换变更分组展开状态", { projectId, scope, open });
      return next;
    });
  }, [projectId]);

  const toggleDirectory = useCallback((scope: GitChangeScope, path: string) => {
    setExpandedDirectoryKeys((current) => {
      const next = new Set(current);
      const key = changedDirectoryKey(scope, path);
      const open = !next.has(key);
      if (open) {
        next.add(key);
      } else {
        next.delete(key);
      }
      logChangesPanelInfo("切换变更目录展开状态", { projectId, scope, path, open });
      return next;
    });
  }, [projectId]);

  if (!project) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-caption text-muted-foreground">
        {t("rightPanel.changesNoProject")}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ReviewToolbar
        projectName={project.name}
        projectPath={project.path}
        changes={changes}
        fileCount={uniqueChangedFileCount(changes?.files ?? [])}
        stats={stats}
        loading={loading}
        onRefresh={refresh}
      />
      <ReviewBody
        changes={changes}
        expandedFileKeys={expandedFileKeys}
        diffFiles={diffFiles}
        loadingDiffKeys={loadingDiffKeys}
        diffErrors={diffErrors}
        expandedDirectoryKeys={expandedDirectoryKeys}
        expandedGroups={expandedGroups}
        loading={loading}
        error={error}
        projectId={project.id}
        onToggleFile={toggleFile}
        onToggleDirectory={toggleDirectory}
        onToggleGroup={toggleGroup}
      />
    </div>
  );
}

function ReviewToolbar(props: {
  projectName: string;
  projectPath: string;
  changes: GitChangesResult | undefined;
  fileCount: number;
  stats: GitChangeStats | undefined;
  loading: boolean;
  onRefresh: () => void;
}) {
  const { t } = useTranslation();
  return (
    <header className="flex flex-none items-center justify-between gap-3 border-b px-4 py-2.5">
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <GitBranchIcon className="size-4 flex-none text-muted-foreground" />
          <p className="truncate text-caption font-medium text-foreground">{props.projectName}</p>
          {props.changes?.isRepo && props.stats ? (
            <span className="flex-none font-mono text-micro text-link">
              +{props.stats.additions.toLocaleString()}
            </span>
          ) : null}
          {props.changes?.isRepo && props.stats ? (
            <span className="flex-none font-mono text-micro text-destructive">
              -{props.stats.deletions.toLocaleString()}
            </span>
          ) : null}
        </div>
        <p className="mt-1 truncate font-mono text-micro text-muted-foreground" title={props.projectPath}>
          {props.changes?.isRepo
            ? t("rightPanel.changesFileCount", { count: props.fileCount })
            : props.projectPath}
        </p>
      </div>
      <button
        type="button"
        title={t("rightPanel.refresh")}
        disabled={props.loading}
        onClick={props.onRefresh}
        className={ICON_BUTTON}
      >
        <RefreshIcon className={cn("size-3.5", props.loading && "animate-spin")} />
      </button>
    </header>
  );
}

function ReviewBody(props: {
  changes: GitChangesResult | undefined;
  expandedFileKeys: Set<string>;
  diffFiles: Map<string, GitFileChange>;
  loadingDiffKeys: Set<string>;
  diffErrors: Map<string, string>;
  expandedDirectoryKeys: Set<string>;
  expandedGroups: Set<GitChangeScope>;
  loading: boolean;
  error: string | undefined;
  projectId: string;
  onToggleFile: (file: GitFileChange) => void;
  onToggleDirectory: (scope: GitChangeScope, path: string) => void;
  onToggleGroup: (scope: GitChangeScope) => void;
}) {
  const { t } = useTranslation();
  if (props.error) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-caption text-destructive">
        {t("rightPanel.changesLoadFailed")}：{props.error}
      </div>
    );
  }
  if (!props.changes && props.loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <RefreshIcon className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!props.changes) {
    return null;
  }
  if (!props.changes.isRepo) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-caption text-muted-foreground">
        {t("rightPanel.changesNotRepo")}
      </div>
    );
  }
  if (props.changes.files.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-caption text-muted-foreground">
        {t("rightPanel.changesEmpty")}
      </div>
    );
  }
  const groups = groupGitChanges(props.changes.files);
  return (
    // 顶部不留 padding：sticky top:0 会吸附在容器 padding 内沿，若保留 padding-top，
    // 这 12px 会成为缝隙，让上方文件的 diff 行从吸顶头上方透出。顶部间距改放到内容里。
    <div className="scrollbar-hidden min-h-0 flex-1 overflow-auto px-3 pb-3">
      <div className="space-y-2 pt-3">
        {groups.map((group) => (
          <ChangeScopeGroup
            key={group.scope}
            group={group}
            isExpanded={props.expandedGroups.has(group.scope)}
            expandedFileKeys={props.expandedFileKeys}
            diffFiles={props.diffFiles}
            loadingDiffKeys={props.loadingDiffKeys}
            diffErrors={props.diffErrors}
            expandedDirectoryKeys={props.expandedDirectoryKeys}
            projectId={props.projectId}
            onToggleGroup={() => props.onToggleGroup(group.scope)}
            onToggleFile={props.onToggleFile}
            onToggleDirectory={props.onToggleDirectory}
          />
        ))}
      </div>
    </div>
  );
}

interface GitChangeGroup {
  scope: GitChangeScope;
  files: GitFileChange[];
  tree: GitChangeTreeNode[];
  stats: GitChangeStats | undefined;
}

type GitChangeTreeNode = GitChangeDirectoryNode | GitChangeFileNode;

interface GitChangeDirectoryNode {
  kind: "directory";
  name: string;
  path: string;
  children: GitChangeTreeNode[];
  fileCount: number;
  stats: GitChangeStats | undefined;
}

interface GitChangeFileNode {
  kind: "file";
  name: string;
  path: string;
  file: GitFileChange;
  stats: GitChangeStats | undefined;
}

type MutableGitChangeTreeNode = MutableGitChangeDirectoryNode | MutableGitChangeFileNode;

interface MutableGitChangeDirectoryNode {
  kind: "directory";
  name: string;
  path: string;
  children: Map<string, MutableGitChangeTreeNode>;
}

interface MutableGitChangeFileNode {
  kind: "file";
  name: string;
  path: string;
  file: GitFileChange;
}

function ChangeScopeGroup({
  group,
  isExpanded,
  expandedFileKeys,
  diffFiles,
  loadingDiffKeys,
  diffErrors,
  expandedDirectoryKeys,
  projectId,
  onToggleGroup,
  onToggleDirectory,
  onToggleFile
}: {
  group: GitChangeGroup;
  isExpanded: boolean;
  expandedFileKeys: Set<string>;
  diffFiles: Map<string, GitFileChange>;
  loadingDiffKeys: Set<string>;
  diffErrors: Map<string, string>;
  expandedDirectoryKeys: Set<string>;
  projectId: string;
  onToggleGroup: () => void;
  onToggleDirectory: (scope: GitChangeScope, path: string) => void;
  onToggleFile: (file: GitFileChange) => void;
}) {
  const { t } = useTranslation();
  const actionLabel = isExpanded
    ? t("rightPanel.changesCollapseGroup")
    : t("rightPanel.changesExpandGroup");
  return (
    <section className="rounded-md border bg-card">
      <button
        type="button"
        aria-expanded={isExpanded}
        aria-label={`${actionLabel} ${t(`rightPanel.changeScopes.${group.scope}`)}`}
        onClick={onToggleGroup}
        className="flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/60"
      >
        <ChevronIcon
          className={cn(
            "size-3.5 flex-none text-muted-foreground transition-transform duration-200",
            !isExpanded && "-rotate-90"
          )}
        />
        <span className="min-w-0 flex-1 truncate text-caption font-medium text-foreground">
          {t(`rightPanel.changeScopes.${group.scope}`)}
        </span>
        <span className="flex-none font-mono text-micro text-muted-foreground">
          {t("rightPanel.changesGroupFileCount", { count: group.files.length })}
        </span>
        {group.stats ? (
          <>
            <span className="flex-none font-mono text-micro text-link">
              +{group.stats.additions.toLocaleString()}
            </span>
            <span className="flex-none font-mono text-micro text-destructive">
              -{group.stats.deletions.toLocaleString()}
            </span>
          </>
        ) : null}
      </button>
      {isExpanded && group.tree.length > 0 ? (
        <div className="border-t">
          {group.tree.map((node) => (
            <ChangeTreeNodeRow
              key={changeTreeNodeKey(group.scope, node)}
              node={node}
              scope={group.scope}
              depth={0}
              expandedDirectoryKeys={expandedDirectoryKeys}
              expandedFileKeys={expandedFileKeys}
              diffFiles={diffFiles}
              loadingDiffKeys={loadingDiffKeys}
              diffErrors={diffErrors}
              projectId={projectId}
              onToggleDirectory={onToggleDirectory}
              onToggleFile={onToggleFile}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function ChangeTreeNodeRow({
  node,
  scope,
  depth,
  expandedDirectoryKeys,
  expandedFileKeys,
  diffFiles,
  loadingDiffKeys,
  diffErrors,
  projectId,
  onToggleDirectory,
  onToggleFile
}: {
  node: GitChangeTreeNode;
  scope: GitChangeScope;
  depth: number;
  expandedDirectoryKeys: Set<string>;
  expandedFileKeys: Set<string>;
  diffFiles: Map<string, GitFileChange>;
  loadingDiffKeys: Set<string>;
  diffErrors: Map<string, string>;
  projectId: string;
  onToggleDirectory: (scope: GitChangeScope, path: string) => void;
  onToggleFile: (file: GitFileChange) => void;
}) {
  if (node.kind === "file") {
    const key = changedFileKey(node.file);
    const file = diffFiles.get(key) ?? node.file;
    const hasLoadedDiff = diffFiles.has(key) || node.file.diff.length > 0;
    return (
      <ChangedFileRow
        file={file}
        depth={depth}
        isExpanded={expandedFileKeys.has(key)}
        hasLoadedDiff={hasLoadedDiff}
        isDiffLoading={loadingDiffKeys.has(key)}
        diffError={diffErrors.get(key)}
        projectId={projectId}
        onToggle={() => onToggleFile(node.file)}
      />
    );
  }

  const isExpanded = expandedDirectoryKeys.has(changedDirectoryKey(scope, node.path));
  return (
    <ChangedDirectoryRow
      node={node}
      scope={scope}
      depth={depth}
      isExpanded={isExpanded}
      expandedDirectoryKeys={expandedDirectoryKeys}
      expandedFileKeys={expandedFileKeys}
      diffFiles={diffFiles}
      loadingDiffKeys={loadingDiffKeys}
      diffErrors={diffErrors}
      projectId={projectId}
      onToggle={() => onToggleDirectory(scope, node.path)}
      onToggleDirectory={onToggleDirectory}
      onToggleFile={onToggleFile}
    />
  );
}

function ChangedDirectoryRow({
  node,
  scope,
  depth,
  isExpanded,
  expandedDirectoryKeys,
  expandedFileKeys,
  diffFiles,
  loadingDiffKeys,
  diffErrors,
  projectId,
  onToggle,
  onToggleDirectory,
  onToggleFile
}: {
  node: GitChangeDirectoryNode;
  scope: GitChangeScope;
  depth: number;
  isExpanded: boolean;
  expandedDirectoryKeys: Set<string>;
  expandedFileKeys: Set<string>;
  diffFiles: Map<string, GitFileChange>;
  loadingDiffKeys: Set<string>;
  diffErrors: Map<string, string>;
  projectId: string;
  onToggle: () => void;
  onToggleDirectory: (scope: GitChangeScope, path: string) => void;
  onToggleFile: (file: GitFileChange) => void;
}) {
  const { t } = useTranslation();
  const actionLabel = isExpanded
    ? t("rightPanel.changesCollapseDirectory")
    : t("rightPanel.changesExpandDirectory");
  return (
    <div className="border-t first:border-t-0">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-expanded={isExpanded}
            aria-label={`${actionLabel} ${t(`rightPanel.changeScopes.${scope}`)} ${node.path}`}
            onClick={onToggle}
            className="flex w-full min-w-0 items-center gap-2 py-2 pr-3 text-left transition-colors hover:bg-muted/60"
            style={{ paddingLeft: changeTreeRowPadding(depth) }}
          >
            <ChevronIcon
              className={cn(
                "size-3.5 flex-none text-muted-foreground transition-transform duration-200",
                !isExpanded && "-rotate-90"
              )}
            />
            <FolderIcon aria-hidden className="cxb-svg-icon size-3.5 flex-none text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate font-mono text-micro font-medium text-foreground">
              {node.name}
            </span>
            <span className="flex-none font-mono text-micro text-muted-foreground">
              {t("rightPanel.changesGroupFileCount", { count: node.fileCount })}
            </span>
            {node.stats ? (
              <>
                <span className="flex-none font-mono text-micro text-link">
                  +{node.stats.additions.toLocaleString()}
                </span>
                <span className="flex-none font-mono text-micro text-destructive">
                  -{node.stats.deletions.toLocaleString()}
                </span>
              </>
            ) : null}
          </button>
        </TooltipTrigger>
        <TooltipContent
          collisionPadding={12}
          className="pointer-events-none max-w-[calc(100vw-32px)] whitespace-normal break-all font-mono text-micro leading-4 sm:max-w-[480px]"
        >
          {node.path}
        </TooltipContent>
      </Tooltip>
      {isExpanded ? (
        <div>
          {node.children.map((child) => (
            <ChangeTreeNodeRow
              key={changeTreeNodeKey(scope, child)}
              node={child}
              scope={scope}
              depth={depth + 1}
              expandedDirectoryKeys={expandedDirectoryKeys}
              expandedFileKeys={expandedFileKeys}
              diffFiles={diffFiles}
              loadingDiffKeys={loadingDiffKeys}
              diffErrors={diffErrors}
              projectId={projectId}
              onToggleDirectory={onToggleDirectory}
              onToggleFile={onToggleFile}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ChangedFileRow({
  file,
  depth,
  isExpanded,
  hasLoadedDiff,
  isDiffLoading,
  diffError,
  projectId,
  onToggle
}: {
  file: GitFileChange;
  depth: number;
  isExpanded: boolean;
  hasLoadedDiff: boolean;
  isDiffLoading: boolean;
  diffError: string | undefined;
  projectId: string;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const rowRef = useRef<HTMLDivElement>(null);
  const diffRef = useRef<HTMLDivElement>(null);
  const kind = gitStatusKind(file.status, file.scope);
  const FileIcon = resolveFileTypeIcon(file.path);
  const fileName = basenameOf(file.path);
  const actionLabel = isExpanded
    ? t("rightPanel.changesCollapseFile")
    : t("rightPanel.changesExpandFile");

  useEffect(() => {
    if (!isExpanded) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      (diffRef.current ?? rowRef.current)?.scrollIntoView?.({
        block: "nearest",
        inline: "nearest"
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [file.path, file.scope, isExpanded]);

  return (
    <div ref={rowRef} className="border-t first:border-t-0">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-expanded={isExpanded}
            aria-label={`${actionLabel} ${t(`rightPanel.changeScopes.${file.scope}`)} ${file.path}`}
            onClick={onToggle}
            className={cn(
              "flex w-full min-w-0 items-center gap-2 py-2 pr-3 text-left transition-colors hover:bg-muted/60",
              // 仅展开时让文件行头吸顶：sticky 被自身文件区块的高度约束，
              // 因此只有滚进这个文件的 diff 时它才贴顶，滚过即被下一个文件顶替。
              // bg-card 不透明以盖住下方滚动的 diff，z-30 高于 @pierre/diffs 内部 hunk 头(z-1)；
              // hover 必须用实色 bg-muted（而非基类的半透明 /60），否则悬浮态会透出下方 diff。
              isExpanded && "sticky top-0 z-30 border-b bg-card hover:bg-muted"
            )}
            style={{ paddingLeft: changeTreeRowPadding(depth) }}
          >
            <ChevronIcon
              className={cn(
                "size-3.5 flex-none text-muted-foreground transition-transform duration-200",
                !isExpanded && "-rotate-90"
              )}
            />
            <FileIcon aria-hidden className="cxb-svg-icon size-3.5 flex-none" />
            <span className="min-w-0 flex-1 truncate font-mono text-micro font-medium text-foreground">
              {fileName}
            </span>
            <span
              className={cn(
                "flex-none rounded-xs px-1.5 py-0.5 text-micro",
                statusBadgeClassName(kind)
              )}
            >
              {t(`rightPanel.gitStatus.${kind}`)}
            </span>
            {hasGitChangeStats(file) ? (
              <>
                <span className="flex-none font-mono text-micro text-link">
                  +{file.additions.toLocaleString()}
                </span>
                <span className="flex-none font-mono text-micro text-destructive">
                  -{file.deletions.toLocaleString()}
                </span>
              </>
            ) : null}
          </button>
        </TooltipTrigger>
        <TooltipContent
          collisionPadding={12}
          className="pointer-events-none max-w-[calc(100vw-32px)] whitespace-normal break-all font-mono text-micro leading-4 sm:max-w-[480px]"
        >
          {file.path}
        </TooltipContent>
      </Tooltip>
      {isExpanded ? (
        <div ref={diffRef}>
          <GitFileDiff
            file={file}
            projectId={projectId}
            hasLoadedDiff={hasLoadedDiff}
            loading={isDiffLoading}
            error={diffError}
          />
        </div>
      ) : null}
    </div>
  );
}

function basenameOf(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  if (!trimmed) {
    return path;
  }
  return trimmed.split(/[\\/]/).pop() ?? trimmed;
}

function GitFileDiff({
  file,
  projectId,
  hasLoadedDiff,
  loading,
  error
}: {
  file: GitFileChange;
  projectId: string;
  hasLoadedDiff: boolean;
  loading: boolean;
  error: string | undefined;
}) {
  const { t } = useTranslation();
  const cacheKeyPrefix = useMemo(
    () => `${projectId}:${file.scope}:${file.path}:${file.status}:${diffFingerprint(file.diff)}`,
    [file.diff, file.path, file.scope, file.status, projectId]
  );
  const blocks = useMemo(
    () =>
      parseGitPatchDiff({
        patch: file.diff,
        path: file.path,
        cacheKeyPrefix
      }),
    [cacheKeyPrefix, file.diff, file.path]
  );

  useEffect(() => {
    const rawBlocks = blocks.filter(isRawPatchBlock);
    if (rawBlocks.length === 0) {
      return;
    }
    console.warn("[changes-panel] Git diff patch 解析失败，改为展示原始内容", {
      projectId,
      path: file.path,
      scope: file.scope,
      errors: rawBlocks.map((block) => block.error)
    });
  }, [blocks, file.path, file.scope, projectId]);

  if (error) {
    return (
      <div className="flex min-h-[240px] items-center justify-center px-6 text-center text-caption text-destructive">
        {t("rightPanel.changesDiffLoadFailed")}：{error}
      </div>
    );
  }
  if (loading || !hasLoadedDiff) {
    return (
      <div className="flex min-h-[240px] items-center justify-center gap-2 px-6 text-center text-caption text-muted-foreground">
        <RefreshIcon className="size-4 animate-spin" />
        {t("rightPanel.changesDiffLoading")}
      </div>
    );
  }
  if (!file.diff) {
    return (
      <div className="flex min-h-[240px] items-center justify-center px-6 text-center text-caption text-muted-foreground">
        {t("rightPanel.changesNoTextDiff")}
      </div>
    );
  }
  return <DiffView blocks={blocks} height="review" />;
}

function isRawPatchBlock(block: PatchDiffBlock): block is Extract<PatchDiffBlock, { kind: "raw" }> {
  return block.kind === "raw";
}

function diffFingerprint(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return `${value.length}:${hash >>> 0}`;
}

function defaultExpandedGroups(): Set<GitChangeScope> {
  return new Set(CHANGE_GROUP_SCOPES);
}

function changedFileKey(file: Pick<GitFileChange, "path" | "scope">): string {
  return `${file.scope}:${file.path}`;
}

function changedDirectoryKey(scope: GitChangeScope, path: string): string {
  return `${scope}:${path}`;
}

function changeTreeNodeKey(scope: GitChangeScope, node: GitChangeTreeNode): string {
  return node.kind === "directory"
    ? changedDirectoryKey(scope, node.path)
    : changedFileKey(node.file);
}

function changeTreeRowPadding(depth: number): number {
  return 12 + depth * 16;
}

function uniqueChangedFileCount(files: GitFileChange[]): number {
  return new Set(files.map((file) => file.path)).size;
}

function groupGitChanges(files: GitFileChange[]): GitChangeGroup[] {
  return CHANGE_GROUP_SCOPES.map((scope) => {
    const scopedFiles = files.filter((file) => file.scope === scope);
    return {
      scope,
      files: scopedFiles,
      tree: buildGitChangeTree(scopedFiles),
      stats: sumGitChangeStats(scopedFiles)
    };
  });
}

function buildGitChangeTree(files: GitFileChange[]): GitChangeTreeNode[] {
  const root: MutableGitChangeDirectoryNode = {
    kind: "directory",
    name: "",
    path: "",
    children: new Map()
  };

  for (const file of files) {
    const segments = splitGitChangePath(file.path);
    const fileName = segments.at(-1) ?? file.path;
    let directory = root;

    for (let index = 0; index < segments.length - 1; index += 1) {
      const name = segments[index];
      const path = segments.slice(0, index + 1).join("/");
      const key = `directory:${name}`;
      const existing = directory.children.get(key);
      if (existing?.kind === "directory") {
        directory = existing;
        continue;
      }
      const nextDirectory: MutableGitChangeDirectoryNode = {
        kind: "directory",
        name,
        path,
        children: new Map()
      };
      directory.children.set(key, nextDirectory);
      directory = nextDirectory;
    }

    directory.children.set(`file:${file.path}`, {
      kind: "file",
      name: fileName,
      path: segments.join("/") || file.path,
      file
    });
  }

  return finalizeGitChangeDirectory(root).children;
}

function defaultExpandedDirectoryKeys(files: GitFileChange[]): Set<string> {
  const keys = new Set<string>();
  for (const file of files) {
    const segments = splitGitChangePath(file.path);
    for (let index = 1; index < segments.length; index += 1) {
      keys.add(changedDirectoryKey(file.scope, segments.slice(0, index).join("/")));
    }
  }
  return keys;
}

function splitGitChangePath(path: string): string[] {
  const segments = path.replace(/[\\/]+$/, "").split(/[\\/]/).filter(Boolean);
  return segments.length > 0 ? segments : [path];
}

function finalizeGitChangeDirectory(
  directory: MutableGitChangeDirectoryNode
): GitChangeDirectoryNode {
  const children = Array.from(directory.children.values())
    .map(finalizeGitChangeNode)
    .sort(compareGitChangeTreeNodes);
  return {
    kind: "directory",
    name: directory.name,
    path: directory.path,
    children,
    fileCount: children.reduce(
      (count, child) => count + (child.kind === "file" ? 1 : child.fileCount),
      0
    ),
    stats: sumChildGitChangeStats(children)
  };
}

function finalizeGitChangeNode(node: MutableGitChangeTreeNode): GitChangeTreeNode {
  if (node.kind === "file") {
    return {
      kind: "file",
      name: node.name,
      path: node.path,
      file: node.file,
      stats: sumGitChangeStats([node.file])
    };
  }
  return finalizeGitChangeDirectory(node);
}

function compareGitChangeTreeNodes(first: GitChangeTreeNode, second: GitChangeTreeNode): number {
  if (first.kind !== second.kind) {
    return first.kind === "directory" ? -1 : 1;
  }
  const byName = first.name.localeCompare(second.name, undefined, {
    numeric: true,
    sensitivity: "base"
  });
  return byName === 0 ? first.path.localeCompare(second.path) : byName;
}

function sumChildGitChangeStats(children: GitChangeTreeNode[]): GitChangeStats | undefined {
  let hasStats = false;
  const stats = children.reduce<GitChangeStats>(
    (nextStats, child) => {
      if (!child.stats) {
        return nextStats;
      }
      hasStats = true;
      return {
        additions: nextStats.additions + child.stats.additions,
        deletions: nextStats.deletions + child.stats.deletions
      };
    },
    { additions: 0, deletions: 0 }
  );
  return hasStats ? stats : undefined;
}

function sumGitChangeStats(
  files: Array<Pick<GitFileChange, "additions" | "deletions">>
): GitChangeStats | undefined {
  let hasStats = false;
  const stats = files.reduce<GitChangeStats>(
    (nextStats, file) => {
      if (!hasGitChangeStats(file)) {
        return nextStats;
      }
      hasStats = true;
      return {
        additions: nextStats.additions + file.additions,
        deletions: nextStats.deletions + file.deletions
      };
    },
    { additions: 0, deletions: 0 }
  );
  return hasStats ? stats : undefined;
}

type GitChangeStats = { additions: number; deletions: number };

function hasGitChangeStats(
  file: Pick<GitFileChange, "additions" | "deletions">
): file is { additions: number; deletions: number } {
  return typeof file.additions === "number" && typeof file.deletions === "number";
}

function logChangesPanelInfo(message: string, context: Record<string, unknown>): void {
  console.info(`[changes-panel] ${message} ${JSON.stringify(context)}`);
}

function logChangesPanelError(message: string, context: Record<string, unknown>): void {
  console.error(`[changes-panel] ${message} ${JSON.stringify(context)}`);
}

function statusBadgeClassName(kind: GitStatusKind): string {
  switch (kind) {
    case "added":
    case "untracked":
      return "bg-link-bg-soft text-link-deep";
    case "deleted":
      return "bg-error-soft text-error-deep";
    case "renamed":
      return "bg-soft-blue-surface text-soft-blue-foreground";
    case "modified":
    default:
      return "bg-canvas-soft-2 text-muted-foreground";
  }
}
