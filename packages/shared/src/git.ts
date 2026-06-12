import { z } from "zod";

/** One file with uncommitted changes: porcelain XY status code + merged unified diff body. */
export const gitFileChangeSchema = z.object({
  path: z.string().min(1),
  status: z.string().min(2),
  /** Empty when the content cannot be shown (binary or oversized file). */
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
