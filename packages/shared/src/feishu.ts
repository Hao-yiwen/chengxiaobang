import { z } from "zod";

export const feishuDomainSchema = z.enum(["feishu", "lark"]);
export type FeishuDomain = z.infer<typeof feishuDomainSchema>;

/** Persisted Feishu bot configuration; the App Secret lives in the Keychain. */
export const feishuConfigSchema = z.object({
  enabled: z.boolean(),
  appId: z.string(),
  appSecretRef: z.string().min(1).optional(),
  domain: feishuDomainSchema,
  /** Feishu-triggered runs default to read-only; this opts into full access. */
  fullAccess: z.boolean()
});
export type FeishuConfig = z.infer<typeof feishuConfigSchema>;

export function defaultFeishuConfig(): FeishuConfig {
  return { enabled: false, appId: "", domain: "feishu", fullAccess: false };
}

/** Settings form payload: plaintext secret in (optional), ref out. */
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
