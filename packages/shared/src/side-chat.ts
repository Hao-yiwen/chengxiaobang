import { z } from "zod";

import { messageSchema } from "./message";
import { runRecordSchema } from "./run";
import { sessionSchema } from "./session";
import { toolCallSchema } from "./tool";

export const sideChatSummarySchema = z.object({
  anchorMessageId: z.string().min(1),
  session: sessionSchema,
  userMessageCount: z.number().int().nonnegative().default(0),
  updatedAt: z.string()
});
export type SideChatSummary = z.infer<typeof sideChatSummarySchema>;

export const sideChatDetailSchema = z.object({
  session: sessionSchema.optional(),
  messages: z.array(messageSchema),
  runs: z.array(runRecordSchema),
  toolCalls: z.array(toolCallSchema)
});
export type SideChatDetail = z.infer<typeof sideChatDetailSchema>;
