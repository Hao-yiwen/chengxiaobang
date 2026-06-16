import { z } from "zod";

import { accessModeSchema, type AccessMode } from "./access-mode";
import { messageAttachmentSchema } from "./message";
import { reasoningModeSchema, tokenUsageSchema } from "./model";
import { askUserAnswerSchema, planStepSchema } from "./plan";
import { providerKindSchema } from "./provider";
import { fileChangeSchema, toolCallSchema } from "./tool";

export const runStatusSchema = z.enum(["running", "completed", "aborted", "failed"]);
export type RunStatus = z.infer<typeof runStatusSchema>;

export const runImageAttachmentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  mimeType: z.string().regex(/^image\//),
  dataBase64: z.string().min(1),
  size: z.number().int().nonnegative()
});
export type RunImageAttachment = z.infer<typeof runImageAttachmentSchema>;

export const runRecordSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  status: runStatusSchema,
  providerId: z.string().min(1).optional(),
  providerKind: providerKindSchema.optional(),
  model: z.string().min(1).optional(),
  usage: tokenUsageSchema.optional(),
  error: z.string().optional(),
  fileChanges: z.array(fileChangeSchema).optional(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type RunRecord = z.infer<typeof runRecordSchema>;

export const runRequestSchema = z.object({
  sessionId: z.string().min(1).optional(),
  projectId: z.string().min(1).nullable().optional(),
  prompt: z.string().min(1),
  /** 用户消息气泡显示的原始文本；为空时后端回退到 prompt。 */
  displayContent: z.string().optional(),
  /** 用户消息气泡显示的附件快照；不参与模型原生图片输入。 */
  displayAttachments: z.array(messageAttachmentSchema).default([]),
  /** 客户端生成的请求归属 ID，用于全局事件流中过滤本次 run。 */
  clientRequestId: z.string().min(1).optional(),
  providerId: z.string().min(1).optional(),
  accessMode: accessModeSchema.default("approval"),
  /** run 级开关：先计划、经用户确认、再动手。 */
  planMode: z.boolean().default(false),
  /** run 级模型覆盖；解析优先级 run > session > provider 默认。 */
  model: z.string().min(1).optional(),
  /** run 级推理覆盖；解析优先级 run > session > provider 默认。 */
  reasoningMode: reasoningModeSchema.optional(),
  /** 由桌面端按模型能力准备好的原生图片附件；文本模型不应携带。 */
  attachments: z.array(runImageAttachmentSchema).default([])
});
export type RunRequest = z.input<typeof runRequestSchema> & { accessMode: AccessMode };

export const runSteeringRequestSchema = z.object({
  prompt: z.string().min(1),
  /** 用户消息气泡显示的原始文本；为空时后端回退到 prompt。 */
  displayContent: z.string().optional(),
  /** 用户消息气泡显示的附件快照；不参与模型原生图片输入。 */
  displayAttachments: z.array(messageAttachmentSchema).default([]),
  /** 客户端生成的请求归属 ID，用于日志和后续排查。 */
  clientRequestId: z.string().min(1).optional(),
  /** 由桌面端按当前 run 模型能力准备好的原生图片附件。 */
  attachments: z.array(runImageAttachmentSchema).default([])
});
export type RunSteeringRequest = z.input<typeof runSteeringRequestSchema>;

export const runStartResponseSchema = z.object({
  runId: z.string().min(1),
  sessionId: z.string().min(1),
  clientRequestId: z.string().min(1).optional(),
  providerId: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  reasoningMode: reasoningModeSchema.optional()
});
export type RunStartResponse = z.infer<typeof runStartResponseSchema>;

export const activeRunSnapshotSchema = z.object({
  run: runRecordSchema,
  toolCalls: z.array(toolCallSchema)
});
export type ActiveRunSnapshot = z.infer<typeof activeRunSnapshotSchema>;

export const approvalScopeSchema = z.enum(["project"]);
export type ApprovalScope = z.infer<typeof approvalScopeSchema>;

export const approvalDecisionSchema = z
  .object({
    approved: z.boolean(),
    /** 旧版步骤计划编辑字段；新版计划调整通过 answer.answers 传递。 */
    editedSteps: z.array(planStepSchema).optional(),
    answer: askUserAnswerSchema.optional(),
    /** approved=true 时可选择把同项目内同签名工具调用记为可信。 */
    approvalScope: approvalScopeSchema.optional()
  })
  .superRefine((decision, ctx) => {
    if (!decision.approved && decision.approvalScope) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["approvalScope"],
        message: "approvalScope 只能用于 approved=true 的审批决议"
      });
    }
  });
export type ApprovalDecision = z.infer<typeof approvalDecisionSchema>;
