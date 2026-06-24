import {
  GitBranchIcon,
  RefreshIcon,
  XMarkIcon
} from "@/assets/file-type-icons";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import type { GitGraphCommit, GitGraphRef, GitGraphResult } from "@chengxiaobang/shared";
import { cn } from "@/lib/utils";
import { getApiClient, selectActiveProject, useAppStore } from "@/store";

const ROW_HEIGHT = 34;
const LANE_GAP = 18;
const LANE_PADDING = 16;
const GRAPH_MIN_WIDTH = 112;
const ICON_BUTTON =
  "flex size-7 flex-none items-center justify-center rounded-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40";

const GRAPH_COLORS = [
  "rgb(var(--warning))",
  "rgb(var(--link))",
  "rgb(var(--soft-blue))",
  "rgb(var(--success))",
  "rgb(var(--violet))",
  "rgb(var(--error))"
];

interface GraphPath {
  key: string;
  d: string;
  color: string;
}

interface GraphDot {
  key: string;
  x: number;
  y: number;
  color: string;
}

interface GraphLayout {
  width: number;
  height: number;
  paths: GraphPath[];
  dots: GraphDot[];
}

/** 独立 Git 图谱弹窗：只展示提交 DAG，不承载 Git 操作。 */
export function GitGraphDialog({
  open,
  onOpenChange
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  const { t } = useTranslation();
  const project = useAppStore(selectActiveProject);
  const projectId = project?.id;
  const gitRefreshToken = useAppStore((state) =>
    projectId ? (state.gitRefreshTokenByProjectId[projectId] ?? 0) : 0
  );
  const [graph, setGraph] = useState<GitGraphResult>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [selectedCommitHash, setSelectedCommitHash] = useState<string>();

  const load = useCallback(async (reason: "initial" | "refresh" = "initial") => {
    const client = getApiClient();
    if (!projectId || !open) {
      return;
    }
    if (!client?.getGitGraph) {
      setError(t("gitGraph.unsupported"));
      return;
    }
    console.debug("[git-graph-dialog] 开始加载 Git 图谱", { projectId, reason });
    setLoading(true);
    setError(undefined);
    try {
      const nextGraph = await client.getGitGraph(projectId);
      console.info("[git-graph-dialog] Git 图谱加载完成", {
        projectId,
        reason,
        isRepo: nextGraph.isRepo,
        commitCount: nextGraph.commits.length
      });
      setGraph(nextGraph);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      console.warn("[git-graph-dialog] Git 图谱加载失败", {
        projectId,
        reason,
        error: message
      });
      setGraph(undefined);
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [open, projectId, t]);

  useEffect(() => {
    if (!open) {
      return;
    }
    setGraph(undefined);
    setError(undefined);
    setSelectedCommitHash(undefined);
    void load(gitRefreshToken > 0 ? "refresh" : "initial");
  }, [gitRefreshToken, load, open]);

  const refresh = useCallback(() => {
    if (!projectId) {
      return;
    }
    void load("refresh");
  }, [load, projectId]);

  const layout = useMemo(
    () => buildGitGraphLayout(graph?.commits ?? []),
    [graph?.commits]
  );
  const selectedCommit = useMemo(
    () => graph?.commits.find((commit) => commit.hash === selectedCommitHash),
    [graph?.commits, selectedCommitHash]
  );
  useEffect(() => {
    if (!selectedCommitHash || !graph) {
      return;
    }
    if (!graph.commits.some((commit) => commit.hash === selectedCommitHash)) {
      setSelectedCommitHash(undefined);
    }
  }, [graph, selectedCommitHash]);
  const gridTemplateColumns = `${layout.width}px minmax(360px, 1fr) 120px 120px 92px`;
  const tableMinWidth = layout.width + 360 + 120 + 120 + 92;

  if (!open) {
    return null;
  }

  const dialog = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("gitGraph.title")}
      data-testid="git-graph-dialog"
      className="pointer-events-auto fixed inset-0 z-[120] flex items-center justify-center bg-black/45 p-5"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onOpenChange(false);
        }
      }}
    >
      <section className="flex h-[min(720px,calc(100vh-48px))] w-[min(1120px,calc(100vw-40px))] min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-canvas text-caption text-foreground">
        <header className="flex h-11 flex-none items-center justify-between border-b px-3">
          <div className="flex min-w-0 items-center gap-2">
            <GitBranchIcon className="size-4 flex-none text-muted-foreground" />
            <h2 className="truncate text-caption font-normal text-foreground">
              {t("gitGraph.title")}
            </h2>
          </div>
          <div className="flex flex-none items-center gap-1">
            <button
              type="button"
              title={t("rightPanel.refresh")}
              aria-label={t("rightPanel.refresh")}
              onClick={refresh}
              disabled={loading}
              className={ICON_BUTTON}
            >
              <RefreshIcon className={cn("size-4", loading && "animate-spin")} />
            </button>
            <button
              type="button"
              title={t("rightPanel.close")}
              aria-label={t("rightPanel.close")}
              onClick={() => onOpenChange(false)}
              className={ICON_BUTTON}
            >
              <XMarkIcon className="size-4" />
            </button>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-hidden bg-background">
          <GraphBody
            graph={graph}
            loading={loading}
            error={error}
            layout={layout}
            gridTemplateColumns={gridTemplateColumns}
            tableMinWidth={tableMinWidth}
            selectedCommit={selectedCommit}
            selectedCommitHash={selectedCommitHash}
            onSelectCommit={setSelectedCommitHash}
          />
        </div>
      </section>
    </div>
  );
  return createPortal(dialog, document.body);
}

