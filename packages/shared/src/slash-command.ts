import { z } from "zod";

export const slashCommandKindSchema = z.enum(["builtin_tool", "prompt_template", "skill"]);
export type SlashCommandKind = z.infer<typeof slashCommandKindSchema>;

export const slashCommandSourceSchema = z.enum([
  "builtin",
  "market",
  "global",
  "project",
  "plugin"
]);
export type SlashCommandSource = z.infer<typeof slashCommandSourceSchema>;

export const slashCommandSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: slashCommandKindSchema,
  description: z.string(),
  source: slashCommandSourceSchema,
  insertText: z.string().min(1),
  /** 当 source 为 plugin 时提供该命令所属插件名。 */
  pluginName: z.string().optional(),
  /** 命令参数提示（来自插件 commands/*.md 的 argument-hint），供命令面板展示。 */
  argumentHint: z.string().optional(),
  /** 是否生效；命令页可单独停用聚合来源的命令。缺省（undefined）视为启用。 */
  enabled: z.boolean().optional()
});
export type SlashCommand = z.infer<typeof slashCommandSchema>;

export const slashCommandDiagnosticSchema = z.object({
  type: z.literal("warning"),
  message: z.string(),
  path: z.string().optional(),
  source: slashCommandSourceSchema.optional()
});
export type SlashCommandDiagnostic = z.infer<typeof slashCommandDiagnosticSchema>;
