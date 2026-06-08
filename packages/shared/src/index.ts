import { z } from "zod";

export const providerKindSchema = z.enum([
  "deepseek",
  "kimi",
  "openai-compatible",
  "custom"
]);
export type ProviderKind = z.infer<typeof providerKindSchema>;

export const accessModeSchema = z.enum(["approval", "full_access"]);
export type AccessMode = z.infer<typeof accessModeSchema>;

export const providerConfigSchema = z.object({
  id: z.string().min(1),
  kind: providerKindSchema,
  name: z.string().min(1),
  baseURL: z.string().url(),
  model: z.string().min(1),
  apiKeyRef: z.string().min(1).optional(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type ProviderConfig = z.infer<typeof providerConfigSchema>;

export const providerInputSchema = z.object({
  id: z.string().min(1).optional(),
  kind: providerKindSchema,
  name: z.string().min(1),
  baseURL: z.string().url(),
  model: z.string().min(1),
  apiKey: z.string().optional()
});
export type ProviderInput = z.infer<typeof providerInputSchema>;

export const projectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  path: z.string().min(1),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type Project = z.infer<typeof projectSchema>;

export const projectInputSchema = z.object({
  path: z.string().min(1),
  name: z.string().min(1).optional()
});
export type ProjectInput = z.infer<typeof projectInputSchema>;

export const sessionSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1).nullable(),
  title: z.string().min(1),
  providerId: z.string().min(1).optional(),
  accessMode: accessModeSchema,
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

export const messageRoleSchema = z.enum(["user", "assistant", "system", "tool"]);
export type MessageRole = z.infer<typeof messageRoleSchema>;

export const messageSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  role: messageRoleSchema,
  content: z.string(),
  createdAt: z.string()
});
export type Message = z.infer<typeof messageSchema>;

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

export const toolNameSchema = z.enum([
  "read_file",
  "write_file",
  "edit_file",
  "list_directory",
  "shell",
  "git_status",
  "git_diff"
]);
export type ToolName = z.infer<typeof toolNameSchema>;

export const toolCallSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  name: toolNameSchema,
  args: z.record(z.string(), z.unknown()),
  status: z.enum(["pending_approval", "running", "completed", "rejected", "failed"]),
  result: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type ToolCall = z.infer<typeof toolCallSchema>;

export const slashCommandKindSchema = z.enum(["builtin_tool", "prompt_template", "skill"]);
export type SlashCommandKind = z.infer<typeof slashCommandKindSchema>;

export const slashCommandSourceSchema = z.enum(["builtin", "global", "project"]);
export type SlashCommandSource = z.infer<typeof slashCommandSourceSchema>;

export const slashCommandSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: slashCommandKindSchema,
  description: z.string(),
  source: slashCommandSourceSchema,
  insertText: z.string().min(1)
});
export type SlashCommand = z.infer<typeof slashCommandSchema>;

export const slashCommandDiagnosticSchema = z.object({
  type: z.literal("warning"),
  message: z.string(),
  path: z.string().optional(),
  source: slashCommandSourceSchema.optional()
});
export type SlashCommandDiagnostic = z.infer<typeof slashCommandDiagnosticSchema>;

export const runRequestSchema = z.object({
  sessionId: z.string().min(1).optional(),
  projectId: z.string().min(1).nullable().optional(),
  prompt: z.string().min(1),
  providerId: z.string().min(1).optional(),
  accessMode: accessModeSchema.default("approval")
});
export type RunRequest = z.infer<typeof runRequestSchema>;

export const approvalDecisionSchema = z.object({
  approved: z.boolean()
});
export type ApprovalDecision = z.infer<typeof approvalDecisionSchema>;

export type StreamEvent =
  | { type: "run_started"; runId: string; sessionId: string }
  | { type: "user_message"; runId: string; message: Message }
  | { type: "assistant_delta"; runId: string; delta: string }
  | { type: "thinking_delta"; runId: string; delta: string }
  | { type: "tool_call_pending"; runId: string; toolCall: ToolCall }
  | { type: "tool_call_started"; runId: string; toolCall: ToolCall }
  | { type: "tool_result"; runId: string; toolCall: ToolCall }
  | { type: "assistant_done"; runId: string; message: Message }
  | { type: "run_error"; runId: string; error: string }
  | { type: "run_aborted"; runId: string };

export type StreamEventType = StreamEvent["type"];

export function encodeSseEvent(event: StreamEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

export function parseSseChunk(chunk: string): StreamEvent[] {
  return chunk
    .split(/\n\n+/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const dataLine = block
        .split("\n")
        .find((line) => line.startsWith("data: "));
      if (!dataLine) {
        throw new Error(`Invalid SSE block: ${block}`);
      }
      return JSON.parse(dataLine.slice(6)) as StreamEvent;
    });
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function createId(prefix: string): string {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj?.randomUUID) {
    return `${prefix}_${cryptoObj.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export function defaultProviders(timestamp = nowIso()): ProviderConfig[] {
  return [
    {
      id: "deepseek",
      kind: "deepseek",
      name: "DeepSeek",
      baseURL: "https://api.deepseek.com",
      model: "deepseek-v4-flash",
      createdAt: timestamp,
      updatedAt: timestamp
    },
    {
      id: "kimi",
      kind: "kimi",
      name: "Kimi",
      baseURL: "https://api.moonshot.ai/v1",
      model: "kimi-k2.6",
      createdAt: timestamp,
      updatedAt: timestamp
    }
  ];
}
