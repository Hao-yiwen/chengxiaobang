import { PanelRightOutlineIcon } from "@/assets/file-type-icons";
import { useTranslation } from "react-i18next";
import { useAppStore } from "@/store";

/** 右上角打开/关闭右侧工作区的开关。 */
export function RightPanelSwitch({ onToggle }: { onToggle?: () => void }) {
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
        if (onToggle) {
          onToggle();
          return;
        }
        toggleRightPanel();
      }}
      className="flex size-8 items-center justify-center rounded-xs border border-transparent bg-transparent text-muted-foreground transition-colors hover:bg-canvas-soft-2 hover:text-foreground"
    >
      <PanelRightOutlineIcon className="size-4" />
    </button>
  );
}