function GraphBody({
  graph,
  loading,
  error,
  layout,
  gridTemplateColumns,
  tableMinWidth,
  selectedCommit,
  selectedCommitHash,
  onSelectCommit
}: {
  graph?: GitGraphResult;
  loading: boolean;
  error?: string;
  layout: GraphLayout;
  gridTemplateColumns: string;
  tableMinWidth: number;
  selectedCommit?: GitGraphCommit;
  selectedCommitHash?: string;
  onSelectCommit(hash: string): void;
}) {
  const { t } = useTranslation();

  if (loading && !graph) {
    return <PanelMessage message={t("gitGraph.loading")} />;
  }
  if (error) {
    return <PanelMessage title={t("gitGraph.loadFailed")} message={error} />;
  }
  if (!graph) {
    return <PanelMessage message={t("gitGraph.loading")} />;
  }
  if (!graph.isRepo) {
    return <PanelMessage message={t("gitGraph.notRepo")} />;
  }
  if (graph.commits.length === 0) {
    return <PanelMessage message={t("gitGraph.empty")} />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-auto">
        <div style={{ minWidth: tableMinWidth }}>
          <div
            className="sticky top-0 z-20 grid h-9 items-center border-b bg-muted/70 px-0 font-mono text-mono-label uppercase text-muted-foreground backdrop-blur"
            style={{ gridTemplateColumns }}
          >
            <div className="border-r px-3">{t("gitGraph.columns.graph")}</div>
            <div className="border-r px-3">{t("gitGraph.columns.description")}</div>
            <div className="border-r px-3">{t("gitGraph.columns.date")}</div>
            <div className="border-r px-3">{t("gitGraph.columns.author")}</div>
            <div className="px-3">{t("gitGraph.columns.commit")}</div>
          </div>
          <div className="relative" style={{ height: layout.height }}>
            <svg
              aria-hidden="true"
              data-testid="git-graph-svg"
              width={layout.width}
              height={layout.height}
              viewBox={`0 0 ${layout.width} ${layout.height}`}
              className="pointer-events-none absolute left-0 top-0 z-0"
            >
              {layout.paths.map((path) => (
                <path
                  key={path.key}
                  d={path.d}
                  fill="none"
                  stroke={path.color}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2.5}
                />
              ))}
              {layout.dots.map((dot) => (
                <circle
                  key={dot.key}
                  cx={dot.x}
                  cy={dot.y}
                  r={4.5}
                  fill={dot.color}
                  stroke="rgb(var(--background))"
                  strokeWidth={2}
                />
              ))}
            </svg>
            <div className="relative z-10">
              {graph.commits.map((commit) => {
                const selected = commit.hash === selectedCommitHash;
                return (
                  <div
                    key={commit.hash}
                    role="button"
                    tabIndex={0}
                    aria-pressed={selected}
                    onClick={() => onSelectCommit(commit.hash)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onSelectCommit(commit.hash);
                      }
                    }}
                    className={cn(
                      "grid cursor-pointer border-b border-border/70 outline-none transition-colors focus-visible:bg-muted/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/25",
                      selected ? "bg-muted/60" : "hover:bg-muted/40"
                    )}
                    style={{ gridTemplateColumns, height: ROW_HEIGHT }}
                  >
                    <div aria-hidden="true" className="border-r" />
                    <div
                      title={commit.subject}
                      className="flex min-w-0 items-center gap-2 border-r px-3"
                    >
                      <RefPills refs={commit.refs} />
                      <span className="truncate text-foreground">{commit.subject}</span>
                    </div>
                    <div className="truncate border-r px-3 leading-[34px] text-muted-foreground">
                      {formatGitGraphDate(commit.date)}
                    </div>
                    <div
                      title={commit.authorName}
                      className="truncate border-r px-3 leading-[34px] text-muted-foreground"
                    >
                      {commit.authorName}
                    </div>
                    <div
                      title={commit.hash}
                      className="truncate px-3 font-mono leading-[34px] text-muted-foreground"
                    >
                      {commit.shortHash}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
      {selectedCommit ? (
        <CommitDetails commit={selectedCommit} />
      ) : null}
    </div>
  );
}

function CommitDetails({ commit }: { commit: GitGraphCommit }) {
  const { t } = useTranslation();
  const parentsText =
    commit.parents.length > 0
      ? commit.parents.map(shortGitHash).join(", ")
      : t("gitGraph.details.noParents");
  const parentsTitle =
    commit.parents.length > 0 ? commit.parents.join(", ") : parentsText;

  return (
    <div className="flex-none border-t bg-canvas px-4 py-3 text-caption">
      <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(320px,0.72fr)]">
        <DetailField
          label={t("gitGraph.details.subject")}
          value={commit.subject}
          title={commit.subject}
        />
        <div className="grid min-w-0 grid-cols-2 gap-x-6 gap-y-3">
          <DetailField
            label={t("gitGraph.details.commit")}
            value={commit.hash}
            title={commit.hash}
            mono
          />
          <DetailField
            label={t("gitGraph.details.author")}
            value={commit.authorName}
            title={commit.authorName}
          />
          <DetailField
            label={t("gitGraph.details.date")}
            value={formatGitGraphDate(commit.date)}
            title={commit.date}
          />
          <DetailField
            label={t("gitGraph.details.parents")}
            value={parentsText}
            title={parentsTitle}
            mono={commit.parents.length > 0}
          />
        </div>
      </div>
    </div>
  );
}

