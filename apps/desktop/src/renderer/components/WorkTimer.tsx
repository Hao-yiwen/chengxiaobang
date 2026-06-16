import { ChevronIcon } from "@/assets/file-type-icons";
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { TurnTiming } from "@/lib/timeline";
import { workedParts } from "@/lib/work-timer";
import { cn } from "@/lib/utils";

/**
 * 一个 AI 轮次顶部的「已工作 X 分 Y 秒」折叠头。运行中实时计时（每 250ms）、
 * 默认展开承载中间过程；完成/历史态定格耗时、默认折叠、可点击展开；中间过程为空时退化为
 * 不可展开的纯标签。折叠头外的内容（上方 user 消息、下方最终答复）由 ChatView 渲染。
 *
 * 「运行结束自动折叠」由 ChatView 在 active 翻转时换 key 重挂实现（复刻 ReasoningPanel 的
 * streaming/settled 不同实例机制）：本组件只按挂载时的 timing 初始化 open，不监听 mode 切换。
 */
export function WorkTimer({
  timing,
  collapsible,
  children
}: {
  timing: TurnTiming;
  collapsible: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const running = timing.mode === "running";
  const startedAt = timing.mode === "running" ? timing.startedAt : undefined;
  // 活跃轮（running）默认展开，历史/完成轮默认折叠——与 ReasoningPanel 的 useState(streaming) 同理。
  const [open, setOpen] = useState(running);
  const [elapsed, setElapsed] = useState(() =>
    startedAt !== undefined ? Math.max(0, Date.now() - startedAt) : 0
  );

  useEffect(() => {
    if (startedAt === undefined) {
      return;
    }
    setElapsed(Math.max(0, Date.now() - startedAt));
    const id = window.setInterval(() => {
      setElapsed(Math.max(0, Date.now() - startedAt));
    }, 250);
    return () => window.clearInterval(id);
  }, [startedAt]);

  const liveMs =
    timing.mode === "running" ? elapsed : timing.mode === "settled" ? timing.durationMs : 0;
  const { minutes, seconds } = workedParts(liveMs, running);
  const header =
    timing.mode === "unknown"
      ? t("chat.workedLabel")
      : minutes > 0
        ? t("chat.workedMinSec", { minutes, seconds })
        : t("chat.workedSec", { seconds });

  return (
    <div className="mb-4 self-stretch">
      {collapsible ? (
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="flex cursor-pointer items-center gap-2 text-body-xs text-muted-foreground"
        >
          <span>{header}</span>
          <ChevronIcon
            className={cn("size-4 transition-transform duration-200", open ? "" : "-rotate-90")}
          />
        </button>
      ) : (
        <div className="flex items-center gap-2 text-body-xs text-muted-foreground">
          <span>{header}</span>
        </div>
      )}
      {/* 折叠头下方常驻分隔线（折叠态 / 展开态都显示），呼应设计稿的轮次分隔。 */}
      <div className="mt-2 border-b border-hairline" />
      {collapsible ? (
        <div
          className={cn(
            "grid",
            open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
          )}
        >
          <div className="overflow-hidden">
            {/* 折叠头到首项留出呼吸空间；末项底距归零，收紧折叠体到最终答复的距离。 */}
            <div className="mt-3 flex flex-col [&>*:last-child]:mb-0">{children}</div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
