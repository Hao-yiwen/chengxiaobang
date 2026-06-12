import { z } from "zod";

import { accessModeSchema, type AccessMode } from "./access-mode";
import { reasoningModeSchema } from "./model";
import { askUserAnswerSchema, planStepSchema } from "./plan";

export const runStatusSchema = z.enum(["running", "completed", "aborted", "failed"]);
export type RunStatus = z.infer<typeof runStatusSchema>;

export const runRecordSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  status: runStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string()
});
export type RunRecord = z.infer<typeof runRecordSchema>;

export const runRequestSchema = z.object({
  sessionId: z.string().min(1).optional(),
  projectId: z.string().min(1).nullable().optional(),
  prompt: z.string().min(1),
  providerId: z.string().min(1).optional(),
  accessMode: accessModeSchema.default("approval"),
  /** run 级开关：先计划、经用户确认、再动手。 */
  planMode: z.boolean().default(false),
  /** run 级模型覆盖；解析优先级 run > session > provider 默认。 */
  model: z.string().min(1).optional(),
  /** run 级推理覆盖；解析优先级 run > session > provider 默认。 */
  reasoningMode: reasoningModeSchema.optional()
});
export type RunRequest = z.input<typeof runRequestSchema> & { accessMode: AccessMode };

export const approvalDecisionSchema = z.object({
  approved: z.boolean(),
  editedSteps: z.array(planStepSchema).optional(),
  answer: askUserAnswerSchema.optional()
});
export type ApprovalDecision = z.infer<typeof approvalDecisionSchema>;
