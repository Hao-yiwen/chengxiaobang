import { describe, expect, it, vi } from "vitest";
import { FeishuInstallService } from "../src/feishu/feishu-install-service";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function bodyParams(init?: RequestInit): URLSearchParams {
  return new URLSearchParams(String(init?.body ?? ""));
}

describe("FeishuInstallService", () => {
  it("starts a Feishu PersonalAgent registration flow", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(bodyParams(init).get("action")).toBe("begin");
      expect(bodyParams(init).get("archetype")).toBe("PersonalAgent");
      expect(bodyParams(init).get("auth_method")).toBe("client_secret");
      expect(bodyParams(init).get("request_user_info")).toBe("open_id tenant_brand");
      return jsonResponse({
        verification_uri_complete: "https://open.feishu.cn/page/cli?user_code=FEI-CODE",
        device_code: "device-feishu",
        user_code: "FEI-CODE",
        interval: 4,
        expires_in: 180
      });
    });
    const service = new FeishuInstallService({ fetch: fetchMock });

    await expect(service.start("feishu")).resolves.toEqual({
      ok: true,
      url: "https://open.feishu.cn/page/cli?user_code=FEI-CODE",
      deviceCode: "device-feishu",
      userCode: "FEI-CODE",
      interval: 4,
      expiresIn: 180
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://accounts.feishu.cn/oauth/v1/app/registration",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("uses the Lark registration host when Lark is selected", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        verification_uri_complete: "https://open.larksuite.com/page/cli?user_code=LARK-CODE",
        device_code: "device-lark",
        user_code: "LARK-CODE"
      })
    );
    const service = new FeishuInstallService({ fetch: fetchMock });

    const result = await service.start("lark");

    expect(result).toMatchObject({ ok: true, deviceCode: "device-lark" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://accounts.larksuite.com/oauth/v1/app/registration",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("keeps pending and slow_down states non-terminal", async () => {
    let pollCount = 0;
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const action = bodyParams(init).get("action");
      if (action === "begin") {
        return jsonResponse({
          verification_uri_complete: "https://open.feishu.cn/page/cli?user_code=WAIT",
          device_code: "device-wait",
          user_code: "WAIT"
        });
      }
      pollCount += 1;
      return jsonResponse({
        error: pollCount === 1 ? "authorization_pending" : "slow_down"
      });
    });
    const service = new FeishuInstallService({ fetch: fetchMock });
    await service.start("feishu");

    await expect(service.poll("device-wait")).resolves.toEqual({ done: false });
    await expect(service.poll("device-wait")).resolves.toEqual({ done: false });
  });

  it("maps denied and expired poll errors to user-facing messages", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const action = bodyParams(init).get("action");
      if (action === "begin") {
        return jsonResponse({
          verification_uri_complete: "https://open.feishu.cn/page/cli?user_code=DENY",
          device_code: "device-denied",
          user_code: "DENY"
        });
      }
      return jsonResponse({ error: "access_denied" });
    });
    const service = new FeishuInstallService({ fetch: fetchMock });
    await service.start("feishu");

    await expect(service.poll("device-denied")).resolves.toEqual({
      done: false,
      error: "用户取消了飞书扫码授权"
    });
    await expect(service.poll("device-denied")).resolves.toEqual({
      done: false,
      error: "扫码状态已过期，请重新生成二维码"
    });

    const expiredFetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const action = bodyParams(init).get("action");
      if (action === "begin") {
        return jsonResponse({
          verification_uri_complete: "https://open.feishu.cn/page/cli?user_code=EXP",
          device_code: "device-expired",
          user_code: "EXP"
        });
      }
      return jsonResponse({ error: "expired_token" });
    });
    const expiredService = new FeishuInstallService({ fetch: expiredFetchMock });
    await expiredService.start("feishu");
    await expect(expiredService.poll("device-expired")).resolves.toEqual({
      done: false,
      error: "二维码已过期，请重新生成"
    });
  });

  it("returns credentials on successful poll without changing the selected domain", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const action = bodyParams(init).get("action");
      if (action === "begin") {
        return jsonResponse({
          verification_uri_complete: "https://open.feishu.cn/page/cli?user_code=OK",
          device_code: "device-ok",
          user_code: "OK"
        });
      }
      return jsonResponse({
        client_id: "cli_ok",
        client_secret: "secret-ok",
        user_info: { tenant_brand: "feishu" }
      });
    });
    const service = new FeishuInstallService({ fetch: fetchMock });
    await service.start("feishu");

    await expect(service.poll("device-ok")).resolves.toEqual({
      done: true,
      appId: "cli_ok",
      appSecret: "secret-ok",
      domain: "feishu"
    });
  });

  it("retries polling through Lark when Feishu identifies a Lark tenant", async () => {
    const requestedUrls: string[] = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      requestedUrls.push(url);
      const action = bodyParams(init).get("action");
      if (action === "begin") {
        return jsonResponse({
          verification_uri_complete: "https://open.feishu.cn/page/cli?user_code=SWITCH",
          device_code: "device-switch",
          user_code: "SWITCH"
        });
      }
      if (url.includes("accounts.feishu.cn")) {
        return jsonResponse({
          client_id: "cli_lark",
          user_info: { tenant_brand: "lark" }
        });
      }
      return jsonResponse({
        client_id: "cli_lark",
        client_secret: "secret-lark",
        user_info: { tenant_brand: "lark" }
      });
    });
    const service = new FeishuInstallService({ fetch: fetchMock });
    await service.start("feishu");

    await expect(service.poll("device-switch")).resolves.toEqual({
      done: true,
      appId: "cli_lark",
      appSecret: "secret-lark",
      domain: "lark"
    });
    expect(requestedUrls).toContain("https://accounts.larksuite.com/oauth/v1/app/registration");
  });
});
