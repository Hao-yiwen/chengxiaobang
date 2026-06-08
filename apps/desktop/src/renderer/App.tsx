import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { ChatView } from "./components/ChatView";
import { CommandPalette } from "./components/CommandPalette";
import { Composer } from "./components/Composer";
import { HomeStarters } from "./components/HomeStarters";
import { Logo } from "./components/Logo";
import { SettingsView } from "./components/SettingsView";
import { Sidebar } from "./components/Sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useThemeController } from "@/hooks/use-theme";
import { useI18nController } from "@/hooks/use-i18n";
import type { ApiClient } from "@/lib/api";
import { selectHeading, useAppStore } from "@/store";
import { cn } from "@/lib/utils";

export function App(props: { client?: ApiClient }) {
  const { t } = useTranslation();
  const view = useAppStore((state) => state.view);
  const notice = useAppStore((state) => state.notice);
  const heading = useAppStore(selectHeading);

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
      <div className="grid h-screen overflow-hidden grid-cols-[252px_minmax(0,1fr)] grid-rows-[minmax(0,1fr)] bg-surface max-[840px]:grid-cols-1">
        <div className="titlebar-drag" />
        <Sidebar />
        <CommandPalette />
        {view === "settings" ? (
          <SettingsView />
        ) : (
          <main
            className={cn(
              "relative m-2 ml-0 flex h-[calc(100vh-1rem)] min-h-0 flex-col items-center overflow-hidden rounded-xl border bg-background px-10 pb-7 pt-16 shadow-soft max-[840px]:m-0 max-[840px]:h-screen max-[840px]:rounded-none max-[840px]:border-0",
              view === "home" ? "home-aura justify-center" : "justify-end"
            )}
          >
            {notice ? (
              <div className="animate-scale-in mb-4 w-[min(760px,100%)] rounded-lg border border-amber/40 bg-amber/10 px-4 py-3 text-sm text-foreground/80">
                {notice}
              </div>
            ) : null}
            {view === "home" ? (
              <div className="mb-9 flex flex-col items-center">
                <div className="relative mb-7 animate-scale-in">
                  <div
                    aria-hidden
                    className="absolute -inset-5 -z-10 rounded-full bg-brand/20 blur-2xl"
                  />
                  <div className="flex size-[72px] items-center justify-center rounded-[20px] border border-brand/15 bg-card shadow-elevated">
                    <Logo className="size-12" />
                  </div>
                </div>
                <h1 className="max-w-[720px] text-balance text-center text-[33px] font-semibold leading-tight tracking-tight">
                  {heading}
                </h1>
                <p className="mt-3 max-w-[560px] text-center text-[15px] text-muted-foreground">
                  {t("home.subtitle")}
                </p>
              </div>
            ) : null}
            {view === "chat" ? <ChatView /> : null}
            <Composer />
            {view === "home" ? <HomeStarters /> : null}
          </main>
        )}
      </div>
    </TooltipProvider>
  );
}
