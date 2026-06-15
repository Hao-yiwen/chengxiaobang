import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  askUserAnswerItemText,
  askUserArgsSchema,
  type ApprovalDecision,
  type AskUserAnswer,
  type AskUserAnswerItem,
  type AskUserQuestion,
  type AskUserQuestionOption,
  type ToolCall
} from "@chengxiaobang/shared";
import { cn } from "@/lib/utils";

/**
 * AskUserQuestion 的活跃提问面板。
 *
 * 结构化参数固定为 questions[1..4]。
 * 单题选择题保留点选即提交，多题模式则先收集所有答案，再一次性提交。
 */
export interface AskUserCardProps {
  toolCall: ToolCall;
  onDecide: (decision: ApprovalDecision) => void;
  /** 已回答的回执形态；不传则为活跃提问态。 */
  resolved?: AskUserAnswer;
}

/** 单题选项点击后的轻量反馈时长。 */
export const OPTION_FLASH_MS = 240;

type DraftAnswer = {
  optionIndex?: number;
  text: string;
};
type LocalAnswer = AskUserAnswer | "skipped";

function letterOf(index: number): string {
  return String.fromCharCode(65 + index);
}

function questionKey(question: AskUserQuestion, index: number): string {
  return question.id ?? `q${index + 1}`;
}

function optionLabel(option: AskUserQuestionOption): string {
  return typeof option === "string" ? option : option.label;
}

function optionDescription(option: AskUserQuestionOption): string | undefined {
  return typeof option === "string" ? undefined : option.description;
}

function questionAnswer(question: AskUserQuestion, index: number, draft: DraftAnswer): AskUserAnswerItem | undefined {
  const base = {
    ...(question.id ? { id: question.id } : {}),
    question: question.question
  };
  const options = question.options ?? [];
  if (draft.optionIndex !== undefined && options[draft.optionIndex] !== undefined) {
    return { ...base, optionLabel: optionLabel(options[draft.optionIndex]) };
  }
  const text = draft.text.trim();
  return text ? { ...base, text } : undefined;
}

function fallbackAnswerFor(status: ToolCall["status"]): string {
  if (status === "rejected") {
    return "用户跳过了该问题";
  }
  if (
    status === "pending_approval" ||
    status === "pending_smart_approval" ||
    status === "running"
  ) {
    return "问题未回答（运行已结束）";
  }
  return "无回答";
}

