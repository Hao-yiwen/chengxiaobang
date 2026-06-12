import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  askUserArgsSchema,
  type ApprovalDecision,
  type AskUserAnswer,
  type ToolCall
} from "@chengxiaobang/shared";
import { cn } from "@/lib/utils";

/**
 * ask-user 问答卡（UI-SPEC §8 + ARCH-SPEC §3.5）。
 *
 * props 驱动、不 import store：活跃 run 的 pendingTool（name === "ask_user"）
 * 由 ChatView 接线渲染本卡；答案通过 `onDecide` 走 POST /api/approvals/:toolCallId。
 * - 单击选项即提交：行底朱砂 soft 闪 240ms → onDecide({approved:true, answer:{optionLabel}})；
 * - 键盘：直接按 A-Z 命中选项，↑↓ 导航 + 回车提交；
 * - allowFreeText 时「其他」底边式输入框，回车或「答复」提交 {text}；
 * - 「跳过」→ onDecide({approved:false})；
 * - `resolved` 传入（或本卡刚提交完）→ 塌缩为一行回执 `¿ 问题 → 答案`。
 */
export interface AskUserCardProps {
  toolCall: ToolCall;
  onDecide: (decision: ApprovalDecision) => void;
  /** 已回答的回执形态；不传则为活跃提问态。 */
  resolved?: AskUserAnswer;
}

/** 选项行点击后的朱砂 soft 闪现时长（UI-SPEC §8 / §13-7）。 */
export const OPTION_FLASH_MS = 240;

function letterOf(index: number): string {
  return String.fromCharCode(65 + index);
}

type LocalAnswer = AskUserAnswer | "skipped";

