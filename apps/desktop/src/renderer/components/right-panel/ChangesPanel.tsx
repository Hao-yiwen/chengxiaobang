import {
  ChevronIcon,
  GitBranchIcon,
  RefreshIcon
} from "@/assets/file-type-icons";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { GitChangesResult, GitFileChange } from "@chengxiaobang/shared";
import { DiffView } from "@/components/DiffView";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@/components/ui/tooltip";
import { resolveFileTypeIcon } from "@/lib/code-language-icons";
import { parseGitPatchDiff, type PatchDiffBlock } from "@/lib/diff";
import {
  gitChangeStats,
  gitStatusKind,
  type GitStatusKind
} from "@/lib/git-diff";
import { cn } from "@/lib/utils";
import { getApiClient, selectActiveProject, useAppStore } from "@/store";

const ICON_BUTTON =
  "flex size-7 flex-none items-center justify-center rounded-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40";

/** 当前项目未提交变更的审查列表，默认折叠每个文件的 diff。 */
export function ChangesPanel() {
  const { t } = useTranslation();
  const project = useAppStore(selectActiveProject);
  const [changes, setChanges] = useState<GitChangesResult>();
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const projectId = project?.id;

  const load = useCallback(async (reason: "initial" | "refresh" = "initial") => {
    const client = getApiClient();
    if (!client || !projectId) {
      return;
    }
    console.info("[changes-panel] 开始加载项目审查变更", { projectId, reason });
    setLoading(true);
    setError(undefined);
    try {
      const nextChanges = await client.getGitChanges(projectId);
      console.info("[changes-panel] 项目审查变更加载完成", {
        projectId,
        reason,
        isRepo: nextChanges.isRepo,
        fileCount: nextChanges.files.length
      });
      setChanges(nextChanges);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      console.error("[changes-panel] 加载 git 变更失败", { projectId, reason, error: message });
      setChanges(undefined);
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    setChanges(undefined);
    setExpandedPaths(new Set());
    setError(undefined);
    void load("initial");
  }, [load]);

  const stats = useMemo(() => gitChangeStats(changes?.files ?? []), [changes?.files]);

  const refresh = useCallback(() => {
    if (!projectId) {
      return;
    }
    console.info("[changes-panel] 手动刷新审查变更", { projectId });
    setExpandedPaths(new Set());
    void load("refresh");
  }, [load, projectId]);

  const toggleFile = useCallback((file: GitFileChange) => {
    setExpandedPaths((current) => {
      const next = new Set(current);
      const open = !next.has(file.path);
      if (open) {
        next.add(file.path);
      } else {
        next.delete(file.path);
      }
      console.info("[changes-panel] 切换变更文件展开状态", {
        projectId,
        path: file.path,
        status: file.status,
        open
      });
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
        additions={stats.additions}
        deletions={stats.deletions}
        loading={loading}
        onRefresh={refresh}
      />
      <ReviewBody
        changes={changes}
        expandedPaths={expandedPaths}
        loading={loading}
        error={error}
        projectId={project.id}
        onToggleFile={toggleFile}
      />
    </div>
  );
}

function ReviewToolbar(props: {
  projectName: string;
  projectPath: string;
  changes: GitChangesResult | undefined;
  additions: number;
  deletions: number;
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
          {props.changes?.isRepo ? (
            <span className="flex-none font-mono text-micro text-link">
              +{props.additions.toLocaleString()}
            </span>
          ) : null}
          {props.changes?.isRepo ? (
            <span className="flex-none font-mono text-micro text-destructive">
              -{props.deletions.toLocaleString()}
            </span>
          ) : null}
        </div>
        <p className="mt-1 truncate font-mono text-micro text-muted-foreground" title={props.projectPath}>
          {props.changes?.isRepo
            ? t("rightPanel.changesFileCount", { count: props.changes.files.length })
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
  expandedPaths: Set<string>;
  loading: boolean;
  error: string | undefined;
  projectId: string;
  onToggleFile: (file: GitFileChange) => void;
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
  return (
    <div className="min-h-0 flex-1 overflow-auto px-3 py-3">
      <div className="space-y-2">
        {props.changes.files.map((file) => (
          <ChangedFileRow
            key={file.path}
            file={file}
            isExpanded={props.expandedPaths.has(file.path)}
            projectId={props.projectId}
            onToggle={() => props.onToggleFile(file)}
          />
        ))}
      </div>
    </div>
  );
}

function ChangedFileRow({
  file,
  isExpanded,
  projectId,
  onToggle
}: {
  file: GitFileChange;
  isExpanded: boolean;
  projectId: string;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const kind = gitStatusKind(file.status);
  const stats = useMemo(() => gitChangeStats([file]), [file]);
  const FileIcon = resolveFileTypeIcon(file.path);
  const fileName = basenameOf(file.path);
  const actionLabel = isExpanded
    ? t("rightPanel.changesCollapseFile")
    : t("rightPanel.changesExpandFile");
  return (
    <section className="overflow-hidden rounded-md border bg-card">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-expanded={isExpanded}
            aria-label={`${actionLabel} ${file.path}`}
            title={file.path}
            onClick={onToggle}
            className="flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/60"
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
            <span className="flex-none font-mono text-micro text-link">
              +{stats.additions.toLocaleString()}
            </span>
            <span className="flex-none font-mono text-micro text-destructive">
              -{stats.deletions.toLocaleString()}
            </span>
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-[480px] break-all font-mono text-micro">
          {file.path}
        </TooltipContent>
      </Tooltip>
      {isExpanded ? (
        <div className="border-t">
          <GitFileDiff file={file} projectId={projectId} />
        </div>
      ) : null}
    </section>
  );
}

function basenameOf(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  if (!trimmed) {
    return path;
  }
  return trimmed.split(/[\\/]/).pop() ?? trimmed;
}

function GitFileDiff({ file, projectId }: { file: GitFileChange; projectId: string }) {
  const { t } = useTranslation();
  const cacheKeyPrefix = useMemo(
    () => `${projectId}:${file.path}:${file.status}:${diffFingerprint(file.diff)}`,
    [file.diff, file.path, file.status, projectId]
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
      errors: rawBlocks.map((block) => block.error)
    });
  }, [blocks, file.path, projectId]);

  if (!file.diff) {
    return (
      <div className="flex min-h-[160px] items-center justify-center px-6 text-center text-caption text-muted-foreground">
        {t("rightPanel.changesBinaryFile")}
      </div>
    );
  }
  return <DiffView blocks={blocks} />;
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
