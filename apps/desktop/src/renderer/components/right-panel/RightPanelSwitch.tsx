import { FileCode, Globe, SquareTerminal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store";

/** The icon cluster in the main view's top-right corner that toggles the right panel. */
export function RightPanelSwitch() {
  const { t } = useTranslation();
  const mode = useAppStore((state) => state.rightPanelMode);
  const toggleRightPanel = useAppStore((state) => state.toggleRightPanel);
  const panes = [
    { mode: "terminal" as const, icon: SquareTerminal, label: t("rightPanel.terminal") },
    { mode: "browser" as const, icon: Globe, label: t("rightPanel.browser") },
    { mode: "files" as const, icon: FileCode, label: t("rightPanel.files") }
  ];
  return (
    <div className="absolute right-4 top-9 z-20 flex items-center gap-1.5 max-[840px]:hidden">
      {panes.map((pane) => (
        <button
          key={pane.mode}
          type="button"
          title={pane.label}
          onClick={() => toggleRightPanel(pane.mode)}
          className={cn(
            "flex size-8 items-center justify-center rounded-sm border bg-card text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
            mode === pane.mode &&
              "border-primary bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground"
          )}
        >
          <pane.icon className="size-4" />
        </button>
      ))}
    </div>
  );
}
