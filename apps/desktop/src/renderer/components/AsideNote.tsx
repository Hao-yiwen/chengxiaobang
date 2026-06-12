import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { btwArgsSchema, type BtwArgs, type ToolCall } from "@chengxiaobang/shared";
import { StampBadge } from "@/components/StampBadge";
import { cn } from "@/lib/utils";

/**
 * btw 旁注 AsideNote（UI-SPEC §9；ARCH-SPEC §4.5 中的 BtwCard，命名以 UI-SPEC 为准）。
 *
 * props 驱动、不 import store：数据来自 timeline 中 name === "btw" 的 toolCall
 * （btwArgsSchema 解析 note/suggestion），三档断点由 ChatView 的 ResizeObserver
 * 判定后以 `layout` 传入；「转为任务」把草稿文本交给 `onConvertToTask`
 * （接线层填入 composer，不自动发送）。
 */
export type AsideNoteLayout = "gutter-wide" | "gutter-narrow" | "inline";

export interface AsideNoteProps {
  toolCall: ToolCall;
  layout: AsideNoteLayout;
  /** 已转为任务 → 尾部 StampBadge「已转」，隐藏转换链接。 */
  converted: boolean;
  onConvertToTask: (text: string) => void;
  /** 入场动画（translateX 4px 淡入 180ms）；仅贴底跟随时由接线层置 true。 */
  animateIn?: boolean;
}

/** 转为任务的草稿文本（ARCH-SPEC §4.5 约定格式，composer 草稿、不发送）。 */
export function buildTaskDraft(args: BtwArgs): string {
  return `接下来：${args.note}${args.suggestion ? `（建议：${args.suggestion}）` : ""}`;
}

const LAYOUT_CLASSES: Record<AsideNoteLayout, string> = {
  "gutter-wide": "w-[220px]",
  "gutter-narrow": "w-[180px]",
  inline: "my-2 ml-6 max-w-[520px]"
};

export function AsideNote({
  toolCall,
  layout,
  converted,
  onConvertToTask,
  animateIn = false
}: AsideNoteProps) {
  const { t } = useTranslation();
  const parsed = useMemo(() => btwArgsSchema.safeParse(toolCall.args), [toolCall.args]);
  const [entered, setEntered] = useState(!animateIn);

  useEffect(() => {
    if (!animateIn) {
      return;
    }
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(raf);
  }, [animateIn]);

  useEffect(() => {
    if (!parsed.success) {
      console.warn("[AsideNote] btw 参数解析失败，跳过渲染", {
        toolCallId: toolCall.id,
        runId: toolCall.runId,
        issues: parsed.error.issues
      });
    }
  }, [parsed, toolCall.id, toolCall.runId]);

  if (!parsed.success) {
    return null;
  }
  const { note, suggestion } = parsed.data;

  const convert = () => {
    const draft = buildTaskDraft(parsed.data);
    console.info("[AsideNote] 旁注转为任务", {
      toolCallId: toolCall.id,
      runId: toolCall.runId,
      draftLength: draft.length
    });
    onConvertToTask(draft);
  };

  return (
    <aside
      data-layout={layout}
      className={cn(
        "border-l-2 border-ochre pl-3 font-note text-[13px] leading-[21px] text-secondary-foreground",
        LAYOUT_CLASSES[layout],
        "transition-[opacity,transform] duration-[180ms] ease-out",
        entered ? "translate-x-0 opacity-100" : "translate-x-1 opacity-0"
      )}
    >
      <p className="whitespace-pre-wrap break-words">{note}</p>
      {suggestion ? (
        <p className="whitespace-pre-wrap break-words text-ink-3">
          {t("chat.asideNote.suggestionPrefix")}
          {suggestion}
        </p>
      ) : null}
      <div className="mt-1">
        {converted ? (
          <StampBadge
            text={t("chat.asideNote.converted")}
            fullLabel={t("chat.asideNote.convertedFull")}
            tone="moss"
          />
        ) : (
          <button
            type="button"
            onClick={convert}
            className="text-[12px] text-ink-3 transition-colors duration-[120ms] hover:text-cinnabar"
          >
            <span aria-hidden>→ </span>
            {t("chat.asideNote.convert")}
          </button>
        )}
      </div>
    </aside>
  );
}
