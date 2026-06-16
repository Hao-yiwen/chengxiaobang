import { z } from "zod";

export const messageRoleSchema = z.enum(["user", "assistant", "system", "tool"]);
export type MessageRole = z.infer<typeof messageRoleSchema>;

export const messageFeedbackSchema = z.enum(["up", "down"]);
export type MessageFeedback = z.infer<typeof messageFeedbackSchema>;

export const messageAttachmentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.string().min(1),
  mimeType: z.string().min(1).optional(),
  size: z.number().int().nonnegative(),
  path: z.string().min(1)
});
export type MessageAttachment = z.infer<typeof messageAttachmentSchema>;

export const messageSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  role: messageRoleSchema,
  /** Special message kinds; a /compact summary renders as a system-style card. */
  kind: z.enum(["compaction_summary"]).optional(),
  content: z.string(),
  /** 用户可见的附件快照；模型实际上下文仍由后端 payload 回放。 */
  attachments: z.array(messageAttachmentSchema).default([]),
  /** The model's reasoning ("深度思考") that preceded this assistant message. */
  reasoning: z.string().optional(),
  /** How long that reasoning took, in milliseconds. */
  reasoningMs: z.number().int().nonnegative().optional(),
  /** Model start -> answer complete for this turn, in milliseconds. */
  durationMs: z.number().int().nonnegative().optional(),
  /** 用户对助手回复的本地反馈，后续可作为上传服务端的数据源。 */
  feedback: messageFeedbackSchema.optional(),
  createdAt: z.string()
});
export type Message = Omit<z.infer<typeof messageSchema>, "attachments"> & {
  attachments?: MessageAttachment[];
};

export const messageFeedbackUpdateSchema = z.object({
  feedback: messageFeedbackSchema.nullable()
});
export type MessageFeedbackUpdate = z.infer<typeof messageFeedbackUpdateSchema>;
