import type {
  FeishuInstallDomain,
  FeishuInstallStartResult
} from "@chengxiaobang/shared";

import { getLogger } from "../logging/logger";

const log = getLogger({ module: "feishu/feishu-install-service" });

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

type FeishuInstallCredentialResult =
  | {
      done: true;
      appId: string;
      appSecret: string;
      domain: FeishuInstallDomain;
    }
  | {
      done: false;
      error?: string;
    };

type InternalPollResult =
  | FeishuInstallCredentialResult
  | {
      done: false;
      retryDomain: FeishuInstallDomain;
    };

const REGISTRATION_PATH = "/oauth/v1/app/registration";
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_INSTALL_TARGETS = 32;

const DOMAIN_ENDPOINTS: Record<FeishuInstallDomain, { accounts: string; open: string }> = {
  feishu: {
    accounts: "https://accounts.feishu.cn",
    open: "https://open.feishu.cn"
  },
  lark: {
    accounts: "https://accounts.larksuite.com",
    open: "https://open.larksuite.com"
  }
};

/** 飞书/Lark PersonalAgent 扫码安装：只负责拿到应用凭据，不持久化密钥。 */
export class FeishuInstallService {
  private readonly fetchImpl: FetchLike;
  private readonly installTargets = new Map<string, FeishuInstallDomain>();

  constructor(options: { fetch?: FetchLike } = {}) {
    this.fetchImpl = options.fetch ?? fetch;
  }

  async start(domain: FeishuInstallDomain): Promise<FeishuInstallStartResult> {
    log.info("[feishu-install] 开始生成扫码连接", { domain });
    try {
      const endpoint = `${DOMAIN_ENDPOINTS[domain].accounts}${REGISTRATION_PATH}`;
      const data = await this.postForm(endpoint, {
        action: "begin",
        archetype: "PersonalAgent",
        auth_method: "client_secret",
        request_user_info: "open_id tenant_brand"
      });
      const deviceCode = recordString(data, "device_code");
      const userCode = recordString(data, "user_code");
      const url =
        recordString(data, "verification_uri_complete") ||
        (userCode
          ? `${DOMAIN_ENDPOINTS[domain].open}/page/cli?user_code=${encodeURIComponent(userCode)}`
          : "");
      if (!url || !deviceCode) {
        throw new Error(
          recordString(data, "error_description") ||
            recordString(data, "message") ||
            "飞书扫码连接响应不完整"
        );
      }
      this.rememberTarget(deviceCode, domain);
      log.info("[feishu-install] 扫码连接已生成", {
        domain,
        deviceCodePrefix: shortDeviceCode(deviceCode),
        userCode: userCode || undefined
      });
      return {
        ok: true,
        url,
        deviceCode,
        userCode,
        interval: normalizeSeconds(data.interval, 5, 3),
        expiresIn: normalizeSeconds(data.expires_in ?? data.expire_in, 300, 1)
      };
    } catch (error) {
      const message = errorMessage(error);
      log.warn("[feishu-install] 生成扫码连接失败", { domain, error: message });
      return { ok: false, message };
    }
  }

  async poll(deviceCode: string): Promise<FeishuInstallCredentialResult> {
    const normalizedDeviceCode = deviceCode.trim();
    const targetDomain = this.installTargets.get(normalizedDeviceCode);
    if (!targetDomain) {
      log.warn("[feishu-install] 轮询扫码状态失败，deviceCode 不存在或已过期");
      return { done: false, error: "扫码状态已过期，请重新生成二维码" };
    }

    const first = await this.pollDomain(normalizedDeviceCode, targetDomain);
    if (!first.done && "retryDomain" in first) {
      log.info("[feishu-install] 检测到 Lark 租户，切换轮询域名", {
        deviceCodePrefix: shortDeviceCode(normalizedDeviceCode)
      });
      this.rememberTarget(normalizedDeviceCode, first.retryDomain);
      return this.pollDomain(normalizedDeviceCode, first.retryDomain);
    }
    return first;
  }

