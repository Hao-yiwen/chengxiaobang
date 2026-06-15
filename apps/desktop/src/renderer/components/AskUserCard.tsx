import {
  CaretLeftIcon as CaretLeft,
  CaretRightIcon as CaretRight,
  InfoIcon
} from "@phosphor-icons/react";
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
 * questions 固定 1..4 个；面板一次只展示当前题，右上角切题。
 */
export interface AskUserCardProps {
  toolCall: ToolCall;
  onDecide: (decision: ApprovalDecision) => void;
  /** 已回答的回执形态；不传则为活跃提问态。 */
  resolved?: AskUserAnswer;
}

type DraftAnswer = {
  optionIndex?: number;
  optionIndexes?: number[];
};
type LocalAnswer = AskUserAnswer | "skipped";
type ReceiptQuestion = Pick<AskUserQuestion, "question">;

function questionKey(question: AskUserQuestion, index: number): string {
  return question.id ?? `q${index + 1}`;
}

function optionLabel(option: AskUserQuestionOption): string {
  return typeof option === "string" ? option : option.label;
}

function optionDescription(option: AskUserQuestionOption): string | undefined {
  return typeof option === "string" ? undefined : option.description;
}

function questionHeader(question: AskUserQuestion, index: number, fallback: string): string {
  return question.header ?? fallback.replace("{{index}}", String(index + 1));
}

function selectedIndexes(question: AskUserQuestion, draft: DraftAnswer): number[] {
  if (question.multiSelect) {
    return draft.optionIndexes ?? [];
  }
  return draft.optionIndex === undefined ? [] : [draft.optionIndex];
}

