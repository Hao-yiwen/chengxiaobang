import { z } from "zod";

import { accessModeSchema } from "./access-mode";

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