export function AskUserCard({ toolCall, onDecide, resolved }: AskUserCardProps) {
  const { t } = useTranslation();
  const parsed = useMemo(() => askUserArgsSchema.safeParse(toolCall.args), [toolCall.args]);

  const [answered, setAnswered] = useState<LocalAnswer | null>(null);
  const [flashIndex, setFlashIndex] = useState<number | null>(null);
  const [highlight, setHighlight] = useState<number | null>(null);
  const [customText, setCustomText] = useState("");
  const [customFocused, setCustomFocused] = useState(false);
  const lockedRef = useRef(false);
  const timerRef = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  useEffect(() => {
    if (!parsed.success) {
      console.warn("[AskUserCard] ask_user 参数解析失败", {
        toolCallId: toolCall.id,
        runId: toolCall.runId,
        issues: parsed.error.issues
      });
    }
  }, [parsed, toolCall.id, toolCall.runId]);

  const question = parsed.success ? parsed.data.question : "";
  const options = useMemo(
    () => (parsed.success ? (parsed.data.options ?? []) : []),
    [parsed]
  );
  const allowFreeText = parsed.success ? parsed.data.allowFreeText : true;

  const active = !resolved && answered === null;

  const submitOption = (index: number) => {
    const label = options[index];
    if (lockedRef.current || label === undefined) {
      return;
    }
    lockedRef.current = true;
    setFlashIndex(index);
    timerRef.current = window.setTimeout(() => {
      console.info("[AskUserCard] 提交选项答案", {
        toolCallId: toolCall.id,
        runId: toolCall.runId,
        optionIndex: index,
        optionLabel: label
      });
      setAnswered({ optionLabel: label });
      onDecide({ approved: true, answer: { optionLabel: label } });
    }, OPTION_FLASH_MS);
  };

  const submitCustom = () => {
    const text = customText.trim();
    if (lockedRef.current || text.length === 0) {
      return;
    }
    lockedRef.current = true;
    console.info("[AskUserCard] 提交自定义答案", {
      toolCallId: toolCall.id,
      runId: toolCall.runId,
      textLength: text.length
    });
    setAnswered({ text });
    onDecide({ approved: true, answer: { text } });
  };

  const skip = () => {
    if (lockedRef.current) {
      return;
    }
    lockedRef.current = true;
    console.info("[AskUserCard] 用户跳过提问", {
      toolCallId: toolCall.id,
      runId: toolCall.runId
    });
    setAnswered("skipped");
    onDecide({ approved: false });
  };

  // 键盘直达：A-Z 命中选项、↑↓ 导航、回车提交（输入框聚焦时让位给输入框）。
  useEffect(() => {
    if (!active || options.length === 0) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) {
        return;
      }
      if (/^[a-zA-Z]$/.test(event.key)) {
        const index = event.key.toUpperCase().charCodeAt(0) - 65;
        if (index >= 0 && index < options.length) {
          event.preventDefault();
          submitOption(index);
        }
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setHighlight((current) => (current === null ? 0 : (current + 1) % options.length));
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setHighlight((current) =>
          current === null ? options.length - 1 : (current - 1 + options.length) % options.length
        );
        return;
      }
      if (event.key === "Enter" && highlight !== null) {
        event.preventDefault();
        submitOption(highlight);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, options, highlight]);

  // 回执形态：resolved（历史接线）或本卡刚提交完。
  const receipt = resolved ?? (answered === "skipped" ? undefined : (answered ?? undefined));
  if (resolved || answered !== null) {
    const answerText =
      answered === "skipped" && !resolved
        ? t("chat.askUser.skipped")
        : (receipt?.optionLabel ?? receipt?.text ?? "");
    const optionIndex = receipt?.optionLabel ? options.indexOf(receipt.optionLabel) : -1;
    return (
      <div className="mb-3 max-w-full self-start border-l-[3px] border-cinnabar pl-3 text-[12.5px] leading-[19px] text-secondary-foreground">
        <span aria-hidden className="text-ink-3">
          ¿{" "}
        </span>
        {question}
        <span aria-hidden className="text-ink-3">
          {" "}
          →{" "}
        </span>
        {optionIndex >= 0 ? `${letterOf(optionIndex)} ` : ""}
        {answerText}
      </div>
    );
  }

  return (
    <div className="mb-3 w-full max-w-[560px] self-start">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[12.5px] text-ink-3">
          <span aria-hidden>¿ </span>
          {t("chat.askUser.title")}
        </span>
        <button
          type="button"
          onClick={skip}
          className="text-[12px] text-ink-4 transition-colors duration-[120ms] hover:text-cinnabar"
        >
          {t("chat.askUser.skip")}
        </button>
      </div>
      <div className="overflow-hidden rounded-[10px] border border-line-strong border-l-[3px] border-l-cinnabar bg-card">
        <div className="px-4 pb-2 pt-3 font-serif text-[16px] leading-6 text-foreground">
          {parsed.success ? question : t("chat.askUser.invalidArgs")}
        </div>
        {options.length > 0 ? (
          <div
            className={cn(
              "border-t border-line-weak transition-opacity duration-[120ms]",
              customFocused && "opacity-50"
            )}
          >
            {options.map((label, index) => {
              const lit = flashIndex === index || highlight === index;
              return (
                <button
                  key={`${index}-${label}`}
                  type="button"
                  onClick={() => submitOption(index)}
                  className={cn(
                    "group flex h-11 w-full items-center gap-2 border-b border-line-weak px-2 text-left text-[13.5px] text-foreground transition-colors duration-[120ms] last:border-b-0 hover:bg-cinnabar-soft",
                    lit && "bg-cinnabar-soft"
                  )}
                >
                  <span
                    className={cn(
                      "w-7 flex-none text-right font-serif text-[14px] text-ink-3 transition-colors duration-[120ms] group-hover:text-cinnabar",
                      lit && "text-cinnabar"
                    )}
                  >
                    {letterOf(index)}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{label}</span>
                </button>
              );
            })}
          </div>
        ) : null}
        {allowFreeText ? (
          <div className="flex items-center gap-2 border-t border-line-weak px-4 py-2.5">
            <span className="flex-none text-[12.5px] text-ink-3">
              {t("chat.askUser.customLabel")}
            </span>
            <input
              value={customText}
              onChange={(event) => setCustomText(event.target.value)}
              onFocus={() => setCustomFocused(true)}
              onBlur={() => setCustomFocused(false)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submitCustom();
                }
              }}
              placeholder={t("chat.askUser.customPlaceholder")}
              aria-label={t("chat.askUser.customLabel")}
              className="min-w-0 flex-1 border-0 border-b border-line bg-transparent px-0 py-1 text-[13px] text-foreground outline-none transition-colors duration-[120ms] placeholder:text-ink-4 focus:border-line-strong"
            />
            <button
              type="button"
              onClick={submitCustom}
              className="flex-none rounded-md border border-line px-2.5 py-1 text-[12.5px] text-secondary-foreground transition-colors duration-[120ms] hover:border-line-strong"
            >
              {t("chat.askUser.submit")}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
