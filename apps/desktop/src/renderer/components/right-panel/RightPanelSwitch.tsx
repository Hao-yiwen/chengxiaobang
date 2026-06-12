import { SidebarSimpleIcon as PanelRight } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "@/store";

/** The top-right toggle that opens/closes the right workspace panel. */
export function RightPanelSwitch() {
  const { t } = useTranslation();
  const open = useAppStore((state) => state.rightPanelOpen);
  const toggleRightPanel = useAppStore((state) => state.toggleRightPanel);
  return (
    <button
      type="button"
      title={open ? t("rightPanel.collapse") : t("rightPanel.open")}
      onClick={() => {
        console.debug("[right-panel] 切换侧边面板", {
          openBefore: open,
          innerWidth: window.innerWidth
        });
        toggleRightPanel();
      }}
      className="flex size-8 items-center justify-center rounded-xs border border-transparent bg-transparent text-muted-foreground transition-colors hover:bg-canvas-soft-2 hover:text-foreground"
    >
      <PanelRight className="size-4" />
    </button>
  );
}
