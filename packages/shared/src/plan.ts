import { z } from "zod";

import type { ToolCall } from "./tool";

/** 计划中的一个步骤。 */
export const planStepSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  status: z.enum(["pending", "in_progress", "completed", "skipped"]).default("pending"),
  detail: z.string().optional()
});
export type PlanStep = z.infer<typeof planStepSchema>;

export const proposePlanArgsSchema = z.object({
  title: z.string().min(1),
  steps: z.array(planStepSchema).min(1).max(20)
});
export type ProposePlanArgs = z.infer<typeof proposePlanArgsSchema>;

export const updatePlanArgsSchema = z.object({
  stepId: z.string().min(1),
  status: z.enum(["in_progress", "completed", "skipped"]),
  note: z.string().optional()
});
export type UpdatePlanArgs = z.infer<typeof updatePlanArgsSchema>;

export const askUserAnswerSchema = z
  .object({
    optionLabel: z.string().min(1).optional(),
    text: z.string().optional()
  })
  .refine((answer) => Boolean(answer.optionLabel) || Boolean(answer.text?.trim()), {
    message: "必须提供选项或文字回答"
  });
export type AskUserAnswer = z.infer<typeof askUserAnswerSchema>;

export const askUserArgsSchema = z.object({
  question: z.string().min(1),
  options: z.array(z.string().min(1)).max(4).optional(),
  allowFreeText: z.boolean().default(true)
});
export type AskUserArgs = z.infer<typeof askUserArgsSchema>;

export const btwArgsSchema = z.object({
  note: z.string().min(1),
  suggestion: z.string().min(1).optional()
});
export type BtwArgs = z.infer<typeof btwArgsSchema>;

export const useSkillArgsSchema = z.object({
  name: z.string().min(1)
});
export type UseSkillArgs = z.infer<typeof useSkillArgsSchema>;

export interface PlanState {
  /** 锚点 propose_plan 的 toolCallId。 */
  toolCallId: string;
  title: string;
  steps: PlanStep[];
  /** 是否经用户确认。 */
  confirmed: boolean;
  /** 所有步骤均为 completed/skipped。 */
  finished: boolean;
}

/**
 * 从 append-only 的工具调用记录推导计划状态：
 * - 最后一个 completed 的 propose_plan 是已确认锚点；
 * - 没有 completed 锚点时，回退到最后一个 propose_plan 草案；
 * - 锚点之后 completed 的 update_plan 按时间叠放到步骤上。
 */
export function derivePlanState(toolCalls: ToolCall[]): PlanState | undefined {
  const proposals = toolCalls
    .filter((toolCall) => toolCall.name === "propose_plan")
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  if (proposals.length === 0) {
    return undefined;
  }

  const anchor =
    [...proposals].reverse().find((toolCall) => toolCall.status === "completed") ??
    proposals[proposals.length - 1];
  const parsedArgs = proposePlanArgsSchema.safeParse(anchor.args);
  if (!parsedArgs.success) {
    console.warn("[plan] propose_plan 参数解析失败", {
      toolCallId: anchor.id,
      error: parsedArgs.error.message
    });
    return undefined;
  }

  const steps = parsedArgs.data.steps.map((step) => planStepSchema.parse(step));
  for (const toolCall of toolCalls
    .filter(
      (item) =>
        item.name === "update_plan" &&
        item.status === "completed" &&
        item.createdAt.localeCompare(anchor.createdAt) >= 0 &&
        item.id !== anchor.id
    )
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))) {
    const parsedUpdate = updatePlanArgsSchema.safeParse(toolCall.args);
    if (!parsedUpdate.success) {
      console.warn("[plan] update_plan 参数解析失败，已跳过", {
        toolCallId: toolCall.id,
        error: parsedUpdate.error.message
      });
      continue;
    }
    const step = steps.find((candidate) => candidate.id === parsedUpdate.data.stepId);
    if (step) {
      step.status = parsedUpdate.data.status;
    }
  }

  const confirmed = anchor.status === "completed";
  const finished =
    confirmed && steps.every((step) => step.status === "completed" || step.status === "skipped");
  return { toolCallId: anchor.id, title: parsedArgs.data.title, steps, confirmed, finished };
}
