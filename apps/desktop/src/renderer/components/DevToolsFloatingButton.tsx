import { CodeIcon } from "@/assets/file-type-icons";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAppStore } from "@/store";

export function DevToolsFloatingButton() {
  const { t } = useTranslation();
  const setNotice = useAppStore((state) => state.setNotice);
  const openDevTools = window.chengxiaobang?.openDevTools;

  if (!openDevTools) {
    return null;
  }

  const handleOpen = async () => {
    try {
      const result = await openDevTools();
      if (!result.ok) {
        const message = result.error ?? t("devTools.openFailedFallback");
        console.warn("[devtools-floating-button] 打开 DevTools 失败", { message });
        setNotice(t("devTools.openFailed", { error: message }));
        return;
      }
      console.info("[devtools-floating-button] 已请求打开 DevTools");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn("[devtools-floating-button] 打开 DevTools 异常", { message });
      setNotice(t("devTools.openFailed", { error: message }));
    }
  };

  return (
    <div className="fixed bottom-3 right-3 z-[75] [-webkit-app-region:no-drag]">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="secondary"
            size="icon"
            aria-label={t("devTools.open")}
            title={t("devTools.open")}
            className="size-10 rounded-full border border-border bg-canvas text-foreground shadow-float hover:bg-canvas-soft-2"
            onClick={handleOpen}
          >
            <CodeIcon className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="left">{t("devTools.open")}</TooltipContent>
      </Tooltip>
    </div>
  );
}
