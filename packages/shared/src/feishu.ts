import { z } from "zod";

export const feishuDomainSchema = z.enum(["feishu", "lark"]);
export type FeishuDomain = z.infer<typeof feishuDomainSchema>;
export const feishuInstallDomainSchema = feishuDomainSchema;
export type FeishuInstallDomain = FeishuDomain;

/** 持久化的飞书机器人配置；App Secret 存在系统密钥库中。 */
export const feishuConfigSchema = z.object({
  enabled: z.boolean(),
  appId: z.string(),
  appSecretRef: z.string().min(1).optional(),
  domain: feishuDomainSchema,
  /** 飞书触发的运行默认只读；开启后允许完全访问。 */
  fullAccess: z.boolean()
});
export type FeishuConfig = z.infer<typeof feishuConfigSchema>;

export function defaultFeishuConfig(): FeishuConfig {
  return { enabled: false, appId: "", domain: "feishu", fullAccess: false };
}

/** 设置表单入参：可选明文密钥写入，出参只返回密钥引用。 */
export const feishuConfigInputSchema = z.object({
  enabled: z.boolean(),
  appId: z.string(),
  appSecret: z.string().optional(),
  domain: feishuDomainSchema,
  fullAccess: z.boolean()
});
export type FeishuConfigInput = z.infer<typeof feishuConfigInputSchema>;

export const feishuStatusSchema = z.object({
  status: z.enum(["disconnected", "connecting", "connected", "error"]),
  error: z.string().optional(),
  botName: z.string().optional()
});
export type FeishuStatus = z.infer<typeof feishuStatusSchema>;

export const feishuInstallStartInputSchema = z.object({
  domain: feishuInstallDomainSchema
});
export type FeishuInstallStartInput = z.infer<typeof feishuInstallStartInputSchema>;

export const feishuInstallPollInputSchema = z.object({
  deviceCode: z.string().min(1)
});
export type FeishuInstallPollInput = z.infer<typeof feishuInstallPollInputSchema>;

export const feishuInstallStartResultSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    url: z.string().url(),
    deviceCode: z.string().min(1),
    userCode: z.string(),
    interval: z.number().int().positive(),
    expiresIn: z.number().int().positive()
  }),
  z.object({
    ok: z.literal(false),
    message: z.string()
  })
]);
export type FeishuInstallStartResult = z.infer<typeof feishuInstallStartResultSchema>;

export const feishuInstallPollResultSchema = z.discriminatedUnion("done", [
  z.object({
    done: z.literal(true),
    config: feishuConfigSchema,
    status: feishuStatusSchema
  }),
  z.object({
    done: z.literal(false),
    error: z.string().optional()
  })
]);
export type FeishuInstallPollResult = z.infer<typeof feishuInstallPollResultSchema>;
