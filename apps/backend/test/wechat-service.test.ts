import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nowIso, type ProviderConfig } from "@chengxiaobang/shared";
import type { Message as PiMessage } from "@earendil-works/pi-ai";
import { AgentRunner } from "../src/agent/agent-runner";
import { SqliteStateStore } from "../src/repository/sqlite-state-store";
import { MemorySecretStore } from "../src/secrets/secret-store";
import { WechatConfigService } from "../src/wechat/wechat-config-service";
import { WechatService } from "../src/wechat/wechat-service";
import { FakeWechatBridge, wechatInbound } from "./helpers/fake-wechat-bridge";
import { scriptedStreamFn, type ScriptedTurn } from "./helpers/scripted-stream";

function flattenContent(message: PiMessage): string {
  if (typeof message.content === "string") {
    return message.content;
  }
  return message.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .filter(Boolean)
    .join("\n");
}

describe("WechatService", () => {
  let dir: string;
  let store: SqliteStateStore;
  let secrets: MemorySecretStore;
  let bridge: FakeWechatBridge;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "cxb-wechat-svc-"));
    store = new SqliteStateStore(join(dir, "state.sqlite"));
    await store.initialize();
    secrets = new MemorySecretStore();
    const apiKeyRef = await secrets.setSecret("deepseek", "test-key");
    const provider: ProviderConfig = {
      id: "deepseek",
      kind: "deepseek",
      name: "DeepSeek",
      baseURL: "https://api.deepseek.com",
      model: "deepseek-v4-flash",
      apiKeyRef,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    await store.upsertProvider(provider);
    bridge = new FakeWechatBridge();
  });

  afterEach(async () => {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  });

  async function createService(turns: ScriptedTurn[] = [{ text: "你好，我是程小帮。" }]) {
    const configService = new WechatConfigService(store);
    await configService.save({
      enabled: true,
      accountId: "wechat_account",
      sessionKey: "wechat_session"
    });
    const scripted = scriptedStreamFn(turns);
    const runner = new AgentRunner(store, secrets, {
      streamFn: scripted.streamFn,
      sessionWorkspacePath: (sessionId) => join(dir, "sessions", sessionId)
    });
    const service = new WechatService({
      configService,
      store,
      runner,
      bridge
    });
    await service.start();
    return { service, calls: scripted.calls, configService };
  }

  it("stays disconnected when WeChat is not enabled", async () => {
    const service = new WechatService({
      configService: new WechatConfigService(store),
      store,
      runner: new AgentRunner(store, secrets),
      bridge
    });

    await service.start();

    expect(service.getStatus()).toEqual({ status: "disconnected" });
    expect(bridge.startedAccountId).toBeUndefined();
  });

  it("starts, polls, saves and restarts the QR install result", async () => {
    const configService = new WechatConfigService(store);
    const service = new WechatService({
      configService,
      store,
      runner: new AgentRunner(store, secrets),
      bridge
    });

    await expect(service.startInstall()).resolves.toMatchObject({
      ok: true,
      target: "wechat",
      deviceCode: "wechat-device"
    });
    const pollResult = await service.pollInstall("wechat-device");
    expect(pollResult).toMatchObject({ done: true, accountId: "wechat_account" });
    const saved = await service.saveInstallAndRestart(pollResult as Extract<typeof pollResult, { done: true }>);

    expect(saved.config).toMatchObject({
      enabled: true,
      accountId: "wechat_account",
      sessionKey: "wechat_session"
    });
    expect(saved.status).toMatchObject({ status: "connected", accountId: "wechat_account" });
    expect(bridge.startedAccountId).toBe("wechat_account");
  });

  it("answers a WeChat text message in a dedicated session bound to the contact", async () => {
    const { service } = await createService([{ text: "你好，我是程小帮。" }]);
    expect(service.getStatus()).toMatchObject({ status: "connected", accountId: "wechat_account" });

    bridge.emit(wechatInbound({ text: "你是谁" }));
    await vi.waitFor(() => expect(bridge.sent).toHaveLength(1), { timeout: 5_000 });

    expect(bridge.sent[0]).toEqual({ chatId: "wx_chat1", text: "你好，我是程小帮。" });
    const session = await store.findSessionByWechatChatId("wx_chat1");
    expect(session).toMatchObject({ title: "微信 · 小王", wechatChatId: "wx_chat1" });
  });

  it("reuses the WeChat session so the model sees prior turns", async () => {
    const { calls } = await createService([{ text: "第一答" }, { text: "第二答" }]);

    bridge.emit(wechatInbound({ text: "第一问", messageId: "wx_msg1" }));
    await vi.waitFor(() => expect(bridge.sent).toHaveLength(1));
    bridge.emit(wechatInbound({ text: "第二问", messageId: "wx_msg2" }));
    await vi.waitFor(() => expect(bridge.sent).toHaveLength(2));

    expect((await store.listSessions()).filter((session) => session.wechatChatId)).toHaveLength(1);
    const secondCall = calls[1]?.context.messages ?? [];
    const joined = secondCall.map(flattenContent).join("\n");
    expect(joined).toContain("第一问");
    expect(joined).toContain("第一答");
    expect(joined).toContain("第二问");
  });

  it("auto-denies mutating tools for WeChat read-only runs", async () => {
    const { calls } = await createService([
      {
        toolCalls: [
          { id: "call_1", name: "Write", arguments: { file_path: "a.txt", content: "x" } }
        ]
      },
      { text: "好的，那我只说结论。" }
    ]);

    bridge.emit(wechatInbound({ text: "写个文件" }));
    await vi.waitFor(() => expect(bridge.sent).toHaveLength(1), { timeout: 5_000 });

    expect(bridge.sent[0].text).toBe("好的，那我只说结论。");
    const session = await store.findSessionByWechatChatId("wx_chat1");
    const toolCalls = await store.listToolCallsForSession(session!.id);
    expect(toolCalls[0]).toMatchObject({ name: "Write", status: "rejected" });
    expect(calls[1]?.context.messages.map(flattenContent).join("\n")).toContain("用户拒绝");
  });

  it("politely declines non-text WeChat messages", async () => {
    await createService([{ text: "不该出现" }]);

    bridge.emit(wechatInbound({ messageType: "unsupported", text: "" }));
    await vi.waitFor(() => expect(bridge.sent).toHaveLength(1));

    expect(bridge.sent[0].text).toContain("只支持文本消息");
  });

  it("tells the contact when the previous WeChat run is still busy", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await createService([{ text: "慢吞吞的回答", onStart: () => gate }]);

    bridge.emit(wechatInbound({ text: "第一条", messageId: "wx_msg1" }));
    await vi.waitFor(async () =>
      expect(await store.findSessionByWechatChatId("wx_chat1")).toBeDefined()
    );
    bridge.emit(wechatInbound({ text: "第二条", messageId: "wx_msg2" }));
    await vi.waitFor(() =>
      expect(bridge.sent.some((entry) => entry.text.includes("还在处理中"))).toBe(true)
    );
    release?.();
    await vi.waitFor(() =>
      expect(bridge.sent.some((entry) => entry.text === "慢吞吞的回答")).toBe(true)
    );
  });
});
