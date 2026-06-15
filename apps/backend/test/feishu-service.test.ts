import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nowIso, type ProviderConfig } from "@chengxiaobang/shared";
import type { Message as PiMessage } from "@earendil-works/pi-ai";
import { AgentRunner } from "../src/agent/agent-runner";
import { FeishuConfigService } from "../src/feishu/feishu-config-service";
import { FeishuService } from "../src/feishu/feishu-service";
import { chunkFeishuText } from "../src/feishu/feishu-text";
import { SqliteStateStore } from "../src/repository/sqlite-state-store";
import { MemorySecretStore } from "../src/secrets/secret-store";
import { FakeFeishuBridge, inbound } from "./helpers/fake-feishu-bridge";
import { scriptedStreamFn, type ScriptedTurn } from "./helpers/scripted-stream";

/** Flatten a captured pi message to plain text for content assertions. */
function flattenContent(message: PiMessage): string {
  if (typeof message.content === "string") {
    return message.content;
  }
  return message.content
    .map((block) => {
      if (block.type === "text") {
        return block.text;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

describe("FeishuService", () => {
  let dir: string;
  let store: SqliteStateStore;
  let secrets: MemorySecretStore;
  let bridge: FakeFeishuBridge;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "cxb-feishu-svc-"));
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
    bridge = new FakeFeishuBridge();
  });

  afterEach(async () => {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  });

  async function createService(
    turns: ScriptedTurn[],
    options: { fullAccess?: boolean } = {}
  ): Promise<{ service: FeishuService; calls: ReturnType<typeof scriptedStreamFn>["calls"] }> {
    const configService = new FeishuConfigService(store, secrets);
    await configService.save({
      enabled: true,
      appId: "cli_a1",
      appSecret: "secret",
      domain: "feishu",
      fullAccess: options.fullAccess ?? false
    });
    const scripted = scriptedStreamFn(turns);
    const runner = new AgentRunner(store, secrets, {
      streamFn: scripted.streamFn,
      sessionWorkspacePath: (sessionId) => join(dir, "sessions", sessionId)
    });
    const service = new FeishuService({
      configService,
      store,
      runner,
      bridgeFactory: () => bridge
    });
    await service.start();
    return { service, calls: scripted.calls };
  }

  it("stays disconnected when not enabled", async () => {
    const configService = new FeishuConfigService(store, secrets);
    const runner = new AgentRunner(store, secrets);
    const service = new FeishuService({
      configService,
      store,
      runner,
      bridgeFactory: () => bridge
    });
    await service.start();
    expect(service.getStatus()).toEqual({ status: "disconnected" });
    expect(bridge.connected).toBe(false);
    expect(service.getSender()).toBeUndefined();
  });

  it("answers a DM in a dedicated session bound to the chat", async () => {
    const { service } = await createService([{ text: "你好，我是程小帮。" }]);
    expect(service.getStatus()).toMatchObject({ status: "connected", botName: "测试机器人" });

    bridge.emit(inbound({ text: "你是谁" }));
    await vi.waitFor(() => expect(bridge.replied).toHaveLength(1));

    expect(bridge.replied[0]).toEqual({ messageId: "om_1", text: "你好，我是程小帮。" });
    const session = await store.findSessionByFeishuChatId("oc_chat1");
    expect(session).toMatchObject({ title: "飞书 · 张三", feishuChatId: "oc_chat1" });
  });

  it("falls back to an id-based title when name resolution fails", async () => {
    bridge.chatTitle = undefined;
    await createService([{ text: "好的" }]);

    bridge.emit(inbound({ chatId: "oc_abcdef123456", chatType: "group", mentionedBot: true }));
    await vi.waitFor(() => expect(bridge.replied).toHaveLength(1));

    const session = await store.findSessionByFeishuChatId("oc_abcdef123456");
    expect(session?.title).toBe("飞书 · 群聊 123456");
  });

  it("ignores group messages that do not mention the bot", async () => {
    await createService([{ text: "不该出现" }]);

    bridge.emit(inbound({ chatType: "group", mentionedBot: false }));
    // Give the async handler a beat; nothing should happen.
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(bridge.replied).toHaveLength(0);
    expect(bridge.sent).toHaveLength(0);
    expect(await store.findSessionByFeishuChatId("oc_chat1")).toBeUndefined();
  });

  it("answers group messages when the bot is mentioned", async () => {
    await createService([{ text: "在的" }]);

    bridge.emit(inbound({ chatType: "group", mentionedBot: true }));
    await vi.waitFor(() => expect(bridge.replied).toHaveLength(1));
    expect(bridge.replied[0].text).toBe("在的");
  });

  it("reuses the chat session so the model sees prior turns", async () => {
    const { calls } = await createService([{ text: "第一答" }, { text: "第二答" }]);

    bridge.emit(inbound({ text: "第一问", messageId: "om_1" }));
    await vi.waitFor(() => expect(bridge.replied).toHaveLength(1));
    bridge.emit(inbound({ text: "第二问", messageId: "om_2" }));
    await vi.waitFor(() => expect(bridge.replied).toHaveLength(2));

    expect((await store.listSessions()).filter((s) => s.feishuChatId)).toHaveLength(1);
    const secondCall = calls[1]?.context.messages ?? [];
    const joined = secondCall.map(flattenContent).join("\n");
    expect(joined).toContain("第一问");
    expect(joined).toContain("第一答");
    expect(joined).toContain("第二问");
  });

  it("auto-denies mutating tools in read-only mode and the model recovers", async () => {
    const { calls } = await createService([
      {
        toolCalls: [
          { id: "call_1", name: "Write", arguments: { file_path: "a.txt", content: "x" } }
        ]
      },
      { text: "好的，那我只说结论。" }
    ]);

    bridge.emit(inbound({ text: "写个文件" }));
    await vi.waitFor(() => expect(bridge.replied).toHaveLength(1));

    expect(bridge.replied[0].text).toBe("好的，那我只说结论。");
    const session = await store.findSessionByFeishuChatId("oc_chat1");
    const toolCalls = await store.listToolCallsForSession(session!.id);
    expect(toolCalls[0]).toMatchObject({ name: "Write", status: "rejected" });
    // The rejection text was fed back to the model.
    const secondCall = calls[1]?.context.messages ?? [];
    expect(secondCall.map(flattenContent).join("\n")).toContain("用户拒绝");
  });

  it("executes mutating tools when full access is enabled", async () => {
    await createService(
      [
        {
          toolCalls: [
            { id: "call_1", name: "Write", arguments: { file_path: "a.txt", content: "x" } }
          ]
        },
        { text: "已写入。" }
      ],
      { fullAccess: true }
    );

    bridge.emit(inbound({ text: "写个文件" }));
    await vi.waitFor(() => expect(bridge.replied).toHaveLength(1));

    const session = await store.findSessionByFeishuChatId("oc_chat1");
    const toolCalls = await store.listToolCallsForSession(session!.id);
    expect(toolCalls[0]).toMatchObject({ name: "Write", status: "completed" });
  });

  it("chunks long replies across multiple messages", async () => {
    const longAnswer = Array.from(
      { length: 300 },
      (_, i) => `第${i}行：${"内容".repeat(12)}`
    ).join("\n");
    await createService([{ text: longAnswer }]);

    bridge.emit(inbound({ text: "长回答" }));
    await vi.waitFor(() => expect(bridge.replied.length + bridge.sent.length).toBeGreaterThan(1));
    await vi.waitFor(() =>
      expect(
        (bridge.replied.map((r) => r.text).join("\n") + "\n" + bridge.sent.map((s) => s.text).join("\n")).length
      ).toBeGreaterThanOrEqual(longAnswer.length)
    );

    expect(bridge.replied).toHaveLength(1);
    expect(bridge.sent.length).toBeGreaterThanOrEqual(1);
    expect(bridge.sent.every((entry) => entry.chatId === "oc_chat1")).toBe(true);
  });

  it("reports run errors back to the chat", async () => {
    await createService([{ error: "模型挂了" }]);

    bridge.emit(inbound({ text: "你好" }));
    await vi.waitFor(() => expect(bridge.replied).toHaveLength(1));
    expect(bridge.replied[0].text).toContain("处理出错");
    expect(bridge.replied[0].text).toContain("模型挂了");
  });

  it("tells the user when the chat is busy with a previous run", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await createService([{ text: "慢吞吞的回答", onStart: () => gate }]);

    bridge.emit(inbound({ text: "第一条", messageId: "om_1" }));
    // Wait until the first run is in flight (session exists), then send another.
    await vi.waitFor(async () =>
      expect(await store.findSessionByFeishuChatId("oc_chat1")).toBeDefined()
    );
    bridge.emit(inbound({ text: "第二条", messageId: "om_2" }));
    await vi.waitFor(() =>
      expect(bridge.replied.some((r) => r.text.includes("还在处理中"))).toBe(true)
    );
    release?.();
    await vi.waitFor(() =>
      expect(bridge.replied.some((r) => r.text === "慢吞吞的回答")).toBe(true)
    );
  });

  it("politely declines non-text messages", async () => {
    await createService([{ text: "不该出现" }]);

    bridge.emit(inbound({ messageType: "image", text: "" }));
    await vi.waitFor(() => expect(bridge.replied).toHaveLength(1));
    expect(bridge.replied[0].text).toContain("只支持文本消息");
  });
});

describe("chunkFeishuText", () => {
  it("returns short text as a single chunk", () => {
    expect(chunkFeishuText("你好")).toEqual(["你好"]);
  });

  it("splits on newline boundaries below the limit", () => {
    const text = `${"a".repeat(10)}\n${"b".repeat(10)}\n${"c".repeat(10)}`;
    const chunks = chunkFeishuText(text, 25);
    expect(chunks).toEqual(["a".repeat(10) + "\n" + "b".repeat(10), "c".repeat(10)]);
  });

  it("hard-splits text without newlines", () => {
    const chunks = chunkFeishuText("x".repeat(10), 4);
    expect(chunks).toEqual(["xxxx", "xxxx", "xx"]);
    expect(chunks.join("")).toBe("x".repeat(10));
  });
});
