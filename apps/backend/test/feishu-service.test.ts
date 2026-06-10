import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nowIso, type ProviderConfig } from "@chengxiaobang/shared";
import { AgentRunner } from "../src/agent/agent-runner";
import { FeishuConfigService } from "../src/feishu/feishu-config-service";
import { FeishuService } from "../src/feishu/feishu-service";
import { chunkFeishuText } from "../src/feishu/feishu-text";
import type { ModelClient, ModelDelta, ModelMessage } from "../src/model/openai-compatible";
import { SqliteStateStore } from "../src/repository/sqlite-state-store";
import { MemorySecretStore } from "../src/secrets/secret-store";
import { FakeFeishuBridge, inbound } from "./helpers/fake-feishu-bridge";

/** A scripted model that records what it was asked and replays baked turns. */
function scriptedModel(turns: ModelDelta[][]): ModelClient & { seen: ModelMessage[][] } {
  let index = 0;
  const seen: ModelMessage[][] = [];
  return {
    seen,
    async *streamCompletion(input) {
      seen.push(input.messages);
      const turn = turns[Math.min(index, turns.length - 1)];
      index += 1;
      for (const delta of turn) {
        yield delta;
      }
    },
    async testProvider() {}
  };
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
    model: ModelClient,
    options: { fullAccess?: boolean } = {}
  ): Promise<FeishuService> {
    const configService = new FeishuConfigService(store, secrets);
    await configService.save({
      enabled: true,
      appId: "cli_a1",
      appSecret: "secret",
      domain: "feishu",
      fullAccess: options.fullAccess ?? false
    });
    const runner = new AgentRunner(
      store,
      secrets,
      model,
      undefined,
      (sessionId) => join(dir, "sessions", sessionId)
    );
    const service = new FeishuService({
      configService,
      store,
      runner,
      bridgeFactory: () => bridge
    });
    await service.start();
    return service;
  }

  it("stays disconnected when not enabled", async () => {
    const configService = new FeishuConfigService(store, secrets);
    const runner = new AgentRunner(store, secrets, scriptedModel([[]]));
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
    const model = scriptedModel([[{ type: "text", delta: "你好，我是程小帮。" }]]);
    const service = await createService(model);
    expect(service.getStatus()).toMatchObject({ status: "connected", botName: "测试机器人" });

    bridge.emit(inbound({ text: "你是谁" }));
    await vi.waitFor(() => expect(bridge.replied).toHaveLength(1));

    expect(bridge.replied[0]).toEqual({ messageId: "om_1", text: "你好，我是程小帮。" });
    const session = await store.findSessionByFeishuChatId("oc_chat1");
    expect(session).toMatchObject({ title: "飞书 · 张三", feishuChatId: "oc_chat1" });
  });

  it("falls back to an id-based title when name resolution fails", async () => {
    bridge.chatTitle = undefined;
    const model = scriptedModel([[{ type: "text", delta: "好的" }]]);
    const service = await createService(model);
    void service;

    bridge.emit(inbound({ chatId: "oc_abcdef123456", chatType: "group", mentionedBot: true }));
    await vi.waitFor(() => expect(bridge.replied).toHaveLength(1));

    const session = await store.findSessionByFeishuChatId("oc_abcdef123456");
    expect(session?.title).toBe("飞书 · 群聊 123456");
  });

  it("ignores group messages that do not mention the bot", async () => {
    const model = scriptedModel([[{ type: "text", delta: "不该出现" }]]);
    await createService(model);

    bridge.emit(inbound({ chatType: "group", mentionedBot: false }));
    // Give the async handler a beat; nothing should happen.
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(bridge.replied).toHaveLength(0);
    expect(bridge.sent).toHaveLength(0);
    expect(await store.findSessionByFeishuChatId("oc_chat1")).toBeUndefined();
  });

  it("answers group messages when the bot is mentioned", async () => {
    const model = scriptedModel([[{ type: "text", delta: "在的" }]]);
    await createService(model);

    bridge.emit(inbound({ chatType: "group", mentionedBot: true }));
    await vi.waitFor(() => expect(bridge.replied).toHaveLength(1));
    expect(bridge.replied[0].text).toBe("在的");
  });

  it("reuses the chat session so the model sees prior turns", async () => {
    const model = scriptedModel([
      [{ type: "text", delta: "第一答" }],
      [{ type: "text", delta: "第二答" }]
    ]);
    await createService(model);

    bridge.emit(inbound({ text: "第一问", messageId: "om_1" }));
    await vi.waitFor(() => expect(bridge.replied).toHaveLength(1));
    bridge.emit(inbound({ text: "第二问", messageId: "om_2" }));
    await vi.waitFor(() => expect(bridge.replied).toHaveLength(2));

    expect((await store.listSessions()).filter((s) => s.feishuChatId)).toHaveLength(1);
    const secondCall = model.seen[1] ?? [];
    const joined = secondCall.map((message) => message.content).join("\n");
    expect(joined).toContain("第一问");
    expect(joined).toContain("第一答");
    expect(joined).toContain("第二问");
  });

  it("auto-denies mutating tools in read-only mode and the model recovers", async () => {
    const model = scriptedModel([
      [
        {
          type: "tool_calls",
          toolCalls: [
            {
              id: "call_1",
              name: "write_file",
              arguments: JSON.stringify({ path: "a.txt", content: "x" })
            }
          ]
        }
      ],
      [{ type: "text", delta: "好的，那我只说结论。" }]
    ]);
    await createService(model);

    bridge.emit(inbound({ text: "写个文件" }));
    await vi.waitFor(() => expect(bridge.replied).toHaveLength(1));

    expect(bridge.replied[0].text).toBe("好的，那我只说结论。");
    const session = await store.findSessionByFeishuChatId("oc_chat1");
    const toolCalls = await store.listToolCallsForSession(session!.id);
    expect(toolCalls[0]).toMatchObject({ name: "write_file", status: "rejected" });
    // The rejection text was fed back to the model.
    const secondCall = model.seen[1] ?? [];
    expect(secondCall.map((m) => m.content).join("\n")).toContain("用户拒绝");
  });

  it("executes mutating tools when full access is enabled", async () => {
    const model = scriptedModel([
      [
        {
          type: "tool_calls",
          toolCalls: [
            {
              id: "call_1",
              name: "write_file",
              arguments: JSON.stringify({ path: "a.txt", content: "x" })
            }
          ]
        }
      ],
      [{ type: "text", delta: "已写入。" }]
    ]);
    await createService(model, { fullAccess: true });

    bridge.emit(inbound({ text: "写个文件" }));
    await vi.waitFor(() => expect(bridge.replied).toHaveLength(1));

    const session = await store.findSessionByFeishuChatId("oc_chat1");
    const toolCalls = await store.listToolCallsForSession(session!.id);
    expect(toolCalls[0]).toMatchObject({ name: "write_file", status: "completed" });
  });

  it("chunks long replies across multiple messages", async () => {
    const longAnswer = Array.from(
      { length: 300 },
      (_, i) => `第${i}行：${"内容".repeat(12)}`
    ).join("\n");
    const model = scriptedModel([[{ type: "text", delta: longAnswer }]]);
    await createService(model);

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
    const model: ModelClient = {
      // eslint-disable-next-line require-yield
      async *streamCompletion() {
        throw new Error("模型挂了");
      },
      async testProvider() {}
    };
    await createService(model);

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
    const model: ModelClient = {
      async *streamCompletion() {
        await gate;
        yield { type: "text", delta: "慢吞吞的回答" };
      },
      async testProvider() {}
    };
    await createService(model);

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
    const model = scriptedModel([[{ type: "text", delta: "不该出现" }]]);
    await createService(model);

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
