import { z } from "zod";

import type { ToolCall } from "./tool";

/** 旧版计划中的一个步骤，仅用于历史会话和 editedSteps 兼容。 */
export const planStepSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  status: z.enum(["pending", "in_progress", "completed", "skipped"]).default("pending"),
  detail: z.string().optional()
});
export type PlanStep = z.infer<typeof planStepSchema>;

const legacyProposePlanArgsSchema = z.object({
  title: z.string().min(1),
  steps: z.array(planStepSchema).min(1).max(20)
});
type LegacyProposePlanArgs = z.infer<typeof legacyProposePlanArgsSchema>;

const proposedPlanMarkdownSchema = z
  .string()
  .transform((value) => normalizeProposedPlanMarkdown(value))
  .refine((value) => value.length > 0, { message: "计划内容不能为空" });

export const proposePlanArgsSchema = z.preprocess(
  (value) => {
    const legacy = legacyProposePlanArgsSchema.safeParse(value);
    if (legacy.success) {
      return { markdown: legacyPlanToMarkdown(legacy.data) };
    }
    return value;
  },
  z.object({
    markdown: proposedPlanMarkdownSchema
  })
);
export type ProposePlanArgs = z.infer<typeof proposePlanArgsSchema>;

/** 旧版执行进度工具参数，仅用于历史数据解析和工具名兼容。 */
export const updatePlanArgsSchema = z.object({
  stepId: z.string().min(1),
  status: z.enum(["in_progress", "completed", "skipped"]),
  note: z.string().optional()
});
export type UpdatePlanArgs = z.infer<typeof updatePlanArgsSchema>;

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

export const askUserQuestionSchema = z.object({
  id: z.string().min(1).optional(),
  question: z.string().min(1),
  options: z.array(z.string().min(1)).max(ASK_USER_MAX_OPTIONS).optional(),
  allowFreeText: z.boolean().default(true)
});
export type AskUserQuestion = z.infer<typeof askUserQuestionSchema>;

export const askUserArgsSchema = z.object({
  questions: z.array(askUserQuestionSchema).min(1).max(ASK_USER_MAX_QUESTIONS)
});
export type AskUserArgs = z.infer<typeof askUserArgsSchema>;

export function askUserAnswerItemText(answer: AskUserAnswerItem): string {
  return answer.text?.trim() || answer.optionLabel || "";
}

export function askUserAnswerText(answer: AskUserAnswer): string {
  return answer.answers.map(askUserAnswerItemText).filter(Boolean).join("\n");
}

export const useSkillArgsSchema = z.object({
  name: z.string().min(1)
});
export type UseSkillArgs = z.infer<typeof useSkillArgsSchema>;

export interface PlanState {
  /** 锚点 propose_plan 的 toolCallId。 */
  toolCallId: string;
  title: string;
  markdown: string;
  /** 是否经用户确认。 */
  confirmed: boolean;
  /** 新计划不再跟踪执行进度，确认即视为计划阶段结束。 */
  finished: boolean;
}

/**
 * 从 append-only 的工具调用记录推导最新计划文本：
 * - 最新的 propose_plan 是当前计划锚点；
 * - 新版参数直接读取 markdown；
 * - 旧版 {title, steps} 自动转换成 Markdown 展示；
 * - update_plan 仅为历史记录，不再叠加或影响计划状态。
 */
export function derivePlanState(toolCalls: ToolCall[]): PlanState | undefined {
  const proposals = toolCalls
    .filter((toolCall) => toolCall.name === "propose_plan")
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  if (proposals.length === 0) {
    return undefined;
  }

  const anchor = proposals[proposals.length - 1];
  const parsedArgs = proposePlanArgsSchema.safeParse(anchor.args);
  if (!parsedArgs.success) {
    console.warn("[plan] propose_plan 参数解析失败", {
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

function legacyPlanToMarkdown(plan: LegacyProposePlanArgs): string {
  const keyChanges = plan.steps.map((step) => `- ${step.title}`).join("\n");
  return [
    `# ${plan.title}`,
    "",
    "## Summary",
    "该计划由旧版步骤清单自动转换，用于兼容历史会话展示。",
    "",
    "## Key Changes",
    keyChanges,
    "",
    "## Test Plan",
    "- 按计划完成后运行相关验证。",
    "",
    "## Assumptions",
    "- 旧版计划未保存更详细的分节说明。"
  ].join("\n");
}

function truncateTitle(title: string): string {
  return title.length > 60 ? `${title.slice(0, 57)}...` : title;
}
