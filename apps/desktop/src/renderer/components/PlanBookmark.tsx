/**
 * PlanBookmark 书签条（UI-SPEC §7.2）。
 *
 * 纯 props 驱动。旧版步骤计划的悬浮书签仍可渲染历史进度；新版计划卡已改为
 * 完整文本确认，不再主动接入本组件。
 */
import { CaretUpIcon as ChevronUp } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";

export interface PlanBookmarkProps {
  /** 1-based 当前步序号 / 总步数 / 当前步标题。 */
  current: { index: number; total: number; title: string };
  onJump(): void;
}

const BOOKMARK_KEYFRAMES = `
@keyframes plan-bookmark-in { from { opacity: 0; transform: translateY(-4px); } }
`;

function pad2(n: number): string {
  return String(Math.max(0, n)).padStart(2, "0");
}

export function PlanBookmark({ current, onJump }: PlanBookmarkProps) {
  const { t } = useTranslation();
  return (
    <>
      <style>{BOOKMARK_KEYFRAMES}</style>
      <button
        type="button"
        aria-label={t("plan.bookmarkLabel", { index: pad2(current.index), total: pad2(current.total) })}
        title={current.title}
        className="sticky top-0 z-10 flex h-7 w-full items-center gap-2 border-b border-line bg-card text-left"
        style={{ animation: "plan-bookmark-in 160ms var(--ease-enter)" }}
        onClick={() => {
          console.debug(
            `[plan-bookmark] 跳回计划卡 ${current.index}/${current.total} title=${current.title}`
          );
          onJump();
        }}
      >
        <span aria-hidden className="ml-2 h-3 w-[2px] shrink-0 bg-indigo" />
        <span className="tnum min-w-0 flex-1 truncate font-mono text-[12px] text-secondary-foreground">
          {`${pad2(current.index)} / ${pad2(current.total)} · ${current.title}`}
        </span>
        <ChevronUp aria-hidden className="mr-2 size-[11px] shrink-0 text-ink-4" />
      </button>
    </>
  );
}
