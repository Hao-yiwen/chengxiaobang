import {
  ArrowLeftIcon,
  PanelRightOutlineIcon,
  XMarkIcon
} from "@/assets/file-type-icons";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties
} from "react";
import { useTranslation } from "react-i18next";
import { BrowserPanel } from "./BrowserPanel";
import { ChangesPanel } from "./ChangesPanel";
import { FilePreviewPanel } from "./FilePreviewPanel";
import { RightPanelMenu } from "./RightPanelMenu";
import { SideChatPanel } from "./SideChatPanel";
import { TerminalPanel } from "./TerminalPanel";
import { cn } from "@/lib/utils";
import { getApiClient, selectActiveProject, useAppStore, type RightPanelMode } from "@/store";
import { visibleRightPanelWidth } from "@/store/helpers/right-panel";

type RightPanelLabelKey =
  | "rightPanel.changes"
  | "rightPanel.terminal"
  | "rightPanel.browser"
  | "rightPanel.files"
  | "rightPanel.chat";

const TITLE_KEYS: Record<RightPanelMode, RightPanelLabelKey> = {
  changes: "rightPanel.changes",
  terminal: "rightPanel.terminal",
  browser: "rightPanel.browser",
  files: "rightPanel.files",
  chat: "rightPanel.chat"
};

type GitRepoStatus = "loading" | "repo" | "not-repo" | "error";

export type RightPanelVisualPhase = "closed" | "opening" | "open" | "closing";

export const RIGHT_PANEL_VISUAL_TRANSITION_MS = 200;

interface ProjectFilesOpenState {
  key: string;
  open: boolean;
}

function availableModesForContext(hasProject: boolean, isGitRepo: boolean): RightPanelMode[] {
  if (!hasProject) {
    return ["browser", "chat"];
  }
  return isGitRepo
    ? ["changes", "terminal", "browser", "files", "chat"]
    : ["terminal", "browser", "files", "chat"];
}

/**
 * 右侧工作区面板：一个可调整宽度的槽位，先展示菜单，再承载变更、终端、
 * 浏览器、文件预览和侧边会话等工具页。
 */
