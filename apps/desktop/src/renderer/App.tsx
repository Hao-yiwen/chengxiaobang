import type { DragEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { FilePlusIcon as FilePlus } from "@phosphor-icons/react";
import { ApprovalDock } from "./components/ApprovalDock";
import { ChatView } from "./components/ChatView";
import { CommandPalette } from "./components/CommandPalette";
import { Composer } from "./components/Composer";
import { ConfirmDialogProvider } from "./components/ConfirmDialog";
import { HomeMascot } from "./components/HomeMascot";
import { HomeStarters } from "./components/HomeStarters";
import { NotificationToasts } from "./components/NotificationToasts";
import { OpenInIdeButton } from "./components/OpenInIdeButton";
import { RightPanel } from "./components/right-panel/RightPanel";
import { RightPanelSwitch } from "./components/right-panel/RightPanelSwitch";
import { SettingsView } from "./components/SettingsView";
import { SessionDebugButton } from "./components/SessionDebugButton";
import { SetupDialog } from "./components/SetupDialog";
import { Sidebar, SidebarToggle } from "./components/Sidebar";
import { SkillsView } from "./components/SkillsView";
import { TasksView } from "./components/TasksView";
import { UpdateCenter } from "./components/UpdateCenter";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useThemeController } from "@/hooks/use-theme";
import { useI18nController } from "@/hooks/use-i18n";
import type { ApiClient } from "@/lib/api";
import { cn } from "@/lib/utils";
import { selectActiveSession, useAppStore } from "@/store";

const HOME_HERO_PHRASE_KEYS = ["today", "next", "build", "ship"] as const;

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
  const sidebarOpen = useAppStore((state) => state.sidebarOpen);
  const pendingDecisionTool = useAppStore((state) => state.pendingTool);
  const addDroppedContext = useAppStore((state) => state.addDroppedContext);
  const [dragDepth, setDragDepth] = useState(0);
  // 折叠后 Electron 红绿灯 + 折叠按钮悬浮在主区左上角，头部标题需要让位。
  const headerInset = !sidebarOpen && Boolean(window.chengxiaobang);
  const acceptsDroppedContext = view === "home" || view === "chat";
  const dropActive = acceptsDroppedContext && dragDepth > 0;
  const showRightPanel = view === "chat" || (view === "home" && rightPanelOpen);
  const hideComposerForDecisionDock =
    pendingDecisionTool?.status === "pending_approval" &&
    (pendingDecisionTool.name === "ask_user" || pendingDecisionTool.name === "propose_plan");

  useThemeController();
  useI18nController();

  useEffect(() => {
    void useAppStore.getState().initClient(props.client);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  return (
    <TooltipProvider delayDuration={300}>
      <ConfirmDialogProvider>
        <div className="flex h-screen overflow-hidden bg-background text-foreground">
          <div className="titlebar-drag" />
          <CommandPalette />
          <SetupDialog />
          <NotificationToasts />
          <UpdateCenter />
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
                      <FilePlus className="size-4" />
                      <span>{t("composer.dropContextHint")}</span>
                    </div>
                  </div>
                ) : null}
                <main className="relative flex h-screen min-h-0 min-w-0 flex-1 flex-col bg-background">
                  {view === "chat" ? (
                    <div
                      className={cn(
                        "absolute right-3 top-3 z-[60] flex items-center gap-1 [-webkit-app-region:no-drag] transition-all duration-200 ease-out sm:right-6",
                        rightPanelOpen
                          ? "pointer-events-none translate-x-1 opacity-0"
                          : "translate-x-0 opacity-100"
                      )}
                    >
                      <OpenInIdeButton />
                      <SessionDebugButton />
                      <RightPanelSwitch />
                    </div>
                  ) : null}
                  {view === "tasks" ? (
                    <TasksView />
                  ) : view === "skills" ? (
                    <SkillsView />
                  ) : view === "home" ? (
                    <div className="flex min-h-0 flex-1 overflow-y-auto px-6 py-10 sm:px-8 sm:py-12">
                      <div className="m-auto flex w-full max-w-[62rem] flex-col items-center">
                        {/* Hero:左侧人物紧贴右侧话术（主句 + 副标题），移动端自动堆叠居中。 */}
                        <section
                          aria-label={t("home.heroAlt")}
                          className="home-hero grid w-full grid-cols-1 items-center justify-center justify-items-center gap-3 text-center md:grid-cols-[auto_minmax(0,auto)] md:gap-6 md:-translate-x-5 md:text-left"
                        >
                          <HomeMascot className="home-mascot size-32 sm:size-40 md:size-48 md:justify-self-end" />
                          <div className="home-copy flex flex-col items-center md:items-start">
                            <h1
                              data-testid="home-hero-phrase"
                              className="home-phrase whitespace-nowrap text-display-lg text-foreground"
                            >
                              {homeHeroPhrase}
                            </h1>
                            <p className="home-subtitle mt-2 pl-1 text-body-md text-mute">
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
                          "flex h-14 flex-none items-center border-b px-12 transition-[padding] duration-200 ease-out",
                          headerInset && "pl-[124px]"
                        )}
                      >
                        <span className="max-w-[60%] truncate font-mono text-mono-label uppercase text-body">
                          {activeSession?.title ?? ""}
                        </span>
                      </header>
                      <ChatView />
                      <div className="chat-layout-scope flex-none bg-background pb-3 pt-4">
                        <div className="px-12">
                          <div data-testid="chat-composer-column" className="chat-primary-column">
                            <ApprovalDock />
                            {hideComposerForDecisionDock ? null : <Composer />}
                          </div>
                        </div>
                      </div>
                    </>
                  )}
                </main>
                {/* 首页只在附件预览被主动打开后挂载右侧面板，默认仍保持干净。 */}
                {showRightPanel ? <RightPanel /> : null}
              </div>
            </>
          )}
        </div>
      </ConfirmDialogProvider>
    </TooltipProvider>
  );
}
