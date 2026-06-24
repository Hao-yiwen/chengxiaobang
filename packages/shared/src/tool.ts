import { z } from "zod";

export const toolNameSchema = z.enum([
  "Read",
  "Write",
  "Edit",
  "Glob",
  "Grep",
  "Shell",
  "WebFetch",
  "WebSearch",
  "ToolSearch",
  "ExitPlanMode",
  "AskUserQuestion",
  "Skill",
  "TodoRead",
  "TodoWrite",
  "Schedule",
  "Memory",
  "OcrExtractText"
]);
export type ToolName = z.infer<typeof toolNameSchema>;

export const toolDisplayCategorySchema = z.enum([
  "read",
  "edit",
  "search",
  "command",
  "web",
  "artifact",
  "plan",
  "schedule",
  "memory",
  "other"
]);
export type ToolDisplayCategory = z.infer<typeof toolDisplayCategorySchema>;

export const toolDeferPolicySchema = z.enum(["eager", "deferred"]);
export type ToolDeferPolicy = z.infer<typeof toolDeferPolicySchema>;

export interface ToolMetadata {
  readOnly: boolean;
  mutating: boolean;
  destructive: boolean;
  concurrencySafe: boolean;
  requiresApproval: boolean;
  searchHint: string;
  deferPolicy: ToolDeferPolicy;
  maxInlineResultChars: number;
  category: ToolDisplayCategory;
  planDraftVisible: boolean;
}

export const DEFAULT_TOOL_MAX_INLINE_RESULT_CHARS = 24 * 1024;

const readTool = (
  searchHint: string,
  category: ToolDisplayCategory,
  overrides: Partial<ToolMetadata> = {}
): ToolMetadata => ({
  readOnly: true,
  mutating: false,
  destructive: false,
  concurrencySafe: true,
  requiresApproval: false,
  searchHint,
  deferPolicy: "eager",
  maxInlineResultChars: DEFAULT_TOOL_MAX_INLINE_RESULT_CHARS,
  category,
  planDraftVisible: true,
  ...overrides
});

const mutatingTool = (
  searchHint: string,
  category: ToolDisplayCategory,
  overrides: Partial<ToolMetadata> = {}
): ToolMetadata => ({
  readOnly: false,
  mutating: true,
  destructive: false,
  concurrencySafe: false,
  requiresApproval: true,
  searchHint,
  deferPolicy: "eager",
  maxInlineResultChars: DEFAULT_TOOL_MAX_INLINE_RESULT_CHARS,
  category,
  planDraftVisible: false,
  ...overrides
});

export const builtinToolMetadata = {
  Read: readTool("读取文本文件、查看文件行范围、检查当前内容", "read"),
  Write: mutatingTool("创建或覆盖文本文件、保存生成内容", "edit", {
    destructive: true
  }),
  Edit: mutatingTool("按精确字符串替换文本文件内容、生成 diff", "edit"),
  Glob: readTool("按 glob 模式查找文件路径", "search"),
  Grep: readTool("按文本或正则搜索文件内容", "search"),
  Shell: mutatingTool("执行本机命令、查询或终止后台命令", "command", {
    requiresApproval: false,
    concurrencySafe: false
  }),
  WebFetch: readTool("抓取网页 URL 并提取内容", "web"),
  WebSearch: readTool("通过 Tavily 搜索互联网结果", "web"),
  ToolSearch: readTool("查找并加载 deferred 工具、MCP 工具或重型工具", "search"),
  ExitPlanMode: readTool("提交计划并等待用户确认", "plan"),
  AskUserQuestion: readTool("向用户提出需要回答的问题", "plan", {
    concurrencySafe: false
  }),
  Skill: readTool("加载技能说明和工作流指导", "plan"),
  TodoRead: readTool("读取当前运行的 Todo 进度", "plan"),
  TodoWrite: mutatingTool("更新当前运行的 Todo 进度", "plan", {
    requiresApproval: false,
    concurrencySafe: true
  }),
  Schedule: mutatingTool("创建、查看或取消后台定时任务", "schedule", {
    requiresApproval: false
  }),
  Memory: mutatingTool("读取、创建、更新、删除长期记忆文件", "memory", {
    requiresApproval: false,
    planDraftVisible: true
  }),
  OcrExtractText: readTool("对图片或 PDF 执行 OCR 提取文字", "read", {
    deferPolicy: "deferred"
  })
} satisfies Record<ToolName, ToolMetadata>;

export function isKnownToolName(name: string): name is ToolName {
  return toolNameSchema.safeParse(name).success;
}

export function isDeferredToolName(name: string): boolean {
  return toolMetadata(name).deferPolicy === "deferred";
}

export function toolMetadata(name: string): ToolMetadata {
  if (isKnownToolName(name)) {
    return builtinToolMetadata[name];
  }
  if (name.startsWith("mcp__")) {
    return {
      readOnly: false,
      mutating: true,
      destructive: false,
      concurrencySafe: false,
      requiresApproval: true,
      searchHint: "外部 MCP 工具，可能访问第三方服务或产生副作用",
      deferPolicy: "deferred",
      maxInlineResultChars: DEFAULT_TOOL_MAX_INLINE_RESULT_CHARS,
      category: "other",
      planDraftVisible: false
    };
  }
  return {
    readOnly: false,
    mutating: true,
    destructive: false,
    concurrencySafe: false,
    requiresApproval: true,
    searchHint: "未知工具",
    deferPolicy: "deferred",
    maxInlineResultChars: DEFAULT_TOOL_MAX_INLINE_RESULT_CHARS,
    category: "other",
    planDraftVisible: false
  };
}

export function toolDisplayCategory(name: string): ToolDisplayCategory {
  return toolMetadata(name).category;
}

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

export const fileChangeOperationSchema = z.enum(["write", "edit", "mixed"]);
export type FileChangeOperation = z.infer<typeof fileChangeOperationSchema>;

export const fileChangeSchema = z.object({
  path: z.string().min(1),
  operation: fileChangeOperationSchema,
  patch: z.string(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  toolCallIds: z.array(z.string().min(1)).min(1),
  truncated: z.boolean().optional()
});
export type FileChange = z.infer<typeof fileChangeSchema>;

export const toolCallPreviewSchema = z.object({
  kind: z.literal("text_diff"),
  path: z.string().min(1),
  oldText: z.string(),
  newText: z.string()
});
export type ToolCallPreview = z.infer<typeof toolCallPreviewSchema>;

export const toolCallSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  // 模型可能请求未知工具名，这类调用仍要持久化/渲染为失败，而不是伪装成 shell。
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
  preview: toolCallPreviewSchema.optional(),
  fileChange: fileChangeSchema.optional(),
  approval: toolCallApprovalSchema.optional(),
  /** 工具真正开始执行的时间（审批通过后），ISO 时间戳。 */
  startedAt: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type ToolCall = z.infer<typeof toolCallSchema>;

export const toolActivityPreviewToolNames = ["Write", "Edit"] as const;
export type ToolActivityPreviewToolName = (typeof toolActivityPreviewToolNames)[number];

export function isToolActivityPreviewToolName(
  name: string | undefined
): name is ToolActivityPreviewToolName {
  return name === "Write" || name === "Edit";
}

export const toolActivityArgsPreviewSchema = z
  .object({
    file_path: z.string().min(1).optional()
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
