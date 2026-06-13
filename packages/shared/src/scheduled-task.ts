import { z } from "zod";

/** 最近一次执行的结局；与 run 的终态对应（running 不落任务行）。 */
export const scheduledTaskStatusSchema = z.enum(["completed", "failed", "aborted"]);
export type ScheduledTaskStatus = z.infer<typeof scheduledTaskStatusSchema>;

/** 定时任务类型：周期任务使用 cron；一次性任务使用 runAt。 */
export const scheduledTaskKindSchema = z.enum(["once", "recurring"]);
export type ScheduledTaskKind = z.infer<typeof scheduledTaskKindSchema>;

export const scheduledTaskSchema = z.object({
  id: z.string().min(1),
  /** 创建任务的会话；到点后在该会话里追加一次 headless run。 */
  sessionId: z.string().min(1),
  name: z.string().min(1),
  /** 每次执行喂给模型的提示词。 */
  prompt: z.string().min(1),
  kind: scheduledTaskKindSchema,
  /** 周期任务的 5 字段 cron 表达式，按本地时区解释。 */
  cron: z.string().min(1).optional(),
  /** 一次性任务的计划执行时间（UTC ISO）。 */
  runAt: z.string().optional(),
  /** false 时 mutating 工具在执行中被自动拒绝（无人值守只读）。 */
  fullAccess: z.boolean(),
  enabled: z.boolean(),
  /** 下次预定执行时间（UTC ISO）；调度器据此判断到期与补跑。 */
  nextRunAt: z.string().optional(),
  lastRunAt: z.string().optional(),
  lastStatus: scheduledTaskStatusSchema.optional(),
  lastError: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type ScheduledTask = z.infer<typeof scheduledTaskSchema>;

export const scheduledTaskUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  cron: z.string().min(1).optional(),
  runAt: z.string().min(1).optional(),
  prompt: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
  fullAccess: z.boolean().optional(),
  nextRunAt: z.string().min(1).nullable().optional()
});
export type ScheduledTaskUpdate = z.infer<typeof scheduledTaskUpdateSchema>;
