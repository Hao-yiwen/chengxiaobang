import { z } from "zod";

export const gitChangeScopeSchema = z.enum(["staged", "unstaged"]);
export type GitChangeScope = z.infer<typeof gitChangeScopeSchema>;

/** 一个未提交变更文件：porcelain XY 状态码 + 当前 scope 对应的 unified diff。 */
export const gitFileChangeSchema = z.object({
  path: z.string().min(1),
  scope: gitChangeScopeSchema,
  status: z.string().min(2),
  /** 二进制或过大文件无法展示内容时为空。 */
  diff: z.string(),
  /** 由后端基于当前 scope 的文本 diff 计算；无可展示文本差异时不返回。 */
  additions: z.number().int().nonnegative().optional(),
  /** 由后端基于当前 scope 的文本 diff 计算；无可展示文本差异时不返回。 */
  deletions: z.number().int().nonnegative().optional()
});
export type GitFileChange = z.infer<typeof gitFileChangeSchema>;

export const gitChangesResultSchema = z.object({
  isRepo: z.boolean(),
  files: z.array(gitFileChangeSchema)
});
export type GitChangesResult = z.infer<typeof gitChangesResultSchema>;

export const gitChangeDiffResultSchema = z.object({
  file: gitFileChangeSchema
});
export type GitChangeDiffResult = z.infer<typeof gitChangeDiffResultSchema>;

export const gitInfoSchema = z.object({
  isRepo: z.boolean()
});
export type GitInfo = z.infer<typeof gitInfoSchema>;