function questionAnswer(question: AskUserQuestion, draft: DraftAnswer): AskUserAnswerItem | undefined {
  const selected = selectedIndexes(question, draft).filter(
    (optionIndex) => question.options[optionIndex] !== undefined
  );
  if (selected.length === 0) {
    return undefined;
  }
  return {
    ...(question.id ? { id: question.id } : {}),
    question: question.question,
    optionLabel: selected.map((optionIndex) => optionLabel(question.options[optionIndex]!)).join("、")
  };
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
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [highlight, setHighlight] = useState<number | null>(null);
  const [missing, setMissing] = useState<Set<number>>(() => new Set());
  const lockedRef = useRef(false);

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
  const currentQuestion = questions[currentQuestionIndex];

  useEffect(() => {
    if (questions.length > 0 && currentQuestionIndex >= questions.length) {
      setCurrentQuestionIndex(questions.length - 1);
      setHighlight(null);
    }
  }, [currentQuestionIndex, questions.length]);

  const draftFor = (index: number): DraftAnswer => drafts[index] ?? {};

  const clearMissing = (questionIndex: number) => {
    setMissing((current) => {
      const next = new Set(current);
      next.delete(questionIndex);
      return next;
    });
  };

  const setQuestionOption = (questionIndex: number, optionIndex: number) => {
    const question = questions[questionIndex];
    if (!question) {
      return;
    }
    setDrafts((current) => {
      const previous = current[questionIndex] ?? {};
      if (!question.multiSelect) {
        return {
          ...current,
          [questionIndex]: { optionIndex }
        };
      }
      const currentIndexes = new Set(previous.optionIndexes ?? []);
      if (currentIndexes.has(optionIndex)) {
        currentIndexes.delete(optionIndex);
      } else {
        currentIndexes.add(optionIndex);
      }
      return {
        ...current,
        [questionIndex]: {
          optionIndexes: [...currentIndexes].sort((left, right) => left - right)
        }
      };
    });
    clearMissing(questionIndex);
  };

  const goToQuestion = (index: number) => {
    const nextIndex = Math.min(Math.max(index, 0), questions.length - 1);
    if (nextIndex === currentQuestionIndex) {
      return;
    }
    console.debug("[AskUserCard] 切换结构化提问题目", {
      toolCallId: toolCall.id,
      runId: toolCall.runId,
      from: currentQuestionIndex,
      to: nextIndex
    });
    setCurrentQuestionIndex(nextIndex);
    setHighlight(null);
  };

  const buildAnswer = (): AskUserAnswer | undefined => {
    const answers: AskUserAnswerItem[] = [];
    const missingIndexes = new Set<number>();
    questions.forEach((question, index) => {
      const answer = questionAnswer(question, draftFor(index));
      if (answer) {
        answers.push(answer);
      } else {
        missingIndexes.add(index);
      }
    });
    if (missingIndexes.size > 0) {
      const firstMissing = [...missingIndexes][0] ?? 0;
      setMissing(missingIndexes);
      setCurrentQuestionIndex(firstMissing);
      setHighlight(null);
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

  const submitAnswers = () => {
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

  // 键盘只作用于当前题，避免隐藏题目被误选。
  useEffect(() => {
    if (!active || !currentQuestion) {
      return;
    }
    const options = currentQuestion.options;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) {
        return;
      }
      if (/^[1-9]$/.test(event.key) || /^[a-zA-Z]$/.test(event.key)) {
        const index = /^[1-9]$/.test(event.key)
          ? Number(event.key) - 1
          : event.key.toUpperCase().charCodeAt(0) - 65;
        if (index >= 0 && index < options.length) {
          event.preventDefault();
          setHighlight(index);
          setQuestionOption(currentQuestionIndex, index);
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
      if ((event.key === "Enter" || event.key === " ") && highlight !== null) {
        event.preventDefault();
        setQuestionOption(currentQuestionIndex, highlight);
      }
      if (event.key === "Enter" && highlight === null) {
        event.preventDefault();
        submitAnswers();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, currentQuestion, currentQuestionIndex, highlight]);

  const receipt = resolved ?? (answered === "skipped" ? undefined : (answered ?? undefined));
  if (resolved || answered !== null) {
    const receiptQuestions: ReceiptQuestion[] = questions.length > 0 ? questions : [{ question: "问题" }];
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

  const currentDraft = draftFor(currentQuestionIndex);
  const currentOptions = currentQuestion?.options ?? [];
  const currentMissing = missing.has(currentQuestionIndex);
  const currentSelectedIndexes = currentQuestion ? selectedIndexes(currentQuestion, currentDraft) : [];
  const pager = isMultiQuestion ? `${currentQuestionIndex + 1} / ${questions.length}` : "";
  const currentAnnotation =
    parsed.success && currentQuestion
      ? parsed.data.annotations?.[currentQuestion.id ?? questionKey(currentQuestion, currentQuestionIndex)]
      : undefined;

  return (
    <div className="mb-3 w-full self-start rounded-lg border bg-card p-3 shadow-subtle">
      {!parsed.success ? (
        <div className="rounded-sm border border-destructive/30 bg-destructive/5 px-3 py-2 text-caption text-destructive">
          {t("chat.askUser.invalidArgs")}
        </div>
      ) : currentQuestion ? (
        <>
          <div className="mb-3 flex items-start justify-between gap-3">
            <div className="min-w-0 flex flex-wrap items-center gap-2">
              <span className="flex-none rounded-pill border border-border bg-card px-2.5 py-0.5 text-caption text-muted-foreground shadow-hairline">
                {questionHeader(
                  currentQuestion,
                  currentQuestionIndex,
                  t("chat.askUser.defaultHeader", { index: currentQuestionIndex + 1 })
                )}
              </span>
              <h3 className="min-w-0 break-words text-body-sm-strong text-foreground">
                {currentQuestion.question}
              </h3>
            </div>
            {isMultiQuestion ? (
              <div className="ml-auto flex flex-none items-center gap-1.5 text-muted-foreground">
                <button
                  type="button"
                  onClick={() => goToQuestion(currentQuestionIndex - 1)}
                  disabled={currentQuestionIndex === 0}
                  aria-label={t("chat.askUser.previousQuestion")}
                  title={t("chat.askUser.previousQuestion")}
                  className="flex size-7 items-center justify-center rounded-full transition-colors hover:bg-canvas-soft-2 hover:text-foreground disabled:pointer-events-none disabled:opacity-35"
                >
                  <CaretLeft className="size-4" />
                </button>
                <span className="min-w-10 text-center text-caption font-medium tabular-nums">
                  {pager}
                </span>
                <button
                  type="button"
                  onClick={() => goToQuestion(currentQuestionIndex + 1)}
                  disabled={currentQuestionIndex === questions.length - 1}
                  aria-label={t("chat.askUser.nextQuestion")}
                  title={t("chat.askUser.nextQuestion")}
                  className="flex size-7 items-center justify-center rounded-full transition-colors hover:bg-canvas-soft-2 hover:text-foreground disabled:pointer-events-none disabled:opacity-35"
                >
                  <CaretRight className="size-4" />
                </button>
              </div>
            ) : null}
          </div>

          {currentAnnotation?.preview || currentAnnotation?.notes ? (
            <div className="mb-2 rounded-md border border-border bg-canvas-soft px-2.5 py-1.5 text-caption text-muted-foreground">
              {currentAnnotation.preview ? <p>{currentAnnotation.preview}</p> : null}
              {currentAnnotation.notes ? <p className="mt-1">{currentAnnotation.notes}</p> : null}
            </div>
          ) : null}

          <div className="space-y-1">
            {currentOptions.map((option, optionIndex) => {
              const label = optionLabel(option);
              const description = optionDescription(option);
              const selected = currentSelectedIndexes.includes(optionIndex);
              const lit = selected || highlight === optionIndex;
              return (
                <button
                  key={`${optionIndex}-${label}`}
                  type="button"
                  onClick={() => {
                    setHighlight(optionIndex);
                    setQuestionOption(currentQuestionIndex, optionIndex);
                  }}
                  className={cn(
                    "flex min-h-9 w-full items-center gap-2.5 rounded-md border border-transparent bg-background px-3 py-1.5 text-left text-body-sm text-foreground transition-colors hover:bg-canvas-soft-2",
                    lit && "bg-canvas-soft-2",
                    selected && "border-hairline-strong"
                  )}
                >
                  <span className="w-4 flex-none text-caption tabular-nums text-muted-foreground">
                    {optionIndex + 1}.
                  </span>
                  <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-4 gap-y-0.5">
                    <span className="break-words font-medium text-foreground">{label}</span>
                    {description ? (
                      <span className="break-words text-caption text-muted-foreground">{description}</span>
                    ) : null}
                  </span>
                </button>
              );
            })}
            {currentMissing ? (
              <p className="px-2.5 pt-1 text-caption text-destructive">{t("chat.askUser.required")}</p>
            ) : null}
          </div>
        </>
      ) : null}
      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="min-w-0 text-caption text-muted-foreground">
          {parsed.success ? (
            <span className="inline-flex min-w-0 items-center gap-2">
              <InfoIcon className="size-3.5 flex-none text-foreground" />
              <span className="truncate">
                {missing.size > 0
                  ? t("chat.askUser.missing", { count: missing.size })
                  : currentQuestion?.multiSelect
                    ? t("chat.askUser.multiSelectHint")
                    : t("chat.askUser.keyboardHint")}
              </span>
            </span>
          ) : null}
        </p>
        <div className="flex flex-none items-center gap-2">
          <button
            type="button"
            onClick={skip}
            className="h-8 rounded-md border border-border bg-card px-3.5 text-caption text-foreground shadow-hairline transition-colors hover:bg-canvas-soft-2"
          >
            {t("chat.askUser.skip")}
          </button>
          {parsed.success ? (
            <button
              type="button"
              onClick={submitAnswers}
              className="h-8 rounded-md bg-primary px-3.5 text-caption font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              {t("chat.askUser.continue")}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
