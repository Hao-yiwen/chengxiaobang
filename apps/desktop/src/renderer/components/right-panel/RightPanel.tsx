import {
  ExpandCornersIcon,
  ExpandInwardIcon,
  PanelRightOutlineIcon,
  PlusIcon,
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { BrowserPanel } from "./BrowserPanel";
import { ChangesPanel } from "./ChangesPanel";
import { FilePreviewPanel } from "./FilePreviewPanel";
import {
  RIGHT_PANEL_MENU_ITEMS,
  RightPanelMenu,
  rightPanelModeIcon
} from "./RightPanelMenu";
import { SideChatPanel } from "./SideChatPanel";
import { TerminalPanel } from "./TerminalPanel";
import { cn } from "@/lib/utils";
import {
  getApiClient,
  selectActiveProject,
  useAppStore,
  type RightPanelMode,
  type RightPanelTab
} from "@/store";
import {
  maximizedRightPanelWidth,
  visibleRightPanelWidth
} from "@/store/helpers/right-panel";

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
 * 右侧工作区面板：一个可调整宽度的槽位，顶栏是动态 tab 栏，内容区常驻挂载所有 tab、
 * 用 hidden 切显隐（终端切 tab 不销毁 PTY），承载变更、终端、浏览器、文件预览和侧边会话。
 */
export function RightPanel({ phase }: { phase: RightPanelVisualPhase }) {
  const { t } = useTranslation();
  const open = useAppStore((state) => state.rightPanelOpen);
  const view = useAppStore((state) => state.view);
  const mode = useAppStore((state) => state.rightPanelMode);
  const tabs = useAppStore((state) => state.rightPanelTabs);
  const activeTabId = useAppStore((state) => state.rightPanelActiveTabId);
  const maximized = useAppStore((state) => state.rightPanelMaximized);
  const width = useAppStore((state) => state.rightPanelWidth);
  const previewFile = useAppStore((state) => state.previewFile);
  const filePreviewEntrySource = useAppStore((state) => state.filePreviewEntrySource);
  const project = useAppStore(selectActiveProject);
  const clientReady = useAppStore((state) => state.clientReady);
  const closeRightPanel = useAppStore((state) => state.closeRightPanel);
  const setRightPanelWidth = useAppStore((state) => state.setRightPanelWidth);
  const newRightPanelTab = useAppStore((state) => state.newRightPanelTab);
  const closeRightPanelTab = useAppStore((state) => state.closeRightPanelTab);
  const setActiveRightPanelTab = useAppStore((state) => state.setActiveRightPanelTab);
  const toggleRightPanelMaximized = useAppStore((state) => state.toggleRightPanelMaximized);
  const [gitRepoStatusByProject, setGitRepoStatusByProject] = useState<
    Record<string, GitRepoStatus>
  >({});
  const [resizing, setResizing] = useState(false);
  const [newTabMenuOpen, setNewTabMenuOpen] = useState(false);
  const [projectFilesOpenState, setProjectFilesOpenState] = useState<ProjectFilesOpenState>({
    key: "",
    open: false
  });
  const panelRef = useRef<HTMLElement>(null);
  const layoutLogKeyRef = useRef<string | undefined>(undefined);
  // 拖拽中挂在 window 上的监听器清理函数:拖拽未结束就卸载组件时,由卸载 effect 兜底移除,
  // 避免 pointermove 监听泄漏并对已卸载组件调用 setRightPanelWidth。
  const resizeCleanupRef = useRef<(() => void) | null>(null);
  const [containerWidth, setContainerWidth] = useState<number | undefined>(undefined);
  const projectId = project?.id;
  const gitRepoStatus = projectId ? gitRepoStatusByProject[projectId] : undefined;
  const isGitRepo = gitRepoStatus === "repo";
  const availableModes = useMemo(
    () => availableModesForContext(Boolean(project), isGitRepo),
    [isGitRepo, project]
  );
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

  // 组件卸载时兜底清理拖拽监听器,防止拖拽中卸载导致 window 监听泄漏。
  useEffect(() => {
    return () => {
      resizeCleanupRef.current?.();
    };
  }, []);

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

  const visualWidth = maximized
    ? maximizedRightPanelWidth(containerWidth)
    : visibleRightPanelWidth(width, containerWidth);

  useEffect(() => {
    if (!shouldRender) {
      layoutLogKeyRef.current = undefined;
      return;
    }
    const logKey = [
      mode ?? "menu",
      open ? "open" : "closing",
      phase,
      maximized ? "max" : "normal",
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
      maximized,
      closing: !open,
      phase
    });
  }, [maximized, mode, open, phase, shouldRender, visualWidth, width]);

  if (!shouldRender) {
    return null;
  }

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
    const cleanup = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      resizeCleanupRef.current = null;
    };
    function onUp(): void {
      cleanup();
      setResizing(false);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    resizeCleanupRef.current = cleanup;
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

  function tabLabel(tab: RightPanelTab): string {
    if (tab.kind === "terminal") {
      return tab.title ?? t("rightPanel.terminal");
    }
    return t(TITLE_KEYS[tab.kind]);
  }

  function renderTabBody(tab: RightPanelTab, active: boolean) {
    switch (tab.kind) {
      case "changes":
        return <ChangesPanel />;
      case "terminal":
        return <TerminalPanel terminalId={tab.terminalId ?? tab.id} visible={active} />;
      case "browser":
        return <BrowserPanel />;
      case "files":
        return (
          <FilePreviewPanel
            projectFilesOpen={projectFilesOpen}
            onProjectFilesOpenChange={(nextOpen) =>
              setProjectFilesOpenState({ key: projectFilesEntryKey, open: nextOpen })
            }
          />
        );
      case "chat":
        return <SideChatPanel />;
      default:
        return null;
    }
  }

  const newTabItems = RIGHT_PANEL_MENU_ITEMS.filter((item) => availableModes.includes(item.mode));
  // 仅会话页(chat)是「多 tab 工作区」:展示 tab 栏、+ 新建与最大化;
  // 首页只用来做单次文件/产物预览,顶栏从简(标题 + 关闭),不显示 + 与最大化。
  const tabMode = view === "chat";
  const activeTab = tabs.find((tab) => tab.id === activeTabId);

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
        <header className="flex h-14 min-w-0 flex-none items-center justify-between gap-1 border-b px-2">
          {tabMode ? (
            /* 会话页:tab 栏,每个已打开工具一个 chip,末尾 + 新建。 */
            <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {tabs.map((tab) => {
                const active = tab.id === activeTabId;
                const Icon = rightPanelModeIcon(tab.kind);
                return (
                  <div
                    key={tab.id}
                    role="tab"
                    aria-selected={active}
                    title={tabLabel(tab)}
                    onClick={() => setActiveRightPanelTab(tab.id)}
                    className={cn(
                      "group flex h-8 max-w-[160px] flex-none cursor-pointer items-center gap-1.5 rounded-sm border px-2.5 font-mono text-mono-label transition-colors",
                      active
                        ? "border-border bg-muted text-foreground"
                        : "border-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                    )}
                  >
                    <Icon className="size-3.5 flex-none" />
                    <span className="truncate normal-case">{tabLabel(tab)}</span>
                    <button
                      type="button"
                      title={t("rightPanel.closeTab")}
                      aria-label={t("rightPanel.closeTab")}
                      onClick={(event) => {
                        event.stopPropagation();
                        closeRightPanelTab(tab.id);
                      }}
                      className="flex size-4 flex-none items-center justify-center rounded-xs text-muted-foreground opacity-60 transition-colors hover:bg-background hover:text-foreground hover:opacity-100"
                    >
                      <XMarkIcon className="size-3" />
                    </button>
                  </div>
                );
              })}
              <Popover open={newTabMenuOpen} onOpenChange={setNewTabMenuOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    title={t("rightPanel.newTab")}
                    aria-label={t("rightPanel.newTab")}
                    className="flex size-7 flex-none items-center justify-center rounded-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <PlusIcon className="size-4" />
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-44 p-1">
                  {newTabItems.map((item) => (
                    <button
                      key={item.mode}
                      type="button"
                      onClick={() => {
                        newRightPanelTab(item.mode);
                        setNewTabMenuOpen(false);
                      }}
                      className="flex w-full items-center gap-2 rounded-xs px-2.5 py-1.5 text-left text-caption text-foreground transition-colors hover:bg-muted"
                    >
                      <item.icon className="size-4 text-muted-foreground" />
                      <span>{t(TITLE_KEYS[item.mode])}</span>
                    </button>
                  ))}
                </PopoverContent>
              </Popover>
            </div>
          ) : (
            /* 首页:单次预览,从简标题,不展示 tab 栏 / + / 最大化。 */
            <div className="flex min-w-0 flex-1 items-center px-1.5">
              <h2 className="truncate font-mono text-mono-label uppercase text-foreground">
                {activeTab ? tabLabel(activeTab) : t("rightPanel.menuTitle")}
              </h2>
            </div>
          )}
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
            {tabMode ? (
              <button
                type="button"
                title={t(maximized ? "rightPanel.restore" : "rightPanel.maximize")}
                aria-label={t(maximized ? "rightPanel.restore" : "rightPanel.maximize")}
                aria-pressed={maximized}
                onClick={toggleRightPanelMaximized}
                className="flex size-7 items-center justify-center rounded-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                {maximized ? (
                  <ExpandInwardIcon className="size-4" />
                ) : (
                  <ExpandCornersIcon className="size-4" />
                )}
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
          {tabs.length === 0 ? (
            <RightPanelMenu availableModes={availableModes} onPick={newRightPanelTab} />
          ) : (
            tabs.map((tab) => {
              const active = tab.id === activeTabId;
              // 用内联 display 而非 hidden 属性切显隐:避免被任意 CSS 覆盖导致非活动 tab 仍占位、
              // 看起来「切不动」;非活动 tab 仍挂载(终端 PTY 不被销毁)。
              return (
                <div
                  key={tab.id}
                  className="h-full min-h-0"
                  style={{ display: active ? undefined : "none" }}
                >
                  {renderTabBody(tab, active)}
                </div>
              );
            })
          )}
        </div>
      </div>
    </aside>
  );
}
