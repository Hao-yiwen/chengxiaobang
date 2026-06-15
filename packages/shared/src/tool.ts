import { z } from "zod";

export const toolNameSchema = z.enum([
  "Read",
  "Write",
  "Edit",
  "LS",
  "MakeDirectory",
  "Glob",
  "Grep",
  "Bash",
  "BashStatus",
  "BashCancel",
  "GitStatus",
  "GitDiff",
  "WebFetch",
  "WebSearch",
  "ExitPlanMode",
  "AskUserQuestion",
  "Skill",
  "TodoRead",
  "TodoWrite",
  "CreateSkill",
  "ScheduleCreate",
  "ScheduleList",
  "ScheduleCancel",
  "Memory",
  "OcrExtractText",
  "FeishuSendMessage"
]);
export type ToolName = z.infer<typeof toolNameSchema>;

/** 模型在 OpenAI-compatible tool_calls 中请求的一次工具调用。 */
export interface AssistantToolCall {
  id: string;
  name: string;
  /** 模型原样输出的 JSON 参数字符串。 */
  arguments: string;
}

export const smartApprovalVerdictSchema = z.enum(["allow", "deny", "ask_user"]);
export type SmartApprovalVerdict = z.infer<typeof smartApprovalVerdictSchema>;

export const smartApprovalRiskSchema = z.enum(["low", "medium", "high"]);
export type SmartApprovalRisk = z.infer<typeof smartApprovalRiskSchema>;

export const toolCallApprovalSchema = z.object({
  kind: z.literal("smart"),
  source: z.enum(["rule", "model", "fallback"]),
  verdict: smartApprovalVerdictSchema,
  risk: smartApprovalRiskSchema,
  score: z.number().min(0).max(1),
  reason: z.string().min(1),
  decidedAt: z.string().min(1),
  userDecision: z
    .object({
      approved: z.boolean(),
      decidedAt: z.string().min(1)
    })
    .optional()
});
export type ToolCallApproval = z.infer<typeof toolCallApprovalSchema>;

export const toolCallSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  // Plain string: the model can request unknown tool names, and those calls
  // still get persisted/rendered (as failed) instead of masquerading as shell.
  name: z.string().min(1),
  args: z.record(z.string(), z.unknown()),
  status: z.enum([
    "pending_smart_approval",
    "pending_approval",
    "running",
    "completed",
    "rejected",
    "failed"
  ]),
  result: z.string().optional(),
  approval: toolCallApprovalSchema.optional(),
  /** When execution actually began (post-approval), ISO timestamp. */
  startedAt: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type ToolCall = z.infer<typeof toolCallSchema>;

export const toolActivityArgsPreviewSchema = z
  .object({
    path: z.string().optional(),
    file_path: z.string().optional(),
    command: z.string().optional(),
    query: z.string().optional(),
    pattern: z.string().optional(),
    url: z.string().optional(),
    title: z.string().optional(),
    name: z.string().optional(),
    skill: z.string().optional()
  })
  .strict();
export type ToolActivityArgsPreview = z.infer<typeof toolActivityArgsPreviewSchema>;

export const toolActivitySchema = z.object({
  contentIndex: z.number().int().nonnegative(),
  toolCallId: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  argsPreview: toolActivityArgsPreviewSchema,
  updatedAt: z.string()
});
export type ToolActivity = z.infer<typeof toolActivitySchema>;
