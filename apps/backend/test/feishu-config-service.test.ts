import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FeishuConfigService } from "../src/feishu/feishu-config-service";
import { normalizeInbound } from "../src/feishu/feishu-bridge";
import { SqliteStateStore } from "../src/repository/sqlite-state-store";
import { MemorySecretStore } from "../src/secrets/secret-store";

describe("FeishuConfigService", () => {
  let dir: string;
  let store: SqliteStateStore;
  let secrets: MemorySecretStore;
  let service: FeishuConfigService;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "cxb-feishu-"));
    store = new SqliteStateStore(join(dir, "state.sqlite"));
    await store.initialize();
    secrets = new MemorySecretStore();
    service = new FeishuConfigService(store, secrets);
  });

  afterEach(async () => {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("returns defaults when nothing is stored or the value is corrupt", async () => {
    await expect(service.load()).resolves.toMatchObject({
      enabled: false,
      appId: "",
      domain: "feishu",
      fullAccess: false
    });

    await store.setSetting("feishu", "{not json");
    await expect(service.load()).resolves.toMatchObject({ enabled: false });
  });

  it("stores the secret in the secret store, never in the settings value", async () => {
    const config = await service.save({
      enabled: true,
      appId: "cli_a1",
      appSecret: "super-secret",
      domain: "feishu",
      fullAccess: false
    });

    expect(config.appSecretRef).toBe("memory:feishu");
    const raw = await store.getSetting("feishu");
    expect(raw).not.toContain("super-secret");
    expect(raw).toContain("memory:feishu");
    await expect(service.getAppSecret(config)).resolves.toBe("super-secret");
  });

  it("keeps the existing secret when saving with an empty secret field", async () => {
    await service.save({
      enabled: true,
      appId: "cli_a1",
      appSecret: "first-secret",
      domain: "feishu",
      fullAccess: false
    });

    const updated = await service.save({
      enabled: true,
      appId: "cli_a1",
      appSecret: "",
      domain: "lark",
      fullAccess: true
    });

    expect(updated).toMatchObject({
      domain: "lark",
      fullAccess: true,
      appSecretRef: "memory:feishu"
    });
    await expect(service.getAppSecret(updated)).resolves.toBe("first-secret");
  });
});

describe("normalizeInbound", () => {
  const baseEvent = {
    sender: { sender_id: { open_id: "ou_sender" }, sender_type: "user" },
    message: {
      message_id: "om_1",
      chat_id: "oc_1",
      chat_type: "group",
      message_type: "text",
      content: JSON.stringify({ text: "@_user_1 帮我看看" }),
      mentions: [{ key: "@_user_1", id: { open_id: "ou_bot" } }]
    }
  };

  it("strips mention placeholders and detects the bot mention", () => {
    const message = normalizeInbound(baseEvent, "ou_bot");
    expect(message).toMatchObject({
      chatId: "oc_1",
      chatType: "group",
      text: "帮我看看",
      senderId: "ou_sender",
      mentionedBot: true,
      messageType: "text"
    });
  });

  it("does not flag mentions of other users as bot mentions", () => {
    const message = normalizeInbound(baseEvent, "ou_someone_else");
    expect(message?.mentionedBot).toBe(false);
  });

  it("treats any mention as a bot mention when the bot identity is unknown", () => {
    expect(normalizeInbound(baseEvent, undefined)?.mentionedBot).toBe(true);
  });

  it("drops non-user senders and malformed events", () => {
    expect(
      normalizeInbound({ ...baseEvent, sender: { sender_type: "app" } }, "ou_bot")
    ).toBeUndefined();
    expect(normalizeInbound({ message: {} }, "ou_bot")).toBeUndefined();
    expect(normalizeInbound(undefined, "ou_bot")).toBeUndefined();
  });

  it("keeps non-text messages with an empty text and the original type", () => {
    const message = normalizeInbound(
      {
        ...baseEvent,
        message: { ...baseEvent.message, message_type: "image", content: "{}" }
      },
      "ou_bot"
    );
    expect(message).toMatchObject({ text: "", messageType: "image" });
  });
});
