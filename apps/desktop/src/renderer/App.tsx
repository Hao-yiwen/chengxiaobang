import type { DragEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { DocumentIcon } from "@/assets/file-type-icons";
import { ApprovalDock } from "./components/ApprovalDock";
import { ArtifactFloatingPanel } from "./components/ArtifactFloatingPanel";
import { ChatView } from "./components/ChatView";
import chatLayoutStyles from "./components/ChatLayout.module.css";
import { CommandPalette } from "./components/CommandPalette";
import { Composer } from "./components/Composer";
import { ProgressFloatingPanel } from "./components/ProgressFloatingPanel";
import { ConnectPhoneView } from "./components/ConnectPhoneView";
import { ConfirmDialogProvider } from "./components/ConfirmDialog";
import { DevToolsFloatingButton } from "./components/DevToolsFloatingButton";
import { HomeMascot } from "./components/HomeMascot";
import { HomeStarters } from "./components/HomeStarters";
import homeHeroStyles from "./components/HomeHero.module.css";
import { NotificationToasts } from "./components/NotificationToasts";
import { OpenInIdeButton } from "./components/OpenInIdeButton";
import {
  RIGHT_PANEL_VISUAL_TRANSITION_MS,
  RightPanel,
  type RightPanelVisualPhase
} from "./components/right-panel/RightPanel";
import { RightPanelSwitch } from "./components/right-panel/RightPanelSwitch";
import { SettingsView } from "./components/SettingsView";
import { SessionActionsMenu } from "./components/SessionActionsMenu";
import { SessionDebugButton } from "./components/SessionDebugButton";
import { SetupDialog } from "./components/SetupDialog";
import { Sidebar, SidebarToggle } from "./components/Sidebar";
import { PluginsView } from "./components/PluginsView";
import { TasksView } from "./components/TasksView";
import { UpdateCenter } from "./components/UpdateCenter";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useThemeController } from "@/hooks/use-theme";
import { useI18nController } from "@/hooks/use-i18n";
import type { ApiClient } from "@/lib/api";
import { shouldShowSessionDebugButton } from "@/lib/runtime-flags";
import { cn } from "@/lib/utils";
import { selectActiveSession, useAppStore } from "@/store";

const HOME_HERO_PHRASE_KEYS = ["today", "next", "build", "ship"] as const;
const RIGHT_PANEL_TRIGGER_HIDE_MS = 120;

function effectiveRightPanelPhase(
  open: boolean,
  phase: RightPanelVisualPhase
): RightPanelVisualPhase {
  if (open) {
    return phase === "open" ? "open" : "opening";
  }
  if (phase === "open" || phase === "opening") {
    return "closing";
  }
  return phase;
}

