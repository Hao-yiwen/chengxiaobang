import type { AccessMode } from "@chengxiaobang/shared";
import type { QueuedRunItem } from "@/store";

export const TEXTAREA_MAX_HEIGHT_PX = 220;
// 占位文案轮播：单行高度需与 text-body 行高（24px）一致，便于 translateY 对齐。
export const ROTATION_LINE_HEIGHT_PX = 24;
export const ROTATION_INTERVAL_MS = 2800;

export const ACCESS_MODE_TONES: Record<
  AccessMode,
  { trigger: string; menuIcon: string; check: string; hover: string }
> = {
  approval: {
    trigger: "text-muted-foreground",
    menuIcon: "text-muted-foreground",
    check: "text-muted-foreground",
    hover: "hover:bg-canvas-soft-2"
  },
  smart_approval: {
    trigger: "text-link",
    menuIcon: "text-link",
    check: "text-link",
    hover: "hover:bg-link-bg-soft/45"
  },
  full_access: {
    trigger: "text-[#d25f28]",
    menuIcon: "text-[#d25f28]",
    check: "text-[#d25f28]",
    hover: "hover:bg-[#d25f28]/10"
  }
};

export const EMPTY_QUEUED_RUNS: QueuedRunItem[] = [];
