import {
  ArrowClockwiseIcon as RefreshCw,
  CaretRightIcon as ChevronRight
} from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { GitChangesResult, GitFileChange } from "@chengxiaobang/shared";
import { DiffView } from "@/components/DiffView";
import { unifiedDiffToLines, gitStatusKind } from "@/lib/git-diff";
import { cn } from "@/lib/utils";
import { getApiClient, selectActiveProject, useAppStore } from "@/store";

/** Read-only view of the active project's uncommitted git changes. */
export function ChangesPanel() {
  const { t } = useTranslation();
  const project = useAppStore(selectActiveProject);
  const [changes, setChanges] = useState<GitChangesResult>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const projectId = project?.id;

  const load = useCallback(async () => {
    const client = getApiClient();
    if (!client || !projectId) {
      return;
    }
    setLoading(true);
    setError(undefined);
    try {
      setChanges(await client.getGitChanges(projectId));
    } catch (cause) {
      console.error("[changes-panel] 加载 git 变更失败:", cause);
      setChanges(undefined);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    setChanges(undefined);
    setError(undefined);
    void load();
  }, [load]);

  if (!project) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-caption text-muted-foreground">
        {t("rightPanel.changesNoProject")}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-none items-center justify-between gap-2 border-b px-4 py-2">
        <span className="truncate text-micro text-muted-foreground">
          {changes?.isRepo
            ? t("rightPanel.changesFileCount", { count: changes.files.length })
            : ""}
        </span>
        <button
          type="button"
          title={t("rightPanel.refresh")}
          disabled={loading}
          onClick={() => void load()}
          className="flex size-7 flex-none items-center justify-center rounded-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
        >
          <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {error ? (
          <p className="px-1 text-caption text-destructive">
            {t("rightPanel.changesLoadFailed")}：{error}
          </p>
        ) : !changes ? null : !changes.isRepo ? (
          <p className="px-1 text-caption text-muted-foreground">
            {t("rightPanel.changesNotRepo")}
          </p>
        ) : changes.files.length === 0 ? (
          <p className="px-1 text-caption text-muted-foreground">
            {t("rightPanel.changesEmpty")}
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {changes.files.map((file) => (
              <ChangedFileRow key={`${file.status}:${file.path}`} file={file} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ChangedFileRow({ file }: { file: GitFileChange }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="overflow-hidden rounded-sm border bg-card">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-canvas-soft-2"
      >
        <ChevronRight
          className={cn(
            "size-3.5 flex-none text-muted-foreground transition-transform",
            expanded && "rotate-90"
          )}
        />
        <span className="min-w-0 flex-1 truncate font-mono text-micro text-foreground">
          {file.path}
        </span>
        <span className="flex-none rounded-xs bg-canvas-soft-2 px-1.5 py-0.5 text-micro text-muted-foreground">
          {t(`rightPanel.gitStatus.${gitStatusKind(file.status)}`)}
        </span>
      </button>
      {expanded ? (
        file.diff ? (
          <DiffView lines={unifiedDiffToLines(file.diff)} />
        ) : (
          <p className="border-t px-3 py-2 text-micro text-muted-foreground">
            {t("rightPanel.changesBinaryFile")}
          </p>
        )
      ) : null}
    </div>
  );
}
