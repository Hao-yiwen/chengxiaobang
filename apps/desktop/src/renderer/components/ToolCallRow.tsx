import {
  CaretDownIcon as ChevronDown,
  CheckIcon as Check,
  ChatCircleDotsIcon as ChatCircleDots,
  CircleNotchIcon as Loader2,
  XIcon as X
} from "@phosphor-icons/react";
import { useState } from "react";
import {
  askUserAnswerItemText,
  askUserAnswerSchema,
  askUserArgsSchema,
  type AskUserAnswerItem,
  type ToolCall
} from "@chengxiaobang/shared";
import { ToolCallLine } from "@/components/ToolCallLine";
import type { ArtifactKind } from "@/lib/artifact";
import { cn } from "@/lib/utils";

interface ToolCallRowProps {
  toolCall: ToolCall;
  onOpenFile?: (path: string, kind: ArtifactKind) => void;
}

type AskUserReceiptQuestion = {
  id?: string;
  question: string;
};

/** 时间线中的单个工具调用：AskUserQuestion、Skill 各自用专属轻量形态。 */
export function ToolCallRow({ toolCall, onOpenFile }: ToolCallRowProps) {
  if (toolCall.name === "AskUserQuestion") {
    return <AskUserReceipt toolCall={toolCall} />;
  }

  if (toolCall.name === "Skill") {
    return <UseSkillChip toolCall={toolCall} />;
  }

  return (
    <div className="mb-4 max-w-full self-stretch">
      <ToolCallLine toolCall={toolCall} onOpenFile={onOpenFile} />
    </div>
  );
}

function textArg(toolCall: ToolCall, key: string): string | undefined {
  const value = toolCall.args[key];
  return typeof value === "string" ? value : undefined;
}

function ToolStatusIcon({ toolCall }: { toolCall: ToolCall }) {
  const isRunning =
    toolCall.status === "running" ||
    toolCall.status === "pending_approval" ||
    toolCall.status === "pending_smart_approval";
  const isError = toolCall.status === "failed" || toolCall.status === "rejected";

  if (isRunning) {
    return <Loader2 className="size-3.5 flex-none animate-spin text-muted-foreground" />;
  }
  if (isError) {
    return <X className="size-3.5 flex-none text-muted-foreground" />;
  }
  return <Check className="size-3.5 flex-none text-muted-foreground" />;
}

function AskUserReceipt({ toolCall }: { toolCall: ToolCall }) {
  const [open, setOpen] = useState(false);
  const questions = parseAskUserQuestions(toolCall);
  const answers = parseAskUserAnswers(toolCall);
  const rows = questions.map((question, index) => ({
    question,
    answer: answers[index]
  }));
  const summary = askUserSummary(toolCall, questions, answers);

  return (
    <div className="mb-4 max-w-full self-stretch">
      <button
        type="button"
        className="flex max-w-full items-center gap-1.5 text-left text-caption text-muted-foreground transition-colors hover:text-foreground"
        aria-expanded={open}
        onClick={() => {
          const nextOpen = !open;
          console.info("[ToolCallRow] 切换 AskUserQuestion 历史详情", {
            toolCallId: toolCall.id,
            open: nextOpen,
            questionCount: questions.length
          });
          setOpen(nextOpen);
        }}
      >
        <ChatCircleDots className="size-3.5 flex-none" />
        <span className="min-w-0 truncate">{summary}</span>
        <ToolStatusIcon toolCall={toolCall} />
        <ChevronDown
          className={cn("size-3.5 flex-none transition-transform", open && "rotate-180")}
        />
      </button>
      {open ? (
        <div className="ml-5 mt-2 space-y-2 text-caption leading-relaxed text-muted-foreground">
          {rows.map((row, index) => (
            <div key={`${index}-${row.question.id ?? row.question.question}`} className="min-w-0">
              <p className="break-words text-foreground">
                问：{row.question.question}
              </p>
              <p className="mt-0.5 break-words">
                答：{answerTextFor(toolCall, row.answer)}
              </p>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function parseAskUserQuestions(toolCall: ToolCall): AskUserReceiptQuestion[] {
  const parsed = askUserArgsSchema.safeParse(toolCall.args);
  if (parsed.success) {
    return parsed.data.questions;
  }
  console.warn("[ToolCallRow] AskUserQuestion 历史参数解析失败", {
    toolCallId: toolCall.id,
    issues: parsed.error.issues
  });
  return [{ question: "问题参数解析失败" }];
}

function parseAskUserAnswers(toolCall: ToolCall): AskUserAnswerItem[] {
  const parsed = askUserAnswerSchema.safeParse(toolCall.args.answer);
  if (parsed.success) {
    return parsed.data.answers;
  }
  return [];
}

function askUserSummary(
  toolCall: ToolCall,
  questions: AskUserReceiptQuestion[],
  answers: AskUserAnswerItem[]
): string {
  if (toolCall.status === "rejected") {
    return questions.length > 1
      ? `已跳过 ${questions.length} 个问题`
      : `已跳过：${questions[0]?.question ?? "问题"}`;
  }
  if (questions.length === 1) {
    const answer = answers[0];
    const text = answer ? askUserAnswerItemText(answer) : answerTextFor(toolCall, undefined);
    return `${questions[0]?.question ?? "问题"}：${text}`;
  }
  const answered = answers.length;
  return answered > 0
    ? `已回答 ${answered}/${questions.length} 个问题`
    : `向你确认了 ${questions.length} 个问题`;
}

function answerTextFor(toolCall: ToolCall, answer: AskUserAnswerItem | undefined): string {
  if (answer) {
    return askUserAnswerItemText(answer);
  }
  if (toolCall.status === "rejected") {
    return "用户跳过了该问题";
  }
  if (
    toolCall.status === "pending_approval" ||
    toolCall.status === "pending_smart_approval" ||
    toolCall.status === "running"
  ) {
    return "问题未回答（运行已结束）";
  }
  return "无回答";
}

function UseSkillChip({ toolCall }: { toolCall: ToolCall }) {
  const skillName = textArg(toolCall, "skill") ?? "unknown";
  const failed = toolCall.status === "failed";
  const label =
    toolCall.status === "running" ||
    toolCall.status === "pending_approval" ||
    toolCall.status === "pending_smart_approval"
      ? "正在加载技能"
      : failed
        ? "加载技能失败"
        : "已加载技能";

  return (
    <div className="mb-4 max-w-full self-stretch">
      <div className="flex min-w-0 items-center gap-1.5 text-caption text-muted-foreground">
        <ToolStatusIcon toolCall={toolCall} />
        <span className="min-w-0 truncate">
          {label} {skillName}
        </span>
      </div>
      {failed && toolCall.result ? (
        <pre className="mt-1 max-h-[220px] overflow-auto whitespace-pre-wrap break-words rounded-sm bg-muted/50 px-3 py-2 font-mono text-micro leading-relaxed text-muted-foreground">
          {toolCall.result}
        </pre>
      ) : null}
    </div>
  );
}
