import { z } from "zod";

export const messageRoleSchema = z.enum(["user", "assistant", "system", "tool"]);
export type MessageRole = z.infer<typeof messageRoleSchema>;

export const messageSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  role: messageRoleSchema,
  /** Special message kinds; a /compact summary renders as a system-style card. */
  kind: z.enum(["compaction_summary"]).optional(),
  content: z.string(),
  /** The model's reasoning ("深度思考") that preceded this assistant message. */
  reasoning: z.string().optional(),
  /** How long that reasoning took, in milliseconds. */
  reasoningMs: z.number().int().nonnegative().optional(),
  /** Model start -> answer complete for this turn, in milliseconds. */
  durationMs: z.number().int().nonnegative().optional(),
  createdAt: z.string()
});
export type Message = z.infer<typeof messageSchema>;
