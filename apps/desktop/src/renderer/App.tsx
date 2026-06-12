import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { ChatView } from "./components/ChatView";
import { CommandPalette } from "./components/CommandPalette";
import { Composer } from "./components/Composer";
import { HomeStarters } from "./components/HomeStarters";
import { RightPanel } from "./components/right-panel/RightPanel";
import { RightPanelSwitch } from "./components/right-panel/RightPanelSwitch";
import { SettingsView } from "./components/SettingsView";
import { SetupDialog } from "./components/SetupDialog";
import { Sidebar } from "./components/Sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useThemeController } from "@/hooks/use-theme";
import { useI18nController } from "@/hooks/use-i18n";
import type { ApiClient } from "@/lib/api";
import { selectActiveSession, selectHeading, useAppStore } from "@/store";

export function App(props: { client?: ApiClient }) {
  const { t } = useTranslation();
  const view = useAppStore((state) => state.view);
  const notice = useAppStore((state) => state.notice);
  const heading = useAppStore(selectHeading);
  const activeSession = useAppStore(selectActiveSession);

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
            <Sidebar />
            <main className="relative flex h-screen min-h-0 min-w-0 flex-1 flex-col bg-background">
              <RightPanelSwitch />
              {notice ? (
                <div className="absolute inset-x-0 top-12 z-30 flex justify-center px-6">
                  <div className="animate-scale-in max-w-[44rem] rounded-sm border bg-card px-4 py-2.5 text-caption leading-relaxed text-foreground shadow-overlay">
                    {notice}
                  </div>
                </div>
              ) : null}

              {view === "home" ? (
                <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-16 pt-24">
                  <div className="mx-auto flex w-full max-w-[58rem] flex-col">
                    <p className="mb-5 font-mono text-mono-label uppercase text-coral">
                      {t("home.tagline")}
                    </p>
                    <h1 className="max-w-[46rem] text-balance font-display text-section font-normal text-foreground">
                      {heading}
                    </h1>
                    <div className="mt-10 max-w-[48rem]">
                      <Composer />
                    </div>
                    <div className="mt-8 border-t pt-5">
                      <HomeStarters />
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  <header className="flex h-14 flex-none items-center border-b px-8 [-webkit-app-region:drag]">
                    <span className="max-w-[60%] truncate font-mono text-mono-label uppercase text-body-muted">
                      {activeSession?.title ?? ""}
                    </span>
                  </header>
                  <ChatView />
                  <div className="flex-none border-t bg-background px-8 pb-3 pt-4">
                    <div className="mx-auto w-full max-w-[48rem]">
                      <Composer />
                    </div>
                    <p className="px-2 py-2 text-center text-micro text-muted-slate">
                      {t("app.disclaimer")}
                    </p>
                  </div>
                </>
              )}
            </main>
            <RightPanel />
          </>
        )}
      </div>
    </TooltipProvider>
  );
}
