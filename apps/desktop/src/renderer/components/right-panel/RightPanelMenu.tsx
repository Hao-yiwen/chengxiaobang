import type { ComponentType } from "react";
import {
  ChatBubblesIcon,
  CodeIcon,
  GlobeOutlineIcon,
  PullRequestOpenIcon,
  TerminalIcon,
  type FileIconSvgProps
} from "@/assets/file-type-icons";

type Icon = ComponentType<FileIconSvgProps>;

import { useTranslation } from "react-i18next";
import type { RightPanelMode } from "@/store";

type RightPanelLabelKey =
  | "rightPanel.changes"
  | "rightPanel.terminal"
  | "rightPanel.browser"
  | "rightPanel.files"
  | "rightPanel.chat";

export const RIGHT_PANEL_MENU_ITEMS: Array<{
  mode: RightPanelMode;
  icon: Icon;
  labelKey: RightPanelLabelKey;
}> = [
  { mode: "changes", icon: PullRequestOpenIcon, labelKey: "rightPanel.changes" },
  { mode: "terminal", icon: TerminalIcon, labelKey: "rightPanel.terminal" },
  { mode: "browser", icon: GlobeOutlineIcon, labelKey: "rightPanel.browser" },
  { mode: "files", icon: CodeIcon, labelKey: "rightPanel.files" },
  { mode: "chat", icon: ChatBubblesIcon, labelKey: "rightPanel.chat" }
];

const RIGHT_PANEL_MODE_ICONS: Record<RightPanelMode, Icon> = {
  changes: PullRequestOpenIcon,
  terminal: TerminalIcon,
  browser: GlobeOutlineIcon,
  files: CodeIcon,
  chat: ChatBubblesIcon
};

/** 工具图标:tab 栏 chip 与 + 选择器复用同一映射。 */
export function rightPanelModeIcon(mode: RightPanelMode): Icon {
  return RIGHT_PANEL_MODE_ICONS[mode] ?? CodeIcon;
}

/** 空面板时的工具选择页:点击工具卡片后新建对应 tab。 */
export function RightPanelMenu({
  availableModes,
  onPick
}: {
  availableModes: RightPanelMode[];
  onPick(mode: RightPanelMode): void;
}) {
  const { t } = useTranslation();
  const visibleItems = RIGHT_PANEL_MENU_ITEMS.filter((item) => availableModes.includes(item.mode));
  return (
    <div className="flex h-full -translate-y-6 flex-col items-center justify-center p-6">
      <div className="flex w-full max-w-[280px] flex-col gap-2">
        {visibleItems.map((item) => (
          <button
            key={item.mode}
            type="button"
            onClick={() => {
              console.debug("[right-panel] 空面板新建 tab", { mode: item.mode });
              onPick(item.mode);
            }}
            className="flex w-full items-center gap-3 rounded-sm border bg-card px-4 py-3 text-left text-caption text-foreground transition-colors hover:bg-canvas-soft-2"
          >
            <item.icon className="size-4 text-muted-foreground" />
            <span>{t(item.labelKey)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
