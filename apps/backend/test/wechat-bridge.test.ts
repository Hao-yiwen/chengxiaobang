import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WechatBridgeRuntime } from "../src/wechat/wechat-bridge";

describe("WechatBridgeRuntime", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "cxb-wechat-bridge-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("starts a QR login and persists account token after confirmation", async () => {
    const fetchImpl = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url.includes("get_bot_qrcode")) {
        return jsonResponse({
          qrcode: "qr-ticket",
          qrcode_img_content: "data:image/png;base64,ZmFrZQ=="
        });
      }
      if (url.includes("get_qrcode_status")) {
        return jsonResponse({
          status: "confirmed",
          ilink_bot_id: "bot_123",
          bot_token: "token-123",
          baseurl: "https://example.weixin.local",
          ilink_user_id: "user_123"
        });
      }
      return jsonResponse({});
    });
    const bridge = new WechatBridgeRuntime({ dataDir: dir, fetch: fetchImpl });

    const started = await bridge.startInstall();
    expect(started).toMatchObject({
      ok: true,
      target: "wechat",
      url: "data:image/png;base64,ZmFrZQ=="
    });

    const polled = await bridge.pollInstall(started.ok ? started.deviceCode : "");
    expect(polled).toMatchObject({
      done: true,
      accountId: "bot_123",
      sessionKey: started.ok ? started.deviceCode : "",
      userId: "user_123"
    });

    const saved = JSON.parse(
      await readFile(
        join(dir, "wechat-bridge", "openclaw-weixin", "accounts", "bot_123.json"),
        "utf8"
      )
    ) as { token?: string; baseUrl?: string };
    expect(saved).toMatchObject({
      token: "token-123",
      baseUrl: "https://example.weixin.local"
    });
  });

  it("reuses the saved account when QR polling reports binded_redirect", async () => {
    const statuses = [
      {
        status: "confirmed",
        ilink_bot_id: "bot_123",
        bot_token: "token-123",
        baseurl: "https://example.weixin.local",
        ilink_user_id: "user_123"
      },
      {
        status: "binded_redirect"
      }
    ];
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("get_bot_qrcode")) {
        return jsonResponse({
          qrcode: `qr-ticket-${fetchImpl.mock.calls.length}`,
          qrcode_img_content: "data:image/png;base64,ZmFrZQ=="
        });
      }
      if (url.includes("get_qrcode_status")) {
        return jsonResponse(statuses.shift() ?? { status: "wait" });
      }
      return jsonResponse({});
    });
    const bridge = new WechatBridgeRuntime({ dataDir: dir, fetch: fetchImpl });

    const firstStarted = await bridge.startInstall();
    if (!firstStarted.ok) {
      throw new Error(firstStarted.message);
    }
    await expect(bridge.pollInstall(firstStarted.deviceCode)).resolves.toMatchObject({
      done: true,
      accountId: "bot_123",
      userId: "user_123"
    });

    const secondStarted = await bridge.startInstall();
    if (!secondStarted.ok) {
      throw new Error(secondStarted.message);
    }
    const secondPolled = await bridge.pollInstall(secondStarted.deviceCode);

    expect(secondPolled).toMatchObject({
      done: true,
      accountId: "bot_123",
      sessionKey: secondStarted.deviceCode,
      userId: "user_123"
    });
    const accountIds = JSON.parse(
      await readFile(join(dir, "wechat-bridge", "openclaw-weixin", "accounts.json"), "utf8")
    ) as string[];
    expect(accountIds).toEqual(["bot_123"]);
  });

  it("does not complete binded_redirect when no local token is available", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("get_bot_qrcode")) {
        return jsonResponse({
          qrcode: "qr-ticket",
          qrcode_img_content: "data:image/png;base64,ZmFrZQ=="
        });
      }
      if (url.includes("get_qrcode_status")) {
        return jsonResponse({ status: "binded_redirect" });
      }
      return jsonResponse({});
    });
    const bridge = new WechatBridgeRuntime({ dataDir: dir, fetch: fetchImpl });

    const started = await bridge.startInstall();
    if (!started.ok) {
      throw new Error(started.message);
    }

    await expect(bridge.pollInstall(started.deviceCode)).resolves.toMatchObject({
      done: false,
      error: expect.stringContaining("本地授权信息不可用")
    });
  });

  it("falls back to a saved account when starting from a stale configured account id", async () => {
    const fetchImpl = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url.includes("get_bot_qrcode")) {
        return jsonResponse({
          qrcode: "qr-ticket",
          qrcode_img_content: "data:image/png;base64,ZmFrZQ=="
        });
      }
      if (url.includes("get_qrcode_status")) {
        return jsonResponse({
          status: "confirmed",
          ilink_bot_id: "bot_123",
          bot_token: "token-123",
          baseurl: "https://example.weixin.local",
          ilink_user_id: "user_123"
        });
      }
      if (url.includes("getupdates")) {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return jsonResponse({ ret: 0, msgs: [] });
      }
      if (url.includes("sendmessage")) {
        return jsonResponse({ ret: 0 });
      }
      return jsonResponse({});
    });
    const bridge = new WechatBridgeRuntime({ dataDir: dir, fetch: fetchImpl });
    const started = await bridge.startInstall();
    if (!started.ok) {
      throw new Error(started.message);
    }
    await bridge.pollInstall(started.deviceCode);

    await bridge.start("stale-device-code-account", () => {});
    await bridge.sendText("wx_chat1", "你好");
    await bridge.stop();

    const sendCall = fetchImpl.mock.calls.find(([url]) => url.includes("sendmessage"));
    expect(sendCall?.[1]?.headers).toMatchObject({
      Authorization: "Bearer token-123"
    });
  });

  it("parses numeric WeChat message ids from getupdates", async () => {
    let updatesServed = false;
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("get_bot_qrcode")) {
        return jsonResponse({
          qrcode: "qr-ticket",
          qrcode_img_content: "data:image/png;base64,ZmFrZQ=="
        });
      }
      if (url.includes("get_qrcode_status")) {
        return jsonResponse({
          status: "confirmed",
          ilink_bot_id: "bot_123",
          bot_token: "token-123",
          baseurl: "https://example.weixin.local",
          ilink_user_id: "user_123"
        });
      }
      if (url.includes("getupdates")) {
        if (!updatesServed) {
          updatesServed = true;
          return jsonResponse({
            ret: 0,
            get_updates_buf: "sync-1",
            msgs: [
              {
                message_id: 12345,
                message_type: "1",
                from_user_id: "wx_chat1",
                context_token: "ctx-1",
                item_list: [{ type: "1", text_item: { text: "你好" } }]
              }
            ]
          });
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
        return jsonResponse({ ret: 0, msgs: [] });
      }
      return jsonResponse({});
    });
    const bridge = new WechatBridgeRuntime({ dataDir: dir, fetch: fetchImpl });
    const started = await bridge.startInstall();
    if (!started.ok) {
      throw new Error(started.message);
    }
    await bridge.pollInstall(started.deviceCode);

    const received: unknown[] = [];
    await bridge.start("bot_123", (message) => {
      received.push(message);
    });
    await vi.waitFor(() => expect(received).toHaveLength(1));
    await bridge.stop();

    expect(received[0]).toMatchObject({
      chatId: "wx_chat1",
      messageId: "12345",
      messageType: "text",
      text: "你好"
    });
  });

  it("returns a typed error when polling an unknown QR device code", async () => {
    const bridge = new WechatBridgeRuntime({
      dataDir: dir,
      fetch: vi.fn(async () => jsonResponse({}))
    });

    await expect(bridge.pollInstall("missing-device")).resolves.toEqual({
      done: false,
      error: "扫码状态已过期，请重新生成二维码"
    });
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" }
  });
}
