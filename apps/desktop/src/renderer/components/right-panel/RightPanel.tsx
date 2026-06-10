import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { BrowserPanel } from "./BrowserPanel";
import { FilePreviewPanel } from "./FilePreviewPanel";
import { TerminalPanel } from "./TerminalPanel";
import { useAppStore } from "@/store";

/**
 * The right workspace panel: a single resizable slot that hosts one of the
 * terminal / browser / file-preview panes, mirroring the left main card.
 */
export function RightPanel() {
  const { t } = useTranslation();
  const mode = useAppStore((state) => state.rightPanelMode);
  const width = useAppStore((state) => state.rightPanelWidth);
  const toggleRightPanel = useAppStore((state) => state.toggleRightPanel);
  const setRightPanelWidth = useAppStore((state) => state.setRightPanelWidth);

  if (!mode) {
    return null;
  }

  const title =
    mode === "terminal"
      ? t("rightPanel.terminal")
      : mode === "browser"
        ? t("rightPanel.browser")
        : t("rightPanel.files");

  function onResizeStart(event: React.PointerEvent<HTMLDivElement>): void {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width;
    const onMove = (move: PointerEvent) =>
      setRightPanelWidth(startWidth + (startX - move.clientX));
    const onUp = () => window.removeEventListener("pointermove", onMove);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  }

  return (
    <aside
      style={{ width }}
      className="relative m-2 ml-0 flex h-[calc(100vh-1rem)] min-h-0 flex-none flex-col overflow-hidden rounded-xl border bg-background shadow-soft max-[840px]:hidden"
    >
      <div
        role="separator"
        aria-orientation="vertical"
        title={t("rightPanel.resize")}
        onPointerDown={onResizeStart}
        className="absolute left-0 top-0 z-10 h-full w-1.5 cursor-col-resize"
      />
      <header className="flex flex-none items-center justify-between gap-2 border-b px-4 pb-2.5 pt-10">
        <h2 className="text-[13px] font-semibold">{title}</h2>
        <button
          type="button"
          title={t("rightPanel.close")}
          onClick={() => toggleRightPanel(mode)}
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </header>
      <div className="min-h-0 flex-1">
        {mode === "terminal" ? (
          <TerminalPanel />
        ) : mode === "browser" ? (
          <BrowserPanel />
        ) : (
          <FilePreviewPanel />
        )}
      </div>
    </aside>
  );
}
