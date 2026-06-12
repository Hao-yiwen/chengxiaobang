import {
  ChatsCircleIcon as MessagesSquare,
  FileCodeIcon as FileCode,
  GitDiffIcon as GitCompareArrows,
  GlobeIcon as Globe,
  TerminalWindowIcon as SquareTerminal
} from "@phosphor-icons/react";
import type { Icon } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { useAppStore, type RightPanelMode } from "@/store";

type RightPanelLabelKey =
  | "rightPanel.changes"
  | "rightPanel.terminal"
  | "rightPanel.browser"
  | "rightPanel.files"
  | "rightPanel.chat";

const MENU_ITEMS: Array<{ mode: RightPanelMode; icon: Icon; labelKey: RightPanelLabelKey }> = [
  { mode: "changes", icon: GitCompareArrows, labelKey: "rightPanel.changes" },
  { mode: "terminal", icon: SquareTerminal, labelKey: "rightPanel.terminal" },
  { mode: "browser", icon: Globe, labelKey: "rightPanel.browser" },
  { mode: "files", icon: FileCode, labelKey: "rightPanel.files" },
  { mode: "chat", icon: MessagesSquare, labelKey: "rightPanel.chat" }
];

/** 面板菜单页：选择当前上下文可用的右侧工具。 */
export function RightPanelMenu({ availableModes }: { availableModes: RightPanelMode[] }) {
  const { t } = useTranslation();
  const openRightPanel = useAppStore((state) => state.openRightPanel);
  const visibleItems = MENU_ITEMS.filter((item) => availableModes.includes(item.mode));
  return (
    <div className="flex flex-col gap-2 p-4">
      {visibleItems.map((item) => (
        <button
          key={item.mode}
          type="button"
          onClick={() => {
            console.debug("[right-panel] 打开面板工具", { mode: item.mode });
            openRightPanel(item.mode);
          }}
          className="flex w-full items-center gap-3 rounded-sm border bg-card px-4 py-3 text-left text-caption text-foreground transition-colors hover:bg-canvas-soft-2"
        >
          <item.icon className="size-4 text-muted-foreground" />
          <span>{t(item.labelKey)}</span>
        </button>
      ))}
    </div>
  );
}