function DetailField({
  label,
  value,
  title,
  mono = false
}: {
  label: string;
  value: string;
  title?: string;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className="mb-1 text-caption text-muted-foreground">{label}</div>
      <div
        title={title}
        className={cn("truncate text-caption text-foreground", mono && "font-mono")}
      >
        {value}
      </div>
    </div>
  );
}

function shortGitHash(hash: string): string {
  return hash.slice(0, 7);
}

export function buildGitGraphLayout(commits: GitGraphCommit[]): GraphLayout {
  const lanes: string[] = [];
  const paths: GraphPath[] = [];
  const dots: GraphDot[] = [];
  let maxLane = 0;

  commits.forEach((commit, rowIndex) => {
    let laneIndex = lanes.indexOf(commit.hash);
    const newLane = laneIndex === -1;
    if (laneIndex === -1) {
      lanes.unshift(commit.hash);
      laneIndex = 0;
    }
    const before = [...lanes];
    const after = nextGitGraphLanes(before, laneIndex, commit.parents);
    maxLane = Math.max(maxLane, before.length - 1, after.length - 1, laneIndex);

    const yTop = rowIndex * ROW_HEIGHT;
    const yMid = yTop + ROW_HEIGHT / 2;
    const yBottom = yTop + ROW_HEIGHT;
    const commitColor = graphColor(laneIndex);

    for (let index = 0; index < before.length; index += 1) {
      const hash = before[index];
      if (index === laneIndex) {
        if (!newLane) {
          paths.push({
            key: `${commit.hash}:entry`,
            d: verticalPath(laneX(index), yTop, yMid),
            color: commitColor
          });
        }
        continue;
      }
      const nextIndex = after.indexOf(hash);
      if (nextIndex === -1) {
        continue;
      }
      paths.push({
        key: `${commit.hash}:lane:${hash}`,
        d: connectPath(laneX(index), yTop, laneX(nextIndex), yBottom),
        color: graphColor(index)
      });
    }

    for (const parent of commit.parents) {
      const nextIndex = after.indexOf(parent);
      if (nextIndex === -1) {
        continue;
      }
      paths.push({
        key: `${commit.hash}:parent:${parent}`,
        d: connectPath(laneX(laneIndex), yMid, laneX(nextIndex), yBottom),
        color: commitColor
      });
    }

    dots.push({
      key: commit.hash,
      x: laneX(laneIndex),
      y: yMid,
      color: commitColor
    });
    lanes.splice(0, lanes.length, ...after);
  });

  return {
    width: Math.max(GRAPH_MIN_WIDTH, laneX(maxLane) + LANE_PADDING),
    height: Math.max(ROW_HEIGHT, commits.length * ROW_HEIGHT),
    paths,
    dots
  };
}

