import { z } from "zod";

/** 一个未提交变更文件：porcelain XY 状态码 + 合并后的 unified diff。 */
export const gitFileChangeSchema = z.object({
  path: z.string().min(1),
  status: z.string().min(2),
  /** 二进制或过大文件无法展示内容时为空。 */
  diff: z.string()
});
export type GitFileChange = z.infer<typeof gitFileChangeSchema>;

export const gitChangesResultSchema = z.object({
  isRepo: z.boolean(),
  files: z.array(gitFileChangeSchema)
});
export type GitChangesResult = z.infer<typeof gitChangesResultSchema>;

export const gitInfoSchema = z.object({
  isRepo: z.boolean()
});
export type GitInfo = z.infer<typeof gitInfoSchema>;
