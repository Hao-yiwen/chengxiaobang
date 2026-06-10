import type {
  FeishuBridge,
  FeishuInboundMessage
} from "../../src/feishu/feishu-bridge";

/** In-memory bridge double: records outbound traffic, lets tests emit inbound. */
export class FakeFeishuBridge implements FeishuBridge {
  sent: Array<{ chatId: string; text: string }> = [];
  replied: Array<{ messageId: string; text: string }> = [];
  connected = false;
  botName: string | undefined = "测试机器人";
  chatTitle: string | undefined = "张三";
  private onMessage?: (message: FeishuInboundMessage) => void;

  async connect(onMessage: (message: FeishuInboundMessage) => void) {
    this.onMessage = onMessage;
    this.connected = true;
    return { botName: this.botName };
  }

  async disconnect() {
    this.onMessage = undefined;
    this.connected = false;
  }

  async sendText(chatId: string, text: string) {
    this.sent.push({ chatId, text });
  }

  async replyText(messageId: string, text: string) {
    this.replied.push({ messageId, text });
  }

  async resolveChatTitle() {
    return this.chatTitle;
  }

  emit(message: FeishuInboundMessage) {
    this.onMessage?.(message);
  }
}

export function inbound(partial: Partial<FeishuInboundMessage> = {}): FeishuInboundMessage {
  return {
    chatId: "oc_chat1",
    chatType: "p2p",
    text: "你好",
    senderId: "ou_sender",
    mentionedBot: false,
    messageId: "om_1",
    messageType: "text",
    ...partial
  };
}
