import { ChevronIcon } from "@/assets/file-type-icons";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode
} from "react";
import { useTranslation } from "react-i18next";
import type { FileChange } from "@chengxiaobang/shared";
import { DiffView } from "@/components/DiffView";
import { resolveFileTypeIcon } from "@/lib/code-language-icons";
import { parseGitPatchDiff } from "@/lib/diff";
import { cn } from "@/lib/utils";

interface RunFileChangesCardProps {
  runId: string;
  fileChanges: FileChange[];
}

const COLLAPSE_ANIMATION_MS = 200;

export function RunFileChangesCard({ runId, fileChanges }: RunFileChangesCardProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [openPath, setOpenPath] = useState<string>();
  const stats = useMemo(
    () =>
      fileChanges.reduce(
        (next, change) => ({
          additions: next.additions + change.additions,
          deletions: next.deletions + change.deletions
        }),
        { additions: 0, deletions: 0 }
      ),
    [fileChanges]
  );

  if (fileChanges.length === 0) {
    return null;
  }

  return (
    <section
      data-testid="run-file-changes-card"
      className="mb-2 mt-3 overflow-hidden rounded-md border border-hairline bg-card text-foreground shadow-sm"
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          const nextOpen = !open;
          console.info("[RunFileChangesCard] 切换本轮 diff 卡片", {
            runId,
            open: nextOpen,
            fileCount: fileChanges.length
          });
          setOpen(nextOpen);
        }}
        className="flex min-h-10 w-full min-w-0 items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-canvas-soft"
      >
        <ChevronIcon
          className={cn(
            "size-4 flex-none text-muted-foreground transition-transform duration-200",
            !open && "-rotate-90"
          )}
        />
        <span className="min-w-0 flex-1 truncate text-caption font-semibold">
          {t("chat.runFileChanges.title", { count: fileChanges.length })}
        </span>
        <DiffStats additions={stats.additions} deletions={stats.deletions} />
      </button>
      <AnimatedCollapse
        open={open}
        className="border-t border-hairline"
        dataTestId="run-file-changes-list-collapse"
      >
        <div>
          {fileChanges.map((change) => (
            <RunFileChangeRow
              key={`${runId}:${change.path}`}
              runId={runId}
              change={change}
              open={openPath === change.path}
              onToggle={() => {
                const nextPath = openPath === change.path ? undefined : change.path;
                console.info("[RunFileChangesCard] 切换单文件 diff", {
                  runId,
                  path: change.path,
                  open: nextPath === change.path,
                  additions: change.additions,
                  deletions: change.deletions
                });
                setOpenPath(nextPath);
              }}
            />
          ))}
        </div>
      </AnimatedCollapse>
    </section>
  );
}

function RunFileChangeRow({
  runId,
  change,
  open,
  onToggle
}: {
  runId: string;
  change: FileChange;
  open: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const FileIcon = resolveFileTypeIcon(change.path);
  const fileName = basenameOf(change.path);
  const blocks = useMemo(
    () =>
      parseGitPatchDiff({
        patch: change.patch,
        path: change.path,
        cacheKeyPrefix: `${runId}:${change.path}:${change.toolCallIds.join(",")}`
      }),
    [change.patch, change.path, change.toolCallIds, runId]
  );

  return (
    <div className="border-b border-hairline last:border-b-0">
      <button
        type="button"
        aria-expanded={open}
        title={change.path}
        onClick={onToggle}
        className="flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-canvas-soft"
      >
        <FileIcon aria-hidden className="cxb-svg-icon size-3.5 flex-none" />
        <span className="min-w-0 flex-1 truncate font-mono text-micro font-medium text-foreground">
          {fileName}
        </span>
        {change.truncated ? (
          <span className="flex-none rounded-xs border border-warning/30 bg-warning/10 px-1.5 py-0.5 text-micro text-warning-deep">
            {t("chat.runFileChanges.truncated")}
          </span>
        ) : null}
        <DiffStats additions={change.additions} deletions={change.deletions} />
        <ChevronIcon
          aria-hidden
          className={cn(
            "ml-1 size-3.5 flex-none text-muted-foreground transition-transform duration-200",
            !open && "-rotate-90"
          )}
        />
      </button>
      <AnimatedCollapse
        open={open}
        className="border-t border-hairline bg-background"
        dataTestId="run-file-change-diff-collapse"
      >
        <DiffView blocks={blocks} hideScrollbar compactBlockGap />
      </AnimatedCollapse>
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

function AnimatedCollapse({
  open,
  className,
  dataTestId,
  children
}: {
  open: boolean;
  className?: string;
  dataTestId?: string;
  children: ReactNode;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(open);
  const [height, setHeight] = useState<number | "auto">(open ? "auto" : 0);
  const visible = open || mounted;

  useEffect(() => {
    if (open) {
      setMounted(true);
    }
  }, [open]);

  useEffect(() => {
    if (!visible) {
      return undefined;
    }

    const content = contentRef.current;
    if (!content) {
      return undefined;
    }

    if (prefersReducedMotion()) {
      setHeight(open ? "auto" : 0);
      if (!open) {
        setMounted(false);
      }
      return undefined;
    }

    if (open) {
      setHeight(0);
      const cancelFrame = scheduleFrame(() => {
        setHeight(content.scrollHeight);
      });
      const done = window.setTimeout(() => {
        setHeight("auto");
      }, COLLAPSE_ANIMATION_MS);
      return () => {
        cancelFrame();
        window.clearTimeout(done);
      };
    }

    setHeight(content.scrollHeight);
    const cancelFrame = scheduleFrame(() => {
      setHeight(0);
    });
    const done = window.setTimeout(() => {
      setMounted(false);
    }, COLLAPSE_ANIMATION_MS);
    return () => {
      cancelFrame();
      window.clearTimeout(done);
    };
  }, [open, visible]);

  if (!visible) {
    return null;
  }

  const style: CSSProperties = {
    height: height === "auto" ? "auto" : `${height}px`
  };

  return (
    <div
      aria-hidden={!open}
      data-testid={dataTestId}
      className={cn(
        "overflow-hidden transition-[height,opacity] duration-200 ease-out motion-reduce:transition-none",
        open ? "opacity-100" : "opacity-0",
        className
      )}
      style={style}
    >
      <div ref={contentRef} className="min-h-0 overflow-hidden">
        {children}
      </div>
    </div>
  );
}

function scheduleFrame(callback: () => void): () => void {
  if (typeof window.requestAnimationFrame === "function") {
    const frameId = window.requestAnimationFrame(callback);
    return () => window.cancelAnimationFrame(frameId);
  }
  const timeoutId = window.setTimeout(callback, 16);
  return () => window.clearTimeout(timeoutId);
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

function DiffStats({ additions, deletions }: { additions: number; deletions: number }) {
  return (
    <span className="flex flex-none items-center gap-2 font-mono text-caption">
      <span className="text-success">+{additions}</span>
      <span className="text-destructive">-{deletions}</span>
    </span>
  );
}