  private async pollDomain(
    deviceCode: string,
    domain: FeishuInstallDomain
  ): Promise<InternalPollResult> {
    try {
      const result = await this.postFormResult(
        `${DOMAIN_ENDPOINTS[domain].accounts}${REGISTRATION_PATH}`,
        {
          action: "poll",
          device_code: deviceCode
        }
      );
      return this.parsePollResponse(result, deviceCode, domain);
    } catch (error) {
      const message = errorMessage(error);
      log.warn("[feishu-install] 轮询扫码状态失败", {
        domain,
        deviceCodePrefix: shortDeviceCode(deviceCode),
        error: message
      });
      return { done: false, error: message };
    }
  }

  private parsePollResponse(
    result: { ok: boolean; status: number; data: Record<string, unknown> },
    deviceCode: string,
    domain: FeishuInstallDomain
  ): InternalPollResult {
    const data = result.data;
    const error = recordString(data, "error");
    if (error) {
      if (error === "authorization_pending" || error === "slow_down") {
        log.debug("[feishu-install] 扫码授权仍在等待", {
          domain,
          deviceCodePrefix: shortDeviceCode(deviceCode),
          error
        });
        return { done: false };
      }
      this.installTargets.delete(deviceCode);
      const message = friendlyPollError(error, recordString(data, "error_description"));
      log.warn("[feishu-install] 扫码授权返回错误", {
        domain,
        deviceCodePrefix: shortDeviceCode(deviceCode),
        error
      });
      return { done: false, error: message };
    }

    if (!result.ok) {
      this.installTargets.delete(deviceCode);
      return {
        done: false,
        error:
          recordString(data, "error_description") ||
          recordString(data, "message") ||
          `飞书扫码轮询失败：HTTP ${result.status}`
      };
    }

    const appId = recordString(data, "client_id");
    const appSecret = recordString(data, "client_secret");
    const userInfo = asRecord(data.user_info);
    const resolvedDomain =
      recordString(userInfo, "tenant_brand") === "lark" ? "lark" : domain;

    if (appId && appSecret) {
      this.installTargets.delete(deviceCode);
      log.info("[feishu-install] 扫码授权成功", {
        domain: resolvedDomain,
        appId,
        deviceCodePrefix: shortDeviceCode(deviceCode)
      });
      return { done: true, appId, appSecret, domain: resolvedDomain };
    }

    if (appId && !appSecret && resolvedDomain === "lark" && domain !== "lark") {
      return { done: false, retryDomain: "lark" };
    }

    if (appId && !appSecret) {
      this.installTargets.delete(deviceCode);
      return { done: false, error: "扫码授权完成，但飞书未返回 App Secret" };
    }

    return { done: false };
  }

  private rememberTarget(deviceCode: string, domain: FeishuInstallDomain): void {
    this.installTargets.delete(deviceCode);
    this.installTargets.set(deviceCode, domain);
    while (this.installTargets.size > MAX_INSTALL_TARGETS) {
      const oldest = this.installTargets.keys().next().value;
      if (!oldest) {
        break;
      }
      this.installTargets.delete(oldest);
    }
  }

  private async postForm(url: string, body: Record<string, string>): Promise<Record<string, unknown>> {
    const result = await this.postFormResult(url, body);
    if (!result.ok) {
      throw new Error(
        recordString(result.data, "error_description") ||
          recordString(result.data, "message") ||
          `HTTP ${result.status}`
      );
    }
    return result.data;
  }

  private async postFormResult(
    url: string,
    body: Record<string, string>
  ): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
    const response = await this.fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body).toString(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    return {
      ok: response.ok,
      status: response.status,
      data: await readJsonResponse(response)
    };
  }
}

async function readJsonResponse(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  try {
    return asRecord(JSON.parse(text) as unknown);
  } catch {
    return { message: text.trim() || response.statusText };
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function recordString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value.trim() : "";
}

function normalizeSeconds(value: unknown, fallback: number, minimum: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.floor(parsed)) : fallback;
}

function friendlyPollError(error: string, description: string): string {
  if (error === "access_denied") {
    return "用户取消了飞书扫码授权";
  }
  if (error === "expired_token" || error === "invalid_grant") {
    return "二维码已过期，请重新生成";
  }
  return description || error;
}

function shortDeviceCode(deviceCode: string): string {
  return deviceCode.slice(0, 8);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
