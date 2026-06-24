import { z } from "zod";

export const modelDebugSourceSchema = z.enum(["agent"]);
export type ModelDebugSource = z.infer<typeof modelDebugSourceSchema>;

export const modelDebugRecordStatusSchema = z.enum(["pending", "completed", "failed"]);
export type ModelDebugRecordStatus = z.infer<typeof modelDebugRecordStatusSchema>;

export const modelDebugRecordSchema = z
  .object({
    id: z.string().min(1),
    runId: z.string().min(1),
    sessionId: z.string().min(1),
    userMessageId: z.string().min(1).optional(),
    source: modelDebugSourceSchema,
    attemptIndex: z.number().int().nonnegative(),
    requestIndex: z.number().int().nonnegative(),
    providerId: z.string().min(1).optional(),
    providerKind: z.string().min(1).optional(),
    model: z.string().min(1).optional(),
    api: z.string().min(1).optional(),
    status: modelDebugRecordStatusSchema,
    request: z.unknown().optional(),
    response: z.unknown().optional(),
    requestBytes: z.number().int().nonnegative().optional(),
    responseBytes: z.number().int().nonnegative().optional(),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1)
  })
  .strict();
export type ModelDebugRecord = z.infer<typeof modelDebugRecordSchema>;
