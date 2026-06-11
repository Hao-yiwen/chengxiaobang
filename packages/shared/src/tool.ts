import { z } from "zod";

export const toolNameSchema = z.enum([
  "read_file",
  "write_file",
  "edit_file",
  "list_directory",
  "shell",
  "git_status",
  "git_diff",
  "glob",
  "search",
  "make_directory",
  "fetch_url",
  "create_pptx",
  "create_docx",
  "create_xlsx",
  "feishu_send_message"
]);
export type ToolName = z.infer<typeof toolNameSchema>;

export const toolCallSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  // Plain string: the model can request unknown tool names, and those calls
  // still get persisted/rendered (as failed) instead of masquerading as shell.
  name: z.string().min(1),
  args: z.record(z.string(), z.unknown()),
  status: z.enum(["pending_approval", "running", "completed", "rejected", "failed"]),
  result: z.string().optional(),
  /** When execution actually began (post-approval), ISO timestamp. */
  startedAt: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type ToolCall = z.infer<typeof toolCallSchema>;
