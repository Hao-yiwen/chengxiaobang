import { useEffect } from "react";
import { ApprovalDock } from "./components/ApprovalDock";
import { ChatView } from "./components/ChatView";
import { CommandPalette } from "./components/CommandPalette";
import { BrandWordmark } from "./components/BrandWordmark";
import { Composer } from "./components/Composer";
import { HomeStarters } from "./components/HomeStarters";
import { OpenInIdeButton } from "./components/OpenInIdeButton";
import { RightPanel } from "./components/right-panel/RightPanel";
import { RightPanelSwitch } from "./components/right-panel/RightPanelSwitch";
import { SettingsView } from "./components/SettingsView";
import { SetupDialog } from "./components/SetupDialog";
import { Sidebar, SidebarToggle } from "./components/Sidebar";
import { TasksView } from "./components/TasksView";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useThemeController } from "@/hooks/use-theme";
import { useI18nController } from "@/hooks/use-i18n";
import type { ApiClient } from "@/lib/api";
import { cn } from "@/lib/utils";
import { selectActiveSession, useAppStore } from "@/store";

export function App(props: { client?: ApiClient }) {
  const view = useAppStore((state) => state.view);
  const notice = useAppStore((state) => state.notice);
  const activeSession = useAppStore(selectActiveSession);
  const rightPanelOpen = useAppStore((state) => state.rightPanelOpen);
  const sidebarOpen = useAppStore((state) => state.sidebarOpen);
  // 折叠后 Electron 红绿灯 + 折叠按钮悬浮在主区左上角，头部标题需要让位。
  const headerInset = !sidebarOpen && Boolean(window.chengxiaobang);

  useThemeController();
  useI18nController();

  useEffect(() => {
    void useAppStore.getState().initClient(props.client);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-screen overflow-hidden bg-background text-foreground">
        <div className="titlebar-drag" />
        <CommandPalette />
        <SetupDialog />
        {view === "settings" ? (
          <SettingsView />
        ) : (
          <>
            <SidebarToggle />
            <Sidebar />
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
                  <RightPanelSwitch />
                </div>
              ) : null}
              {notice ? (
                <div className="absolute inset-x-0 top-12 z-30 flex justify-center px-6">
                  <div className="animate-scale-in max-w-[44rem] rounded-sm bg-card px-4 py-2.5 text-caption leading-relaxed text-foreground shadow-overlay">
                    {notice}
                  </div>
                </div>
              ) : null}

              {view === "tasks" ? (
                <TasksView />
              ) : view === "home" ? (
                <div className="flex min-h-0 flex-1 overflow-y-auto px-8 py-12">
                  <div className="m-auto flex w-full max-w-[58rem] flex-col items-center text-center">
                    {/* Hero:程小帮品牌字标(霞鹜文楷字形矢量化) */}
                    <BrandWordmark className="h-[72px] w-auto text-foreground" />
                    <div className="mt-10 w-full max-w-[48rem]">
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
                  <div className="flex-none bg-background px-12 pb-3 pt-4">
                    <div className="mx-auto w-full max-w-[48rem]">
                      <ApprovalDock />
                      <Composer />
                    </div>
                  </div>
                </>
              )}
            </main>
            {/* 首页/任务页保持干净：面板及其开关只在会话视图出现 */}
            {view === "chat" ? <RightPanel /> : null}
          </>
        )}
      </div>
    </TooltipProvider>
  );
}
