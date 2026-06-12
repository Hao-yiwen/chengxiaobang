import { z } from "zod";

export const projectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  path: z.string().min(1),
  /** 置顶时间；存在即置顶，侧边栏置顶区按其降序排列。 */
  pinnedAt: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type Project = z.infer<typeof projectSchema>;

export const projectInputSchema = z.object({
  path: z.string().min(1),
  name: z.string().min(1).optional()
});
export type ProjectInput = z.infer<typeof projectInputSchema>;

export const projectUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  /** 置顶开关：true 置顶、false 取消置顶。 */
  pinned: z.boolean().optional()
});
export type ProjectUpdate = z.infer<typeof projectUpdateSchema>;

export const projectFileEntrySchema = z.object({
  name: z.string().min(1),
  /** 项目根目录下的 POSIX 风格相对路径，根目录直属文件如 README.md。 */
  path: z.string(),
  type: z.enum(["file", "directory"])
});
export type ProjectFileEntry = z.infer<typeof projectFileEntrySchema>;
