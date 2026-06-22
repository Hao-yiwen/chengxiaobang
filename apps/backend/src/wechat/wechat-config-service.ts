import {
  defaultWechatConfig,
  wechatConfigSchema,
  type WechatConfig
} from "@chengxiaobang/shared";
import type { StateStore } from "../repository/state-store";

import { getLogger } from "../logging/logger";

const log = getLogger({ module: "wechat/wechat-config-service" });

const WECHAT_SETTINGS_KEY = "wechat";

export class WechatConfigService {
  constructor(private readonly store: StateStore) {}

  async load(): Promise<WechatConfig> {
    const raw = await this.store.getSetting(WECHAT_SETTINGS_KEY);
    if (!raw) {
      return defaultWechatConfig();
    }
    try {
      return wechatConfigSchema.parse(JSON.parse(raw) as unknown);
    } catch (error) {
      log.warn("[wechat-config] 微信配置解析失败，回退为未连接", {
        error: error instanceof Error ? error.message : String(error)
      });
      return defaultWechatConfig();
    }
  }

  async save(config: WechatConfig): Promise<WechatConfig> {
    const parsed = wechatConfigSchema.parse(config);
    await this.store.setSetting(WECHAT_SETTINGS_KEY, JSON.stringify(parsed));
    log.info("[wechat-config] 已保存微信连接配置", {
      enabled: parsed.enabled,
      accountId: parsed.accountId || undefined,
      hasSessionKey: Boolean(parsed.sessionKey)
    });
    return parsed;
  }
}
