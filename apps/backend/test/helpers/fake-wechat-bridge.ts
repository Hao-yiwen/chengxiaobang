import type {
  WechatBridge,
  WechatInboundMessage,
  WechatInstallPollResult
} from "../../src/wechat/wechat-bridge";

/** 内存版微信 bridge：记录出站消息，并允许单测主动注入入站消息。 */
export class FakeWechatBridge implements WechatBridge {
  sent: Array<{ chatId: string; text: string }> = [];
  startedAccountId: string | undefined;
  stopped = false;
  startInstallResult = {
    ok: true as const,
    target: "wechat" as const,
    url: "data:image/png;base64,ZmFrZQ==",
    deviceCode: "wechat-device",
    userCode: "",
    interval: 3,
    expiresIn: 120
  };
  pollInstallResult: WechatInstallPollResult = {
    done: true,
    accountId: "wechat_account",
    sessionKey: "wechat_session",
    userId: "wx_user"
  };
  private onMessage?: (message: WechatInboundMessage) => void;

  async startInstall() {
    return this.startInstallResult;
  }

  async pollInstall() {
    return this.pollInstallResult;
  }

  async start(accountId: string, onMessage: (message: WechatInboundMessage) => void) {
    this.startedAccountId = accountId;
    this.stopped = false;
    this.onMessage = onMessage;
  }

  async stop() {
    this.stopped = true;
    this.onMessage = undefined;
  }

  async sendText(chatId: string, content: string) {
    this.sent.push({ chatId, text: content });
  }

  emit(message: WechatInboundMessage) {
    this.onMessage?.(message);
  }
}

export function wechatInbound(
  partial: Partial<WechatInboundMessage> = {}
): WechatInboundMessage {
  return {
    chatId: "wx_chat1",
    messageId: "wx_msg1",
    messageType: "text",
    text: "你好",
    senderName: "小王",
    ...partial
  };
}
