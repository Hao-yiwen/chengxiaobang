import { z } from "zod";
import {
  feishuConfigSchema,
  feishuInstallStartResultSchema,
  feishuStatusSchema
} from "./feishu";

export const connectPhoneTargetSchema = z.enum(["wechat", "feishu", "lark"]);
export type ConnectPhoneTarget = z.infer<typeof connectPhoneTargetSchema>;

export const wechatConfigSchema = z.object({
  enabled: z.boolean(),
  accountId: z.string(),
  sessionKey: z.string().optional(),
  userId: z.string().optional()
});
export type WechatConfig = z.infer<typeof wechatConfigSchema>;

export function defaultWechatConfig(): WechatConfig {
  return { enabled: false, accountId: "" };
}

export const wechatStatusSchema = z.object({
  status: z.enum(["disconnected", "connecting", "connected", "error"]),
  error: z.string().optional(),
  accountId: z.string().optional()
});
export type WechatStatus = z.infer<typeof wechatStatusSchema>;

export const connectPhoneInstallStartInputSchema = z.object({
  target: connectPhoneTargetSchema
});
export type ConnectPhoneInstallStartInput = z.infer<typeof connectPhoneInstallStartInputSchema>;

export const connectPhoneInstallPollInputSchema = z.object({
  target: connectPhoneTargetSchema,
  deviceCode: z.string().min(1)
});
export type ConnectPhoneInstallPollInput = z.infer<typeof connectPhoneInstallPollInputSchema>;

export const connectPhoneInstallStartResultSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    target: connectPhoneTargetSchema,
    url: z.string().min(1),
    deviceCode: z.string().min(1),
    userCode: z.string(),
    interval: z.number().int().positive(),
    expiresIn: z.number().int().positive()
  }),
  z.object({
    ok: z.literal(false),
    target: connectPhoneTargetSchema.optional(),
    message: z.string()
  })
]);
export type ConnectPhoneInstallStartResult = z.infer<typeof connectPhoneInstallStartResultSchema>;

export const connectPhoneInstallPollResultSchema = z.union([
  z.object({
    done: z.literal(true),
    target: z.literal("wechat"),
    config: wechatConfigSchema,
    status: wechatStatusSchema
  }),
  z.object({
    done: z.literal(true),
    target: z.union([z.literal("feishu"), z.literal("lark")]),
    config: feishuConfigSchema,
    status: feishuStatusSchema
  }),
  z.object({
    done: z.literal(false),
    target: connectPhoneTargetSchema.optional(),
    error: z.string().optional()
  })
]);
export type ConnectPhoneInstallPollResult = z.infer<typeof connectPhoneInstallPollResultSchema>;

export function normalizeConnectPhoneStartResult(
  target: ConnectPhoneTarget,
  result: z.infer<typeof feishuInstallStartResultSchema>
): ConnectPhoneInstallStartResult {
  if (!result.ok) {
    return { ok: false, target, message: result.message };
  }
  return { ...result, target };
}
