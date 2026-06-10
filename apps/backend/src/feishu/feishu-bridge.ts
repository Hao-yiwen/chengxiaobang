import * as Lark from "@larksuiteoapi/node-sdk";
import type { FeishuDomain } from "@chengxiaobang/shared";

/** A normalized inbound Feishu IM message (text already mention-stripped). */
export interface FeishuInboundMessage {
  chatId: string;
  chatType: "p2p" | "group";
  text: string;
  senderId: string;
  mentionedBot: boolean;
  messageId: string;
  messageType: string;
}

/** The outbound surface the agent tool needs (subset of the full bridge). */
export interface FeishuSender {
  sendText(chatId: string, text: string): Promise<void>;
}

/**
 * Thin seam over the Lark SDK so FeishuService is testable with a fake:
 * one WebSocket long-connection per configured bot.
 */
export interface FeishuBridge extends FeishuSender {
  connect(onMessage: (message: FeishuInboundMessage) => void): Promise<{ botName?: string }>;
  disconnect(): Promise<void>;
  replyText(messageId: string, text: string): Promise<void>;
  resolveChatTitle(
    chatId: string,
    chatType: FeishuInboundMessage["chatType"],
    senderId: string
  ): Promise<string | undefined>;
}

export type FeishuBridgeFactory = (config: {
  appId: string;
  appSecret: string;
  domain: FeishuDomain;
}) => FeishuBridge;

export const createLarkBridge: FeishuBridgeFactory = ({ appId, appSecret, domain }) => {
  const larkDomain = domain === "lark" ? Lark.Domain.Lark : Lark.Domain.Feishu;
  const client = new Lark.Client({
    appId,
    appSecret,
    domain: larkDomain,
    loggerLevel: Lark.LoggerLevel.warn
  });
  let wsClient: Lark.WSClient | undefined;
  let botOpenId: string | undefined;
  // Bumped on connect/disconnect so callbacks from a stale WSClient instance
  // are dropped — the SDK does not guarantee a stop() across versions.
  let generation = 0;

  return {
    async connect(onMessage) {
      const activeGeneration = ++generation;
      let botName: string | undefined;
      try {
        // Validates the credentials up front and learns the bot identity for
        // group @-mention detection.
        const info = (await client.request({
          method: "GET",
          url: "/open-apis/bot/v3/info"
        })) as { bot?: { open_id?: string; app_name?: string } } & {
          data?: { bot?: { open_id?: string; app_name?: string } };
        };
        const bot = info.bot ?? info.data?.bot;
        botOpenId = bot?.open_id;
        botName = bot?.app_name;
      } catch (error) {
        throw new Error(
          `无法获取机器人信息，请检查 App ID / App Secret：${errorMessage(error)}`
        );
      }
      const eventDispatcher = new Lark.EventDispatcher({}).register({
        "im.message.receive_v1": (data) => {
          if (activeGeneration !== generation) {
            return;
          }
          const normalized = normalizeInbound(data, botOpenId);
          if (normalized) {
            onMessage(normalized);
          }
        }
      });
      wsClient = new Lark.WSClient({
        appId,
        appSecret,
        domain: larkDomain,
        loggerLevel: Lark.LoggerLevel.warn
      });
      wsClient.start({ eventDispatcher });
      return { botName };
    },

    async disconnect() {
      generation += 1;
      const ws = wsClient as { stop?: () => void } | undefined;
      wsClient = undefined;
      try {
        ws?.stop?.();
      } catch {
        // Worst case a dead socket lingers until the backend process exits.
      }
    },

    async sendText(chatId, text) {
      await client.im.message.create({
        params: { receive_id_type: "chat_id" },
        data: { receive_id: chatId, msg_type: "text", content: JSON.stringify({ text }) }
      });
    },

    async replyText(messageId, text) {
      await client.im.message.reply({
        path: { message_id: messageId },
        data: { msg_type: "text", content: JSON.stringify({ text }) }
      });
    },

    async resolveChatTitle(chatId, chatType, senderId) {
      // Best-effort only — requires im:chat / contact scopes the user may not
      // have granted. Callers fall back to an id-based title.
      try {
        if (chatType === "group") {
          const res = (await client.im.chat.get({ path: { chat_id: chatId } })) as {
            data?: { name?: string };
          };
          return res.data?.name || undefined;
        }
        const res = (await client.contact.user.get({
          path: { user_id: senderId },
          params: { user_id_type: "open_id" }
        })) as { data?: { user?: { name?: string } } };
        return res.data?.user?.name || undefined;
      } catch {
        return undefined;
      }
    }
  };
};

/**
 * Normalizes a raw im.message.receive_v1 event. Returns undefined for events
 * that should never reach the service (no chat id, non-user senders).
 * Exported for unit tests.
 */
export function normalizeInbound(
  data: unknown,
  botOpenId: string | undefined
): FeishuInboundMessage | undefined {
  const event = (data ?? {}) as {
    sender?: { sender_id?: { open_id?: string }; sender_type?: string };
    message?: {
      message_id?: string;
      chat_id?: string;
      chat_type?: string;
      message_type?: string;
      content?: string;
      mentions?: Array<{ key?: string; id?: { open_id?: string } }>;
    };
  };
  const message = event.message;
  if (!message?.chat_id || !message.message_id) {
    return undefined;
  }
  // Drop echoes from bots (including ourselves) — only humans drive runs.
  if (event.sender?.sender_type && event.sender.sender_type !== "user") {
    return undefined;
  }
  const mentions = message.mentions ?? [];
  // Unknown bot identity degrades to "any mention counts" (noted risk).
  const mentionedBot = botOpenId
    ? mentions.some((mention) => mention.id?.open_id === botOpenId)
    : mentions.length > 0;
  let text = "";
  if (message.message_type === "text") {
    try {
      text = String((JSON.parse(message.content ?? "{}") as { text?: string }).text ?? "");
    } catch {
      text = "";
    }
    for (const mention of mentions) {
      if (mention.key) {
        text = text.split(mention.key).join("");
      }
    }
    text = text.trim();
  }
  return {
    chatId: message.chat_id,
    chatType: message.chat_type === "group" ? "group" : "p2p",
    text,
    senderId: event.sender?.sender_id?.open_id ?? "",
    mentionedBot,
    messageId: message.message_id,
    messageType: message.message_type ?? "unknown"
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
