import { z } from "zod";

export const slashCommandKindSchema = z.enum(["builtin_tool", "prompt_template", "skill"]);
export type SlashCommandKind = z.infer<typeof slashCommandKindSchema>;

export const slashCommandSourceSchema = z.enum(["builtin", "market", "global", "project"]);
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