export function RightPanel({ phase }: { phase: RightPanelVisualPhase }) {
  const { t } = useTranslation();
  const open = useAppStore((state) => state.rightPanelOpen);
  const mode = useAppStore((state) => state.rightPanelMode);
  const width = useAppStore((state) => state.rightPanelWidth);
  const previewFile = useAppStore((state) => state.previewFile);
  const filePreviewEntrySource = useAppStore((state) => state.filePreviewEntrySource);
  const project = useAppStore(selectActiveProject);
  const clientReady = useAppStore((state) => state.clientReady);
  const openRightPanel = useAppStore((state) => state.openRightPanel);
  const closeRightPanel = useAppStore((state) => state.closeRightPanel);
  const setRightPanelWidth = useAppStore((state) => state.setRightPanelWidth);
  const [gitRepoStatusByProject, setGitRepoStatusByProject] = useState<
    Record<string, GitRepoStatus>
  >({});
  const [resizing, setResizing] = useState(false);
  const [projectFilesOpenState, setProjectFilesOpenState] = useState<ProjectFilesOpenState>({
    key: "",
    open: false
  });
  const panelRef = useRef<HTMLElement>(null);
  const layoutLogKeyRef = useRef<string | undefined>(undefined);
  const [containerWidth, setContainerWidth] = useState<number | undefined>(undefined);
  const projectId = project?.id;
  const gitRepoStatus = projectId ? gitRepoStatusByProject[projectId] : undefined;
  const checkingGitRepo = Boolean(
    projectId && clientReady && (!gitRepoStatus || gitRepoStatus === "loading")
  );
  const isGitRepo = gitRepoStatus === "repo";
  const availableModes = useMemo(
    () => availableModesForContext(Boolean(project), isGitRepo),
    [isGitRepo, project]
  );
  const directFilePreview = mode === "files" && Boolean(previewFile?.path);
  const showProjectFilesToggle = mode === "files" && Boolean(project);
  const projectFilesEntryKey = useMemo(
    () =>
      [
        open ? "open" : "closed",
        mode ?? "menu",
        projectId ?? "no-project",
        previewFile?.path ?? "no-file",
        filePreviewEntrySource ?? "unknown"
      ].join(":"),
    [filePreviewEntrySource, mode, open, previewFile?.path, projectId]
  );
  const defaultProjectFilesOpen = useMemo(() => {
    if (!open || mode !== "files" || !projectId) {
      return false;
    }
    return (
      filePreviewEntrySource === "panel" ||
      filePreviewEntrySource === "project-tree" ||
      (!filePreviewEntrySource && !previewFile?.path)
    );
  }, [filePreviewEntrySource, mode, open, previewFile?.path, projectId]);
  const projectFilesOpen =
    projectFilesOpenState.key === projectFilesEntryKey
      ? projectFilesOpenState.open
      : defaultProjectFilesOpen;
  const modeFallbackReason = (() => {
    if (mode === null || directFilePreview || mode === "browser" || mode === "chat") {
      return undefined;
    }
    if (!project) {
      return "missing-project";
    }
    if (mode === "terminal" || mode === "files") {
      return undefined;
    }
    if (mode === "changes" && (!clientReady || checkingGitRepo || !gitRepoStatus)) {
      return "pending";
    }
    if (mode === "changes" && isGitRepo) {
      return undefined;
    }
    return "not-git-repo";
  })();

  useLayoutEffect(() => {
    if (projectFilesOpenState.key === projectFilesEntryKey) {
      return;
    }
    if (open && mode === "files" && projectId) {
      console.debug("[right-panel] 同步文件预览项目树入口状态", {
        projectId,
        previewPath: previewFile?.path,
        source: filePreviewEntrySource ?? "unknown",
        open: defaultProjectFilesOpen
      });
    }
    setProjectFilesOpenState({ key: projectFilesEntryKey, open: defaultProjectFilesOpen });
  }, [
    defaultProjectFilesOpen,
    filePreviewEntrySource,
    mode,
    open,
    previewFile?.path,
    projectFilesEntryKey,
    projectFilesOpenState.key,
    projectId
  ]);

  useEffect(() => {
    if (!projectId || !clientReady || gitRepoStatus) {
      return;
    }
    const client = getApiClient();
    if (!client?.getGitInfo) {
      console.warn("[right-panel] Git 信息接口不可用，隐藏变更入口", { projectId });
      setGitRepoStatusByProject((current) => ({ ...current, [projectId]: "error" }));
      return;
    }
    console.debug("[right-panel] 开始检测项目 Git 状态", { projectId, path: project?.path });
    setGitRepoStatusByProject((current) => ({ ...current, [projectId]: "loading" }));
    void client.getGitInfo(projectId).then(
      (info) => {
        console.debug("[right-panel] 项目 Git 状态检测完成", {
          projectId,
          isRepo: info.isRepo
        });
        setGitRepoStatusByProject((current) => ({
          ...current,
          [projectId]: info.isRepo ? "repo" : "not-repo"
        }));
      },
      (error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.warn("[right-panel] 项目 Git 状态检测失败，隐藏变更入口", {
          projectId,
          error: message
        });
        setGitRepoStatusByProject((current) => ({ ...current, [projectId]: "error" }));
      }
    );
  }, [clientReady, gitRepoStatus, project?.path, projectId]);

  useEffect(() => {
    if (!modeFallbackReason || modeFallbackReason === "pending") {
      return;
    }
    console.info("[right-panel] 当前面板模式不适用于当前上下文，返回菜单", {
      mode,
      projectId,
      clientReady,
      gitRepoStatus,
      phase,
      reason: modeFallbackReason
    });
    openRightPanel(null);
  }, [
    clientReady,
    gitRepoStatus,
    mode,
    modeFallbackReason,
    openRightPanel,
    phase,
    projectId
  ]);

  const shouldRender = phase !== "closed";

  useLayoutEffect(() => {
    if (!shouldRender) {
      return;
    }
    const parent = panelRef.current?.parentElement;
    if (!parent) {
      return;
    }
    const updateContainerWidth = () => {
      const measuredWidth = parent.getBoundingClientRect().width;
      if (measuredWidth <= 0) {
        console.debug("[right-panel] 跳过无效父容器宽度测量", {
          measuredWidth,
          mode,
          targetWidth: width
        });
        return;
      }
      setContainerWidth(measuredWidth);
    };
    updateContainerWidth();
    const resizeObserver =
      typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(updateContainerWidth);
    resizeObserver?.observe(parent);
    window.addEventListener("resize", updateContainerWidth);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updateContainerWidth);
    };
  }, [mode, shouldRender, width]);

  const visualWidth = visibleRightPanelWidth(width, containerWidth);

  useEffect(() => {
    if (!shouldRender) {
      layoutLogKeyRef.current = undefined;
      return;
    }
    const logKey = [
      mode ?? "menu",
      open ? "open" : "closing",
      phase,
      width,
      visualWidth
    ].join(":");
    if (layoutLogKeyRef.current === logKey) {
      return;
    }
    layoutLogKeyRef.current = logKey;
    console.info("[right-panel] 同步右侧面板布局宽度", {
      mode,
      targetWidth: width,
      visibleWidth: visualWidth,
      closing: !open,
      phase
    });
  }, [mode, open, phase, shouldRender, visualWidth, width]);

  if (!shouldRender) {
    return null;
  }

  const title = mode ? t(TITLE_KEYS[mode]) : t("rightPanel.menuTitle");
  const panelStyle = {
    "--right-panel-width": `${visualWidth}px`,
    width: "var(--right-panel-width)"
  } as CSSProperties & { "--right-panel-width": string };

  function onResizeStart(event: React.PointerEvent<HTMLDivElement>): void {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = visualWidth;
    // 拖拽中关闭宽度过渡,否则面板会延迟跟手。
    setResizing(true);
    const onMove = (move: PointerEvent) =>
      setRightPanelWidth(startWidth + (startX - move.clientX));
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      setResizing(false);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  }

  function toggleProjectFilesOpen(): void {
    const nextOpen = !projectFilesOpen;
    console.debug("[right-panel] 切换项目文件树顶栏按钮", {
      projectId,
      open: nextOpen,
      mode
    });
    setProjectFilesOpenState({ key: projectFilesEntryKey, open: nextOpen });
  }

  return (
    <aside
      ref={panelRef}
      data-testid="right-panel"
      data-right-panel-phase={phase}
      style={panelStyle}
      className="relative h-screen min-h-0 shrink-0 overflow-hidden bg-background max-[840px]:hidden"
    >
      {/* 固定宽度的内容层：分隔线跟随内容层移动，避免外层槽位先露出一条空线。 */}
      <div
        data-testid="right-panel-content"
        className={cn(
          "relative flex h-full min-h-0 min-w-0 w-[var(--right-panel-width)] flex-col overflow-hidden border-l border-border bg-background [contain:layout_paint] [will-change:transform,opacity,clip-path]",
          phase === "opening" && !resizing && "right-panel-content-enter",
          phase === "closing" && !resizing && "right-panel-content-exit"
        )}
      >
        <div
          role="separator"
          aria-orientation="vertical"
          title={t("rightPanel.resize")}
          onPointerDown={onResizeStart}
          className="absolute left-0 top-0 z-10 h-full w-1.5 cursor-col-resize"
        />
        <header className="flex h-14 min-w-0 flex-none items-center justify-between gap-2 border-b px-4">
          <div className="flex min-w-0 items-center gap-1.5">
            {mode ? (
              <button
                type="button"
                title={t("rightPanel.backToMenu")}
                onClick={() => openRightPanel(null)}
                className="flex size-7 items-center justify-center rounded-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <ArrowLeftIcon className="size-4" />
              </button>
            ) : null}
            <h2 className="truncate font-mono text-mono-label uppercase text-foreground">
              {title}
            </h2>
          </div>
          <div className="flex flex-none items-center gap-1">
            {showProjectFilesToggle ? (
              <button
                type="button"
                title={t(
                  projectFilesOpen
                    ? "rightPanel.projectFilesCollapse"
                    : "rightPanel.projectFilesExpand"
                )}
                aria-label={t(
                  projectFilesOpen
                    ? "rightPanel.projectFilesCollapse"
                    : "rightPanel.projectFilesExpand"
                )}
                aria-pressed={projectFilesOpen}
                onClick={toggleProjectFilesOpen}
                className="flex size-7 items-center justify-center rounded-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <PanelRightOutlineIcon className="size-4" />
              </button>
            ) : null}
            <button
              type="button"
              title={t("rightPanel.close")}
              onClick={closeRightPanel}
              className="flex size-7 items-center justify-center rounded-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <XMarkIcon className="size-4" />
            </button>
          </div>
        </header>
        <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
          {mode === null ? (
            <RightPanelMenu availableModes={availableModes} />
          ) : mode === "changes" ? (
            <ChangesPanel />
          ) : mode === "terminal" ? (
            <TerminalPanel />
          ) : mode === "browser" ? (
            <BrowserPanel />
          ) : mode === "files" ? (
            <FilePreviewPanel
              projectFilesOpen={projectFilesOpen}
              onProjectFilesOpenChange={(nextOpen) =>
                setProjectFilesOpenState({ key: projectFilesEntryKey, open: nextOpen })
              }
            />
          ) : (
            <SideChatPanel />
          )}
        </div>
      </div>
    </aside>
  );
}
