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
  isRepo: z.boolean(),
  /** Git 仓库当前分支名；非仓库、detached HEAD 或读取失败时不返回。 */
  branchName: z.string().min(1).optional()
});
export type GitInfo = z.infer<typeof gitInfoSchema>;

export const gitGraphRefTypeSchema = z.enum(["head", "local", "remote", "tag", "other"]);
export type GitGraphRefType = z.infer<typeof gitGraphRefTypeSchema>;

export const gitGraphRefSchema = z.object({
  name: z.string().min(1),
  type: gitGraphRefTypeSchema
});
export type GitGraphRef = z.infer<typeof gitGraphRefSchema>;

export const gitGraphCommitSchema = z.object({
  hash: z.string().min(1),
  shortHash: z.string().min(1),
  parents: z.array(z.string().min(1)),
  subject: z.string(),
  authorName: z.string(),
  date: z.string().min(1),
  refs: z.array(gitGraphRefSchema)
});
export type GitGraphCommit = z.infer<typeof gitGraphCommitSchema>;

export const gitGraphResultSchema = z.object({
  isRepo: z.boolean(),
  head: z.string().min(1).optional(),
  commits: z.array(gitGraphCommitSchema)
});
export type GitGraphResult = z.infer<typeof gitGraphResultSchema>;

export const gitBranchTypeSchema = z.enum(["local", "remote"]);
export type GitBranchType = z.infer<typeof gitBranchTypeSchema>;

export const gitBranchRefSchema = z.object({
  name: z.string().min(1),
  type: gitBranchTypeSchema,
  current: z.boolean(),
  upstream: z.string().min(1).optional()
});
export type GitBranchRef = z.infer<typeof gitBranchRefSchema>;

export const gitEnvironmentSchema = z.object({
  isRepo: z.boolean(),
  branchName: z.string().min(1).optional(),
  upstream: z.string().min(1).optional(),
  ahead: z.number().int().nonnegative(),
  behind: z.number().int().nonnegative(),
  changedFileCount: z.number().int().nonnegative(),
  stagedFileCount: z.number().int().nonnegative(),
  unstagedFileCount: z.number().int().nonnegative(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  branches: z.array(gitBranchRefSchema)
});
export type GitEnvironment = z.infer<typeof gitEnvironmentSchema>;

export const gitCheckoutBranchInputSchema = z.object({
  branchName: z.string().min(1),
  branchType: gitBranchTypeSchema
});
export type GitCheckoutBranchInput = z.infer<typeof gitCheckoutBranchInputSchema>;

export const gitCreateBranchInputSchema = z.object({
  branchName: z.string().min(1)
});
export type GitCreateBranchInput = z.infer<typeof gitCreateBranchInputSchema>;

export const gitCommitInputSchema = z.object({
  message: z.string().optional(),
  includeUnstaged: z.boolean().default(true),
  sessionId: z.string().min(1).optional()
});
export type GitCommitInput = z.infer<typeof gitCommitInputSchema>;

export const gitPushInputSchema = z.object({}).optional();
export type GitPushInput = z.infer<typeof gitPushInputSchema>;

export const gitActionResultSchema = z.object({
  environment: gitEnvironmentSchema
});
export type GitActionResult = z.infer<typeof gitActionResultSchema>;

export const gitCommitResultSchema = gitActionResultSchema.extend({
  commitHash: z.string().min(1),
  message: z.string().min(1)
});
export type GitCommitResult = z.infer<typeof gitCommitResultSchema>;
