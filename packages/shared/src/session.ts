import { z } from "zod";

import { accessModeSchema } from "./access-mode";

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
  /** Set on sessions driven by a Feishu chat (one session per chat). */
  feishuChatId: z.string().min(1).optional(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type Session = z.infer<typeof sessionSchema>;

export const sessionInputSchema = z.object({
  projectId: z.string().min(1).nullable().optional(),
  title: z.string().min(1).optional(),
  providerId: z.string().min(1).optional(),
  accessMode: accessModeSchema.default("approval")
});
export type SessionInput = z.infer<typeof sessionInputSchema>;

export const sessionUpdateSchema = z.object({
  title: z.string().min(1).optional(),
  providerId: z.string().min(1).nullable().optional(),
  accessMode: accessModeSchema.optional()
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
