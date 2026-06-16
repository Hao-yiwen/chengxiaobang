import {
  ArrowTopRightIcon,
  GitBranchIcon,
  RefreshIcon,
  TextDocumentGrayIcon
} from "@/assets/file-type-icons";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { GitChangesResult, GitFileChange } from "@chengxiaobang/shared";
import { DiffView } from "@/components/DiffView";
import {
  gitChangeStats,
  gitStatusKind,
  unifiedDiffToLines,
  type GitStatusKind
} from "@/lib/git-diff";
import { cn } from "@/lib/utils";
import { getApiClient, selectActiveProject, useAppStore } from "@/store";
import { ProjectFileTree, gitStatusKindByPath } from "./ProjectFileTree";

const ICON_BUTTON =
  "flex size-7 flex-none items-center justify-center rounded-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40";

/** 当前项目未提交变更的审查工作台：左侧 diff，右侧项目文件树。 */
export function ChangesPanel() {
  const { t } = useTranslation();
  const project = useAppStore(selectActiveProject);
  const openFilePreview = useAppStore((state) => state.openFilePreview);
  const [changes, setChanges] = useState<GitChangesResult>();
  const [selectedPath, setSelectedPath] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const projectId = project?.id;

  const load = useCallback(async () => {
    const client = getApiClient();
    if (!client || !projectId) {
      return;
    }
    console.info("[changes-panel] 开始加载项目审查变更", { projectId });
    setLoading(true);
    setError(undefined);
    try {
      const nextChanges = await client.getGitChanges(projectId);
      console.info("[changes-panel] 项目审查变更加载完成", {
        projectId,
        isRepo: nextChanges.isRepo,
        fileCount: nextChanges.files.length
      });
      setChanges(nextChanges);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      console.error("[changes-panel] 加载 git 变更失败", { projectId, error: message });
      setChanges(undefined);
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    setChanges(undefined);
    setSelectedPath(undefined);
    setError(undefined);
    void load();
  }, [load]);

  const fileByPath = useMemo(() => {
    const map = new Map<string, GitFileChange>();
    for (const file of changes?.files ?? []) {
      map.set(file.path, file);
    }
    return map;
  }, [changes?.files]);

  useEffect(() => {
    if (!changes?.isRepo || changes.files.length === 0) {
      setSelectedPath(undefined);
      return;
    }
    if (!selectedPath || !fileByPath.has(selectedPath)) {
      const firstPath = changes.files[0]?.path;
      console.debug("[changes-panel] 选中首个变更文件", { projectId, path: firstPath });
      setSelectedPath(firstPath);
    }
  }, [changes, fileByPath, projectId, selectedPath]);

  const selectedFile = selectedPath ? fileByPath.get(selectedPath) : undefined;
  const stats = useMemo(() => gitChangeStats(changes?.files ?? []), [changes?.files]);
  const statusByPath = useMemo(
    () => gitStatusKindByPath(changes?.files ?? []),
    [changes?.files]
  );

  function openTreeFile(path: string): void {
    const changedFile = fileByPath.get(path);
    if (changedFile) {
      console.info("[changes-panel] 从文件树切换审查文件", {
        projectId,
        path,
        status: changedFile.status
      });
      setSelectedPath(path);
      return;
    }
    console.info("[changes-panel] 文件树打开未变更文件预览", { projectId, path });
    openFilePreview(path);
  }

  function openSelectedFilePreview(): void {
    if (!selectedFile) {
      return;
    }
    console.info("[changes-panel] 从审查视图打开文件预览", {
      projectId,
      path: selectedFile.path
    });
    openFilePreview(selectedFile.path);
  }

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
        onRefresh={() => void load()}
      />
      <div className="flex min-h-0 flex-1">
        <section className="min-w-0 flex-1 overflow-hidden">
          <ReviewBody
            changes={changes}
            selectedFile={selectedFile}
            loading={loading}
            error={error}
            onOpenPreview={openSelectedFilePreview}
          />
        </section>
        {changes?.isRepo ? (
          <ProjectFileTree
            project={project}
            selectedPath={selectedPath}
            statusByPath={statusByPath}
            title={t("rightPanel.reviewFilesTitle")}
            showProjectPath={false}
            onOpenFile={openTreeFile}
            className="w-[288px] flex-none border-l"
          />
        ) : null}
      </div>
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
  selectedFile: GitFileChange | undefined;
  loading: boolean;
  error: string | undefined;
  onOpenPreview: () => void;
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
  if (!props.selectedFile) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-caption text-muted-foreground">
        {t("rightPanel.reviewSelectFile")}
      </div>
    );
  }
  return <SelectedFileDiff file={props.selectedFile} onOpenPreview={props.onOpenPreview} />;
}

function SelectedFileDiff(props: { file: GitFileChange; onOpenPreview: () => void }) {
  const { t } = useTranslation();
  const kind = gitStatusKind(props.file.status);
  const lines = useMemo(() => unifiedDiffToLines(props.file.diff), [props.file.diff]);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-none items-center justify-between gap-3 border-b px-4 py-2.5">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <TextDocumentGrayIcon className="size-4 flex-none text-muted-foreground" />
            <p className="truncate font-mono text-micro font-medium text-foreground">
              {props.file.path}
            </p>
            <span
              className={cn(
                "flex-none rounded-xs px-1.5 py-0.5 text-micro",
                statusBadgeClassName(kind)
              )}
            >
              {t(`rightPanel.gitStatus.${kind}`)}
            </span>
          </div>
        </div>
        <button
          type="button"
          title={t("rightPanel.reviewOpenFilePreview")}
          onClick={props.onOpenPreview}
          className={ICON_BUTTON}
        >
          <ArrowTopRightIcon className="size-3.5" />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-hidden">
        {props.file.diff ? (
          <DiffView lines={lines} height="fill" />
        ) : (
          <div className="flex h-full items-center justify-center px-6 text-center text-caption text-muted-foreground">
            {t("rightPanel.changesBinaryFile")}
          </div>
        )}
      </div>
    </div>
  );
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