export function App(props: { client?: ApiClient }) {
  const { t } = useTranslation();
  const homeHeroPhrase = useMemo(() => {
    const key =
      HOME_HERO_PHRASE_KEYS[Math.floor(Math.random() * HOME_HERO_PHRASE_KEYS.length)] ??
      HOME_HERO_PHRASE_KEYS[0];
    return t(`home.heroPhrases.${key}` as const);
  }, [t]);
  const view = useAppStore((state) => state.view);
  const activeSession = useAppStore(selectActiveSession);
  const rightPanelOpen = useAppStore((state) => state.rightPanelOpen);
  const rightPanelMode = useAppStore((state) => state.rightPanelMode);
  const rightPanelMaximized = useAppStore((state) => state.rightPanelMaximized);
  const sidebarOpen = useAppStore((state) => state.sidebarOpen);
  const pendingDecisionTool = useAppStore((state) => state.pendingTool);
  const addDroppedContext = useAppStore((state) => state.addDroppedContext);
  const toggleRightPanel = useAppStore((state) => state.toggleRightPanel);
  const [dragDepth, setDragDepth] = useState(0);
  const rightPanelTriggerTimerRef = useRef<number | undefined>(undefined);
  // macOS 隐藏标题栏下折叠按钮悬浮在主区左上角，头部标题需要让位。
  const isMacDesktop = window.chengxiaobang?.platform === "darwin";
  const headerInset = !sidebarOpen && isMacDesktop;
  const acceptsDroppedContext = view === "home" || view === "chat";
  const dropActive = acceptsDroppedContext && dragDepth > 0;
  const hideComposerForDecisionDock =
    pendingDecisionTool?.status === "pending_approval";
  const [rightPanelVisualPhase, setRightPanelVisualPhase] = useState<RightPanelVisualPhase>(
    rightPanelOpen ? "open" : "closed"
  );
  const [rightPanelTriggerHiding, setRightPanelTriggerHiding] = useState(false);
  const rightPanelPhase = effectiveRightPanelPhase(rightPanelOpen, rightPanelVisualPhase);
  const rightPanelLayoutActive = rightPanelPhase !== "closed";
  // 聊天页保留 closing 槽位完成右栏收起动画；首页只在右栏真实打开时占位，
  // 避免从会话回首页时内容先按「扣掉右栏宽度」居中再跳回全宽居中。
  const showRightPanel = view === "chat" || (view === "home" && rightPanelOpen);
  const rightPanelControlsHidden = rightPanelLayoutActive || rightPanelTriggerHiding;
  const showSessionDebugButton = import.meta.env.DEV && shouldShowSessionDebugButton();

  useThemeController();
  useI18nController();

  useEffect(() => {
    void useAppStore.getState().initClient(props.client);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const unsubscribe = window.chengxiaobang?.onNewChatRequested?.(() => {
      console.info("[App] 收到应用菜单新建对话请求");
      useAppStore.getState().newChat();
    });
    return () => unsubscribe?.();
  }, []);

  useEffect(() => {
    if (!hideComposerForDecisionDock || !pendingDecisionTool) {
      return;
    }
    console.info("[App] 待决议工具出现，隐藏普通输入框", {
      toolCallId: pendingDecisionTool.id,
      name: pendingDecisionTool.name
    });
  }, [hideComposerForDecisionDock, pendingDecisionTool]);

  useEffect(() => {
    if (rightPanelOpen) {
      if (rightPanelVisualPhase === "open") {
        return;
      }
      if (rightPanelVisualPhase !== "opening") {
        console.info("[App] 右侧工作区进入打开动画", {
          from: rightPanelVisualPhase,
          mode: rightPanelMode
        });
        setRightPanelVisualPhase("opening");
      }
      const timer = window.setTimeout(() => {
        console.info("[App] 右侧工作区打开动画完成", { mode: rightPanelMode });
        setRightPanelVisualPhase("open");
      }, RIGHT_PANEL_VISUAL_TRANSITION_MS);
      return () => window.clearTimeout(timer);
    }
    if (rightPanelVisualPhase === "closed") {
      return;
    }
    if (rightPanelVisualPhase !== "closing") {
      console.info("[App] 右侧工作区进入收起动画", {
        from: rightPanelVisualPhase,
        mode: rightPanelMode
      });
      setRightPanelVisualPhase("closing");
    }
    const timer = window.setTimeout(() => {
      console.info("[App] 右侧工作区收起动画完成", { mode: rightPanelMode });
      setRightPanelVisualPhase("closed");
    }, RIGHT_PANEL_VISUAL_TRANSITION_MS);
    return () => window.clearTimeout(timer);
  }, [rightPanelMode, rightPanelOpen, rightPanelVisualPhase]);

  useEffect(() => {
    if (rightPanelOpen && rightPanelTriggerHiding) {
      setRightPanelTriggerHiding(false);
    }
  }, [rightPanelOpen, rightPanelTriggerHiding]);

  useEffect(() => {
    if (view !== "home" || rightPanelOpen || !rightPanelLayoutActive) {
      return;
    }
    console.debug("[App] 首页切换期间跳过右侧工作区收起占位", {
      phase: rightPanelPhase,
      mode: rightPanelMode
    });
  }, [rightPanelLayoutActive, rightPanelMode, rightPanelOpen, rightPanelPhase, view]);

  useEffect(
    () => () => {
      if (rightPanelTriggerTimerRef.current !== undefined) {
        window.clearTimeout(rightPanelTriggerTimerRef.current);
      }
    },
    []
  );

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        const store = useAppStore.getState();
        store.setPaletteOpen(!store.paletteOpen);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const isFilesDrag = (event: DragEvent<HTMLElement>) =>
    acceptsDroppedContext && Array.from(event.dataTransfer.types).includes("Files");

  const handleMainDragEnter = (event: DragEvent<HTMLElement>) => {
    if (!isFilesDrag(event)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    setDragDepth((depth) => depth + 1);
  };

  const handleMainDragOver = (event: DragEvent<HTMLElement>) => {
    if (!isFilesDrag(event)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
  };

  const handleMainDragLeave = (event: DragEvent<HTMLElement>) => {
    if (!isFilesDrag(event)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    setDragDepth((depth) => Math.max(0, depth - 1));
  };

  const handleMainDrop = (event: DragEvent<HTMLElement>) => {
    if (!isFilesDrag(event)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    setDragDepth(0);
    const files = Array.from(event.dataTransfer.files);
    console.info("[app] 主内容区收到文件拖拽投放", {
      view,
      fileCount: files.length
    });
    if (files.length > 0) {
      void addDroppedContext(files);
    }
  };

  function handleRightPanelToggle(): void {
    if (rightPanelOpen || rightPanelLayoutActive) {
      toggleRightPanel();
      return;
    }
    if (rightPanelTriggerHiding) {
      return;
    }
    console.info("[App] 右上角工具组先隐藏，随后打开右侧工作区", {
      delayMs: RIGHT_PANEL_TRIGGER_HIDE_MS,
      mode: rightPanelMode
    });
    setRightPanelTriggerHiding(true);
    rightPanelTriggerTimerRef.current = window.setTimeout(() => {
      rightPanelTriggerTimerRef.current = undefined;
      console.info("[App] 右上角工具组隐藏完成，打开右侧工作区", {
        mode: useAppStore.getState().rightPanelMode
      });
      toggleRightPanel();
    }, RIGHT_PANEL_TRIGGER_HIDE_MS);
  }

  return (
    <TooltipProvider delayDuration={300}>
      <ConfirmDialogProvider>
        <div className="flex h-screen overflow-hidden bg-background text-foreground">
          {isMacDesktop ? <div className="titlebar-drag" /> : null}
          <CommandPalette />
          <SetupDialog />
          <NotificationToasts />
          <UpdateCenter />
          <DevToolsFloatingButton />
          {view === "settings" ? (
            <SettingsView />
          ) : (
            <>
              <SidebarToggle />
              <Sidebar />
              <div
                data-testid="main-drop-zone"
                onDragEnter={handleMainDragEnter}
                onDragOver={handleMainDragOver}
                onDragLeave={handleMainDragLeave}
                onDrop={handleMainDrop}
                className={cn(
                  "relative flex h-screen min-h-0 min-w-0 flex-1 bg-background transition-colors",
                  dropActive && "bg-link-bg-soft/20"
                )}
              >
                {dropActive ? (
                  <div
                    aria-hidden
                    className="pointer-events-none absolute inset-0 z-[80] flex items-center justify-center border-2 border-dashed border-link bg-link-bg-soft/55"
                  >
                    <div className="flex items-center gap-2 rounded-pill border border-link/30 bg-card px-4 py-2 text-caption text-link-deep shadow-subtle">
                      <DocumentIcon className="size-4 text-muted-foreground" />
                      <span>{t("composer.dropContextHint")}</span>
                    </div>
                  </div>
                ) : null}
                <main className="relative flex h-screen min-h-0 min-w-0 flex-1 flex-col bg-background">
                  {view === "chat" ? (
                    <div
                      data-testid="right-panel-toolbar"
                      className={cn(
                        "absolute right-3 top-3 z-[60] flex origin-top-right scale-100 items-center gap-1 opacity-100 [-webkit-app-region:no-drag] transition-[opacity,transform] duration-150 ease-out sm:right-6",
                        rightPanelControlsHidden
                          ? "pointer-events-none scale-95 opacity-0"
                          : "pointer-events-auto scale-100 opacity-100"
                      )}
                    >
                      <OpenInIdeButton />
                      {showSessionDebugButton ? <SessionDebugButton /> : null}
                      <RightPanelSwitch onToggle={handleRightPanelToggle} />
                    </div>
                  ) : null}
                  {view === "tasks" ? (
                    <TasksView />
                  ) : view === "plugins" ? (
                    <PluginsView />
                  ) : view === "connectPhone" ? (
                    <ConnectPhoneView />
                  ) : view === "home" ? (
                    <div className="flex min-h-0 flex-1 overflow-y-auto px-6 py-10 sm:px-8 sm:py-12">
                      <div className="m-auto flex w-full max-w-[62rem] flex-col items-center">
                        {/* Hero:左侧人物紧贴右侧话术（主句 + 副标题），移动端自动堆叠居中。 */}
                        <section
                          aria-label={t("home.heroAlt")}
                          className={cn(
                            "home-hero grid w-full grid-cols-1 items-center justify-center justify-items-center gap-3 text-center md:grid-cols-[auto_minmax(0,auto)] md:gap-6 md:-translate-x-5 md:text-left",
                            homeHeroStyles.hero
                          )}
                        >
                          <HomeMascot
                            className={cn(
                              "home-mascot size-32 sm:size-40 md:size-48 md:justify-self-end",
                              homeHeroStyles.mascot
                            )}
                          />
                          <div
                            className={cn(
                              "home-copy flex flex-col items-center md:items-start",
                              homeHeroStyles.copy
                            )}
                          >
                            <h1
                              data-testid="home-hero-phrase"
                              className={cn(
                                "home-phrase whitespace-nowrap text-display-lg text-foreground",
                                homeHeroStyles.phrase
                              )}
                            >
                              {homeHeroPhrase}
                            </h1>
                            <p
                              className={cn(
                                "home-subtitle mt-2 pl-1 text-body-md text-mute",
                                homeHeroStyles.subtitle
                              )}
                            >
                              {t("home.subtitle")}
                            </p>
                          </div>
                        </section>
                        <div className="mt-8 w-full max-w-[48rem] md:mt-10">
                          <Composer />
                        </div>
                        <div className="mt-6 w-full">
                          <HomeStarters />
                        </div>
                      </div>
                    </div>
                  ) : (
                    <>
                      <header
                        className={cn(
                          "flex h-12 flex-none items-center border-b px-12 transition-[padding] duration-200 ease-out",
                          headerInset && "pl-[124px]"
                        )}
                      >
                        <div className="flex min-w-0 max-w-[60%] items-center gap-1.5 [-webkit-app-region:no-drag]">
                          <span className="min-w-0 truncate text-body-sm font-[500] text-foreground">
                            {activeSession?.title ?? ""}
                          </span>
                          {activeSession ? <SessionActionsMenu session={activeSession} /> : null}
                        </div>
                      </header>
                      {/* chat-layout-scope 提供 @container 查询基准，relative 为浮动面板提供定位参照。
                          data-right-panel-* 只记录右侧工作区状态，方便测试和布局问题排查。 */}
                      <div
                        data-testid="chat-layout-scope"
                        data-right-panel-open={rightPanelOpen ? "true" : "false"}
                        data-right-panel-phase={rightPanelPhase}
                        data-right-panel-reserved={rightPanelLayoutActive ? "true" : "false"}
                        data-right-panel-maximized={
                          rightPanelLayoutActive && rightPanelMaximized ? "true" : "false"
                        }
                        data-right-panel-mode={
                          rightPanelLayoutActive ? (rightPanelMode ?? "menu") : "closed"
                        }
                        className={cn(
                          "chat-layout-scope relative flex min-h-0 flex-1 flex-col",
                          chatLayoutStyles.scope
                        )}
                      >
                        <div className="flex min-h-0 flex-1 flex-col">
                          <ChatView />
                          <div
                            className={cn(
                              "chat-composer-dock flex-none px-12 pb-3 pt-0",
                              chatLayoutStyles.composerDock
                            )}
                          >
                            <div
                              data-testid="chat-composer-column"
                              className={cn("chat-primary-column", chatLayoutStyles.primaryColumn)}
                            >
                              <ApprovalDock />
                              {hideComposerForDecisionDock ? null : <Composer />}
                            </div>
                          </div>
                        </div>
                        {/* 浮动面板：绝对定位于 chat-layout-scope 右侧，@container 控制显隐 */}
                        <div
                          data-testid="chat-floating-stack"
                          className={cn("chat-floating-stack", chatLayoutStyles.floatingStack)}
                        >
                          <ArtifactFloatingPanel />
                          <ProgressFloatingPanel />
                        </div>
                      </div>
                    </>
                  )}
                </main>
                {/* 首页只在附件预览被主动打开后挂载右侧面板，默认仍保持干净。 */}
                {showRightPanel ? <RightPanel phase={rightPanelPhase} /> : null}
              </div>
            </>
          )}
        </div>
      </ConfirmDialogProvider>
    </TooltipProvider>
  );
}
