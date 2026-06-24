import { z } from "zod";

import type { ToolCall } from "./tool";

/** 计划步骤只保留给审批 payload 中的 editedSteps 类型；当前公开工具不再使用步骤清单参数。 */
export const planStepSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  status: z.enum(["pending", "in_progress", "completed", "skipped"]).default("pending"),
  detail: z.string().optional()
});
export type PlanStep = z.infer<typeof planStepSchema>;

const proposedPlanMarkdownSchema = z
  .string()
  .transform((value) => normalizeProposedPlanMarkdown(value))
  .refine((value) => value.length > 0, { message: "计划内容不能为空" });

export const proposePlanArgsSchema = z
  .object({
    plan: proposedPlanMarkdownSchema,
    allowedPrompts: z
      .array(
        z.object({
          tool: z.literal("Shell"),
          prompt: z.string().min(1)
        })
      )
      .optional()
  })
  .transform((value) => ({
    ...value,
    markdown: value.plan
  }));
export type ProposePlanArgs = z.infer<typeof proposePlanArgsSchema>;

const ASK_USER_MAX_QUESTIONS = 4;
const ASK_USER_MAX_OPTIONS = 4;

export const askUserAnswerItemSchema = z
  .object({
    id: z.string().min(1).optional(),
    question: z.string().min(1).optional(),
    optionLabel: z.string().min(1).optional(),
    text: z.string().optional()
  })
  .refine((answer) => Boolean(answer.optionLabel) || Boolean(answer.text?.trim()), {
    message: "必须提供选项或文字回答"
  });
export type AskUserAnswerItem = z.infer<typeof askUserAnswerItemSchema>;

export const askUserAnswerSchema = z.object({
  answers: z.array(askUserAnswerItemSchema).min(1).max(ASK_USER_MAX_QUESTIONS)
});
export type AskUserAnswer = z.infer<typeof askUserAnswerSchema>;

export const askUserQuestionOptionSchema = z.union([
  z.string().min(1),
  z.object({
    label: z.string().min(1),
    description: z.string().optional()
  })
]);
export type AskUserQuestionOption = z.infer<typeof askUserQuestionOptionSchema>;

export const askUserQuestionSchema = z.object({
  id: z.string().min(1).optional(),
  header: z.string().min(1).optional(),
  question: z.string().min(1),
  options: z.array(askUserQuestionOptionSchema).min(2).max(ASK_USER_MAX_OPTIONS),
  multiSelect: z.boolean().optional()
});
export type AskUserQuestion = z.infer<typeof askUserQuestionSchema>;

export const askUserArgsSchema = z.object({
  questions: z.array(askUserQuestionSchema).min(1).max(ASK_USER_MAX_QUESTIONS),
  answers: z.record(z.string(), z.string()).optional(),
  annotations: z
    .record(
      z.string(),
      z.object({
        preview: z.string().optional(),
        notes: z.string().optional()
      })
    )
    .optional(),
  metadata: z
    .object({
      source: z.string().optional()
    })
    .optional()
});
export type AskUserArgs = z.infer<typeof askUserArgsSchema>;

export function askUserAnswerItemText(answer: AskUserAnswerItem): string {
  return answer.text?.trim() || answer.optionLabel || "";
}

export function askUserAnswerText(answer: AskUserAnswer): string {
  return answer.answers.map(askUserAnswerItemText).filter(Boolean).join("\n");
}

export const useSkillArgsSchema = z.object({
  skill: z.string().min(1),
  args: z.string().optional()
});
export type UseSkillArgs = z.infer<typeof useSkillArgsSchema>;

export interface PlanState {
  /** 锚点 ExitPlanMode 的 toolCallId。 */
  toolCallId: string;
  title: string;
  markdown: string;
  /** 是否经用户确认。 */
  confirmed: boolean;
  /** 确认即视为计划阶段结束。 */
  finished: boolean;
}

/** 从 append-only 工具调用记录推导最新计划文本。 */
export function derivePlanState(toolCalls: ToolCall[]): PlanState | undefined {
  const proposals = toolCalls
    .filter((toolCall) => toolCall.name === "ExitPlanMode")
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  if (proposals.length === 0) {
    return undefined;
  }

  const anchor = proposals[proposals.length - 1];
  const parsedArgs = proposePlanArgsSchema.safeParse(anchor.args);
  if (!parsedArgs.success) {
    console.warn("[plan] ExitPlanMode 参数解析失败", {
      toolCallId: anchor.id,
      error: parsedArgs.error.message
    });
    return undefined;
  }

  const markdown = parsedArgs.data.markdown;
  const confirmed = anchor.status === "completed";
  return {
    toolCallId: anchor.id,
    title: proposedPlanTitle(markdown),
    markdown,
    confirmed,
    finished: confirmed
  };
}

export function proposedPlanTitle(markdown: string): string {
  const normalized = normalizeProposedPlanMarkdown(markdown);
  const heading = normalized.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (heading) {
    return heading;
  }
  const firstLine = normalized
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  return firstLine ? truncateTitle(firstLine) : "计划";
}

export function normalizeProposedPlanMarkdown(markdown: string): string {
  return markdown
    .trim()
    .replace(/^<proposed_plan>\s*/i, "")
    .replace(/\s*<\/proposed_plan>$/i, "")
    .trim();
}

function truncateTitle(title: string): string {
  return title.length > 60 ? `${title.slice(0, 57)}...` : title;
}
