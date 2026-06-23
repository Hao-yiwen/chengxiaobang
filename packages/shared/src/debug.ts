import { z } from "zod";

import { accessModeSchema } from "./access-mode";
import { messageSchema } from "./message";
import { projectSchema } from "./project";
import { runRecordSchema } from "./run";
import { sessionSchema } from "./session";
import { modelVisibleSkillSchema } from "./skill";
import { toolCallSchema } from "./tool";
import { toolDeferPolicySchema, toolDisplayCategorySchema } from "./tool";

export const agentDebugToolSchema = z.object({
  name: z.string().min(1),
  label: z.string().min(1).optional(),
  description: z.string().optional(),
  requiresApproval: z.boolean(),
  readOnly: z.boolean().optional(),
  mutating: z.boolean().optional(),
  destructive: z.boolean().optional(),
  concurrencySafe: z.boolean().optional(),
  searchHint: z.string().optional(),
  deferPolicy: toolDeferPolicySchema.optional(),
  maxInlineResultChars: z.number().int().positive().optional(),
  category: toolDisplayCategorySchema.optional()
});
export type AgentDebugTool = z.infer<typeof agentDebugToolSchema>;

export const sessionDebugContextSchema = z.object({
  session: sessionSchema,
  project: projectSchema.nullable(),
  workspacePath: z.string().min(1),
  accessMode: accessModeSchema,
  planMode: z.boolean(),
  viaFeishu: z.boolean(),
  compactedUpToMessageId: z.string().min(1).optional(),
  systemPrompt: z.string(),
  modelMessages: z.array(z.unknown()),
  messages: z.array(messageSchema),
  runs: z.array(runRecordSchema),
  toolCalls: z.array(toolCallSchema),
  planSnapshot: z
    .object({
      toolCallId: z.string().min(1),
      title: z.string().min(1),
      markdown: z.string().min(1),
      confirmed: z.boolean(),
      finished: z.boolean()
    })
    .optional(),
  skills: z.array(modelVisibleSkillSchema),
  availableTools: z.array(agentDebugToolSchema),
  generatedAt: z.string()
});
export type SessionDebugContext = z.infer<typeof sessionDebugContextSchema>;
