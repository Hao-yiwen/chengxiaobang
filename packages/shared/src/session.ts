import { z } from "zod";

import { DEFAULT_ACCESS_MODE, accessModeSchema } from "./access-mode";
import { reasoningModeSchema } from "./model";

export const sessionNoticeSchema = z.object({
  status: z.enum(["unread", "failed"]),
  runId: z.string().min(1),
  error: z.string().optional(),
  updatedAt: z.string()
});
export type SessionNotice = z.infer<typeof sessionNoticeSchema>;

export const sessionPendingActionSchema = z.object({
  kind: z.enum(["ask_user", "approval"]),
  runId: z.string().min(1),
  toolCallId: z.string().min(1),
  updatedAt: z.string()
});
export type SessionPendingAction = z.infer<typeof sessionPendingActionSchema>;

export const sessionSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1).nullable(),
  title: z.string().min(1),
  providerId: z.string().min(1).optional(),
  accessMode: accessModeSchema,
  /**
   * Set by /compact: messages up to and including this one are replaced by
   * the latest compaction summary when building model context.
   */
  compactedUpToMessageId: z.string().min(1).optional(),
  /** Set on forked sessions: the session this one branched from. */
  parentSessionId: z.string().min(1).optional(),
  /** The message (in the parent) the branch was created from. */
  forkMessageId: z.string().min(1).optional(),
  /** 派生会话内与父会话 forkMessageId 对应的复制消息，用于在时间线标记派生点。 */
  forkPointMessageId: z.string().min(1).optional(),
  /** Set on sessions driven by a Feishu chat (one session per chat). */
  feishuChatId: z.string().min(1).optional(),
  /** 微信联系人驱动的会话（一位联系人对应一个会话）。 */
  wechatChatId: z.string().min(1).optional(),
  /** 侧边会话绑定的主聊天消息；存在时不进入左侧会话列表。 */
  sideChatAnchorMessageId: z.string().min(1).optional(),
  /** 侧边会话所属主会话，用于运行时注入完整主会话历史。 */
  sideChatParentSessionId: z.string().min(1).optional(),
  /** 会话级模型记忆；为空时使用 provider.model。 */
  model: z.string().min(1).optional(),
  /** 会话级推理模式记忆；为空时不覆盖 provider/平台默认。 */
  reasoningMode: reasoningModeSchema.optional(),
  /** 置顶时间；存在即置顶，侧边栏置顶区按其降序排列。 */
  pinnedAt: z.string().optional(),
  lastViewedAt: z.string().optional(),
  notice: sessionNoticeSchema.optional(),
  pendingAction: sessionPendingActionSchema.optional(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type Session = z.infer<typeof sessionSchema>;

export const sessionSearchResultSchema = z.discriminatedUnion("matchType", [
  z.object({
    session: sessionSchema,
    matchType: z.literal("title")
  }),
  z.object({
    session: sessionSchema,
    matchType: z.literal("content"),
    messageId: z.string().min(1),
    role: z.enum(["user", "assistant"]),
    snippet: z.string()
  })
]);
export type SessionSearchResult = z.infer<typeof sessionSearchResultSchema>;

export const sessionInputSchema = z.object({
  projectId: z.string().min(1).nullable().optional(),
  title: z.string().min(1).optional(),
  providerId: z.string().min(1).optional(),
  accessMode: accessModeSchema.default(DEFAULT_ACCESS_MODE)
});
export type SessionInput = z.infer<typeof sessionInputSchema>;

export const sessionUpdateSchema = z.object({
  title: z.string().min(1).optional(),
  /** 手机绑定会话可后续绑定/更换项目文件夹；undefined 保留，null 解除绑定。 */
  projectId: z.string().min(1).nullable().optional(),
  providerId: z.string().min(1).nullable().optional(),
  accessMode: accessModeSchema.optional(),
  model: z.string().min(1).nullable().optional(),
  reasoningMode: reasoningModeSchema.nullable().optional(),
  /** 置顶开关：true 置顶、false 取消置顶（开关语义，非 nullable 的"显式清空"模式）。 */
  pinned: z.boolean().optional()
});
export type SessionUpdate = z.infer<typeof sessionUpdateSchema>;

/** Rewind a session: delete this message and everything after it. */
export const rewindRequestSchema = z.object({
  messageId: z.string().min(1)
});
export type RewindRequest = z.infer<typeof rewindRequestSchema>;

/** Fork a session from a message (inclusive). */
export const sessionForkInputSchema = z.object({
  messageId: z.string().min(1)
});
export type SessionForkInput = z.infer<typeof sessionForkInputSchema>;
