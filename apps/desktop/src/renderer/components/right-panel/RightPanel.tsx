import {
  ArrowLeftIcon,
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
export function RightPanel() {
  const { t } = useTranslation();
  const open = useAppStore((state) => state.rightPanelOpen);
  const mode = useAppStore((state) => state.rightPanelMode);
  const width = useAppStore((state) => state.rightPanelWidth);
  const previewFile = useAppStore((state) => state.previewFile);
  const project = useAppStore(selectActiveProject);
  const clientReady = useAppStore((state) => state.clientReady);
  const openRightPanel = useAppStore((state) => state.openRightPanel);
  const closeRightPanel = useAppStore((state) => state.closeRightPanel);
  const setRightPanelWidth = useAppStore((state) => state.setRightPanelWidth);
  const [gitRepoStatusByProject, setGitRepoStatusByProject] = useState<
    Record<string, GitRepoStatus>
  >({});
  // 面板展开/收起动画:open 控制业务可见性,rendered 维持收起动画期间的挂载,
  // expanded 是真正驱动宽度过渡的标志(挂载后下一帧再翻 true 才能触发过渡)。
  const [rendered, setRendered] = useState(open);
  const [expanded, setExpanded] = useState(open);
  const [resizing, setResizing] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
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
  const currentModeAllowed = mode === null || directFilePreview || availableModes.includes(mode);
  const waitingForCurrentMode = mode === "changes" && checkingGitRepo;

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
    if (mode === null || currentModeAllowed || waitingForCurrentMode) {
      return;
    }
    console.info("[right-panel] 当前面板模式不适用于当前上下文，返回菜单", {
      mode,
      projectId,
      isGitRepo
    });
    openRightPanel(null);
  }, [currentModeAllowed, isGitRepo, mode, openRightPanel, projectId, waitingForCurrentMode]);

  useEffect(() => {
    if (open) {
      setRendered(true);
      // 挂载到 DOM(宽度 0)后等两帧再展开,确保浏览器先以 0 宽绘制一帧,过渡才会生效。
      let raf2 = 0;
      const raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => setExpanded(true));
      });
      return () => {
        cancelAnimationFrame(raf1);
        cancelAnimationFrame(raf2);
      };
    }
    // 收起:先触发宽度归零的过渡,过渡结束后再卸载内容。
    setExpanded(false);
    const timer = setTimeout(() => setRendered(false), 220);
    return () => clearTimeout(timer);
  }, [open]);

  useLayoutEffect(() => {
    if (!rendered) {
      return;
    }
    const parent = panelRef.current?.parentElement;
    if (!parent) {
      return;
    }
    const updateContainerWidth = () => {
      setContainerWidth(parent.getBoundingClientRect().width);
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
  }, [rendered]);

  if (!rendered) {
    return null;
  }

  const title = mode ? t(TITLE_KEYS[mode]) : t("rightPanel.menuTitle");
  const visualWidth = visibleRightPanelWidth(width, containerWidth);
  const panelStyle = {
    "--right-panel-width": `${visualWidth}px`,
    width: expanded ? "var(--right-panel-width)" : "0px"
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

  return (
    <aside
      ref={panelRef}
      data-testid="right-panel"
      style={panelStyle}
      className={cn(
        "relative h-screen min-h-0 shrink-0 overflow-hidden bg-background max-[840px]:hidden",
        !resizing && "transition-[width] duration-200 ease-out",
        expanded && "[box-shadow:inset_1px_0_0_rgb(var(--border))]"
      )}
    >
      {/* 固定宽度的内容层:外层宽度做展开/收起过渡时,内容被裁剪而非回流挤压。 */}
      <div
        data-testid="right-panel-content"
        className="flex h-full min-h-0 min-w-0 w-[var(--right-panel-width)] flex-col overflow-hidden [contain:layout_paint]"
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
          <button
            type="button"
            title={t("rightPanel.close")}
            onClick={closeRightPanel}
            className="flex size-7 items-center justify-center rounded-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <XMarkIcon className="size-4" />
          </button>
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
            <FilePreviewPanel />
          ) : (
            <SideChatPanel />
          )}
        </div>
      </div>
    </aside>
  );
}