function nextGitGraphLanes(before: string[], laneIndex: number, parents: string[]): string[] {
  const after = [...before];
  if (parents.length === 0) {
    after.splice(laneIndex, 1);
    return after;
  }
  const [firstParent, ...restParents] = parents;
  const existingFirstParent = after.findIndex(
    (hash, index) => index !== laneIndex && hash === firstParent
  );
  if (existingFirstParent === -1) {
    after[laneIndex] = firstParent;
  } else {
    after.splice(laneIndex, 1);
  }
  let insertAt = Math.min(laneIndex + 1, after.length);
  for (const parent of restParents) {
    if (after.includes(parent)) {
      continue;
    }
    after.splice(insertAt, 0, parent);
    insertAt += 1;
  }
  return after;
}

function laneX(index: number): number {
  return LANE_PADDING + index * LANE_GAP;
}

function graphColor(index: number): string {
  return GRAPH_COLORS[index % GRAPH_COLORS.length];
}

function verticalPath(x: number, y1: number, y2: number): string {
  return `M ${x} ${y1} L ${x} ${y2}`;
}

function connectPath(x1: number, y1: number, x2: number, y2: number): string {
  if (x1 === x2) {
    return verticalPath(x1, y1, y2);
  }
  const controlY = y1 + (y2 - y1) * 0.55;
  return `M ${x1} ${y1} C ${x1} ${controlY}, ${x2} ${controlY}, ${x2} ${y2}`;
}

export function formatGitGraphDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${month}/${day} ${hour}:${minute}`;
}

function RefPills({ refs }: { refs: GitGraphRef[] }) {
  const visibleRefs = displayRefs(refs);
  if (visibleRefs.length === 0) {
    return null;
  }
  return (
    <div className="flex min-w-0 flex-none items-center gap-1">
      {visibleRefs.slice(0, 3).map((ref) => (
        <span
          key={`${ref.type}:${ref.name}`}
          className={cn(
            "max-w-[150px] truncate rounded-xs border px-1.5 py-0.5 text-[11px] leading-4",
            ref.type === "remote" &&
              "border-[rgb(var(--soft-blue-border))] bg-[rgb(var(--soft-blue-surface))] text-[rgb(var(--soft-blue-foreground))]",
            ref.type === "tag" &&
              "border-[rgb(var(--warning-soft))] bg-[rgb(var(--warning-soft)_/_0.45)] text-[rgb(var(--warning-deep))]",
            (ref.type === "local" || ref.type === "head" || ref.type === "other") &&
              "border-border bg-muted text-muted-foreground"
          )}
        >
          {ref.name}
        </span>
      ))}
      {visibleRefs.length > 3 ? (
        <span className="text-[11px] leading-4 text-muted-foreground">
          +{visibleRefs.length - 3}
        </span>
      ) : null}
    </div>
  );
}

function displayRefs(refs: GitGraphRef[]): GitGraphRef[] {
  const withoutHead = refs.filter((ref) => ref.type !== "head");
  return withoutHead.length > 0 ? withoutHead : refs;
}

function PanelMessage({ title, message }: { title?: string; message: string }) {
  return (
    <div className="flex h-full min-h-0 flex-col items-center justify-center gap-2 p-6 text-center text-caption text-muted-foreground">
      {title ? <p className="text-foreground">{title}</p> : null}
      <p>{message}</p>
    </div>
  );
}