export function AskUserCard({ toolCall, onDecide, resolved }: AskUserCardProps) {
  const { t } = useTranslation();
  const parsed = useMemo(() => askUserArgsSchema.safeParse(toolCall.args), [toolCall.args]);

  const [answered, setAnswered] = useState<LocalAnswer | null>(null);
  const [drafts, setDrafts] = useState<Record<number, DraftAnswer>>({});
  const [flash, setFlash] = useState<{ questionIndex: number; optionIndex: number } | null>(null);
  const [highlight, setHighlight] = useState<number | null>(null);
  const [missing, setMissing] = useState<Set<number>>(() => new Set());
  const lockedRef = useRef(false);
  const timerRef = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  useEffect(() => {
    if (!parsed.success) {
      console.warn("[AskUserCard] AskUserQuestion 参数解析失败", {
        toolCallId: toolCall.id,
        runId: toolCall.runId,
        issues: parsed.error.issues
      });
    }
  }, [parsed, toolCall.id, toolCall.runId]);

  const questions = useMemo(() => (parsed.success ? parsed.data.questions : []), [parsed]);
  const active = !resolved && answered === null;
  const isMultiQuestion = questions.length > 1;

  const draftFor = (index: number): DraftAnswer => drafts[index] ?? { text: "" };

  const setQuestionOption = (questionIndex: number, optionIndex: number) => {
    setDrafts((current) => ({
      ...current,
      [questionIndex]: { ...(current[questionIndex] ?? { text: "" }), optionIndex }
    }));
    setMissing((current) => {
      const next = new Set(current);
      next.delete(questionIndex);
      return next;
    });
  };

  const setQuestionText = (questionIndex: number, text: string) => {
    setDrafts((current) => ({
      ...current,
      [questionIndex]: { ...(current[questionIndex] ?? { text: "" }), text }
    }));
    if (text.trim()) {
      setMissing((current) => {
        const next = new Set(current);
        next.delete(questionIndex);
        return next;
      });
    }
  };

  const buildAnswer = (): AskUserAnswer | undefined => {
    const answers: AskUserAnswerItem[] = [];
    const missingIndexes = new Set<number>();
    questions.forEach((question, index) => {
      const answer = questionAnswer(question, index, draftFor(index));
      if (answer) {
        answers.push(answer);
      } else {
        missingIndexes.add(index);
      }
    });
    if (missingIndexes.size > 0) {
      setMissing(missingIndexes);
      console.warn("[AskUserCard] 结构化提问仍有未回答项，已阻止提交", {
        toolCallId: toolCall.id,
        runId: toolCall.runId,
        missingIndexes: [...missingIndexes]
      });
      return undefined;
    }
    return { answers };
  };

  const submitAnswer = (answer: AskUserAnswer) => {
    if (lockedRef.current) {
      return;
    }
    lockedRef.current = true;
    console.info("[AskUserCard] 提交结构化回答", {
      toolCallId: toolCall.id,
      runId: toolCall.runId,
      answerCount: answer.answers.length
    });
    setAnswered(answer);
    onDecide({ approved: true, answer });
  };

  const submitOption = (questionIndex: number, optionIndex: number) => {
    const question = questions[questionIndex];
    if (!question || lockedRef.current) {
      return;
    }
    if (isMultiQuestion) {
      setQuestionOption(questionIndex, optionIndex);
      return;
    }
    const answer = questionAnswer(question, questionIndex, { optionIndex, text: "" });
    if (!answer) {
      return;
    }
    setFlash({ questionIndex, optionIndex });
    timerRef.current = window.setTimeout(() => {
      submitAnswer({ answers: [answer] });
    }, OPTION_FLASH_MS);
  };

  const submitCustom = (questionIndex: number) => {
    const question = questions[questionIndex];
    if (!question || lockedRef.current) {
      return;
    }
    const answer = questionAnswer(question, questionIndex, draftFor(questionIndex));
    if (!answer) {
      setMissing(new Set([questionIndex]));
      console.warn("[AskUserCard] 自由回答为空，已阻止提交", {
        toolCallId: toolCall.id,
        runId: toolCall.runId,
        questionIndex
      });
      return;
    }
    submitAnswer({ answers: [answer] });
  };

  const submitAll = () => {
    const answer = buildAnswer();
    if (answer) {
      submitAnswer(answer);
    }
  };

  const skip = () => {
    if (lockedRef.current) {
      return;
    }
    lockedRef.current = true;
    console.info("[AskUserCard] 用户跳过提问", {
      toolCallId: toolCall.id,
      runId: toolCall.runId,
      questionCount: questions.length
    });
    setAnswered("skipped");
    onDecide({ approved: false });
  };

  // 单题模式保留键盘直达；多题时避免字母快捷键误选其它题。
  useEffect(() => {
    if (!active || isMultiQuestion || questions[0]?.options?.length === undefined) {
      return;
    }
    const options = questions[0]?.options ?? [];
    if (options.length === 0) {
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
          submitOption(0, index);
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
        submitOption(0, highlight);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, isMultiQuestion, questions, highlight]);

  const receipt = resolved ?? (answered === "skipped" ? undefined : (answered ?? undefined));
  if (resolved || answered !== null) {
    const receiptQuestions = questions.length > 0 ? questions : [{ question: "问题", allowFreeText: true }];
    return (
      <div className="mb-3 max-w-full self-start text-caption leading-relaxed text-muted-foreground">
        {answered === "skipped" && !resolved ? (
          <span>{t("chat.askUser.skipped")}</span>
        ) : (
          <span>
            {receiptQuestions.map((question, index) => {
              const answer = receipt?.answers[index];
              const text = answer ? askUserAnswerItemText(answer) : fallbackAnswerFor(toolCall.status);
              return `${index + 1}. ${question.question} → ${text}`;
            }).join("；")}
          </span>
        )}
      </div>
    );
  }

  const title = parsed.success
    ? questions.length > 1
      ? t("chat.askUser.titleMulti", { count: questions.length })
      : t("chat.askUser.title")
    : t("chat.askUser.title");

  return (
    <div className="mb-3 w-full max-w-[620px] self-start rounded-md border bg-card p-3 shadow-subtle">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-caption font-medium text-foreground">{title}</span>
        <button
          type="button"
          onClick={skip}
          className="flex-none text-micro text-muted-foreground transition-colors hover:text-destructive"
        >
          {t("chat.askUser.skip")}
        </button>
      </div>
      {!parsed.success ? (
        <div className="rounded-sm border border-destructive/30 bg-destructive/5 px-3 py-2 text-caption text-destructive">
          {t("chat.askUser.invalidArgs")}
        </div>
      ) : (
        <div className="space-y-3">
          {questions.map((question, questionIndex) => {
            const options = question.options ?? [];
            const showTextInput = options.length === 0;
            const draft = draftFor(questionIndex);
            const isMissing = missing.has(questionIndex);
            const inputId = `${toolCall.id}-${questionKey(question, questionIndex)}-custom`;
            return (
              <section
                key={questionKey(question, questionIndex)}
                className={cn(
                  "rounded-sm border border-border bg-canvas px-3 py-2.5",
                  isMissing && "border-destructive/50"
                )}
              >
                <div className="mb-2 flex items-start gap-2">
                  {isMultiQuestion ? (
                    <span className="mt-0.5 flex size-5 flex-none items-center justify-center rounded-full bg-canvas-soft-2 text-micro text-muted-foreground">
                      {questionIndex + 1}
                    </span>
                  ) : null}
                  <p className="min-w-0 flex-1 break-words text-body-sm text-foreground">
                    {question.question}
                  </p>
                </div>
                {options.length > 0 ? (
                  <div className="grid gap-1.5">
                    {options.map((option, optionIndex) => {
                      const label = optionLabel(option);
                      const description = optionDescription(option);
                      const selected = draft.optionIndex === optionIndex;
                      const lit =
                        selected ||
                        (flash?.questionIndex === questionIndex && flash.optionIndex === optionIndex) ||
                        (!isMultiQuestion && highlight === optionIndex);
                      return (
                        <button
                          key={`${optionIndex}-${label}`}
                          type="button"
                          onClick={() => submitOption(questionIndex, optionIndex)}
                          className={cn(
                            "flex min-h-9 w-full items-center gap-2 rounded-xs border border-border bg-background px-2.5 py-1.5 text-left text-caption text-foreground transition-colors hover:bg-canvas-soft-2",
                            lit && "border-hairline-strong bg-canvas-soft-2"
                          )}
                        >
                          <span className="flex size-5 flex-none items-center justify-center rounded-full border bg-card font-mono text-micro text-muted-foreground">
                            {letterOf(optionIndex)}
                          </span>
                          <span className="min-w-0 flex-1 break-words">
                            {label}
                            {description ? (
                              <span className="mt-0.5 block text-micro text-muted-foreground">
                                {description}
                              </span>
                            ) : null}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
                {showTextInput ? (
                  <div className="mt-2 flex items-center gap-2">
                    <label htmlFor={inputId} className="flex-none text-micro text-muted-foreground">
                      {t("chat.askUser.customLabel")}
                    </label>
                    <input
                      id={inputId}
                      value={draft.text}
                      onChange={(event) => setQuestionText(questionIndex, event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          if (isMultiQuestion) {
                            submitAll();
                          } else {
                            submitCustom(questionIndex);
                          }
                        }
                      }}
                      placeholder={t("chat.askUser.customPlaceholder")}
                      aria-label={`${question.question} ${t("chat.askUser.customLabel")}`}
                      className="min-w-0 flex-1 rounded-xs border border-border bg-background px-2.5 py-1.5 text-caption text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-form-focus"
                    />
                    {!isMultiQuestion ? (
                      <button
                        type="button"
                        onClick={() => submitCustom(questionIndex)}
                        className="flex-none rounded-xs border border-border bg-card px-2.5 py-1.5 text-caption text-foreground transition-colors hover:bg-canvas-soft-2"
                      >
                        {t("chat.askUser.submit")}
                      </button>
                    ) : null}
                  </div>
                ) : null}
                {isMissing ? (
                  <p className="mt-2 text-micro text-destructive">{t("chat.askUser.required")}</p>
                ) : null}
              </section>
            );
          })}
          {isMultiQuestion ? (
            <div className="flex items-center justify-between gap-3">
              <p className="min-w-0 text-micro text-muted-foreground">
                {missing.size > 0
                  ? t("chat.askUser.missing", { count: missing.size })
                  : t("chat.askUser.structuredHint")}
              </p>
              <button
                type="button"
                onClick={submitAll}
                className="flex-none rounded-pill bg-primary px-3 py-1.5 text-button-md text-primary-foreground transition-opacity hover:opacity-90"
              >
                {t("chat.askUser.submitAll")}
              </button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
