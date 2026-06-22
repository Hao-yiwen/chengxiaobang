import type { Session, WechatStatus } from "@chengxiaobang/shared";
import type { AgentRunner } from "../agent/agent-runner";
import type { StateStore } from "../repository/state-store";
import type {
  WechatBridge,
  WechatInboundMessage,
  WechatInstallPollResult
} from "./wechat-bridge";
import { wechatConfigFromInstall } from "./wechat-bridge";
import type { WechatConfigService } from "./wechat-config-service";

import { getLogger } from "../logging/logger";

const log = getLogger({ module: "wechat/wechat-service" });

const BUSY_REPLY = "上一条消息还在处理中，请稍候再试。";
const UNSUPPORTED_REPLY = "目前只支持文本消息。";
const READ_ONLY_CANCELLED = "该操作需要修改本地文件或执行命令，微信会话默认只读，已取消。";
const EMPTY_REPLY = "（没有生成回复）";

export class WechatService {
  private status: WechatStatus = { status: "disconnected" };
  private readonly busyChats = new Set<string>();

  constructor(
    private readonly options: {
      configService: WechatConfigService;
      store: StateStore;
      runner: AgentRunner;
      bridge: WechatBridge;
    }
  ) {}

  async start(): Promise<void> {
    const config = await this.options.configService.load();
    if (!config.enabled || !config.accountId) {
      this.status = { status: "disconnected" };
      log.info("[wechat] 微信连接未启用");
      return;
    }
    this.status = { status: "connecting", accountId: config.accountId };
    try {
      await this.options.bridge.start(config.accountId, (message) => {
        void this.handleMessage(message);
      });
      this.status = { status: "connected", accountId: config.accountId };
      log.info("[wechat] 微信连接已启动", { accountId: config.accountId });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.status = { status: "error", accountId: config.accountId, error: message };
      log.warn("[wechat] 微信连接启动失败", {
        accountId: config.accountId,
        error: message
      });
    }
  }

  async stop(): Promise<void> {
    await this.options.bridge.stop();
    this.status = { status: "disconnected" };
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  getStatus(): WechatStatus {
    return this.status;
  }

  startInstall() {
    return this.options.bridge.startInstall();
  }

  async pollInstall(deviceCode: string): Promise<WechatInstallPollResult> {
    return this.options.bridge.pollInstall(deviceCode);
  }

  async saveInstallAndRestart(result: Extract<WechatInstallPollResult, { done: true }>) {
    const config = await this.options.configService.save(wechatConfigFromInstall(result));
    await this.restart();
    const status = this.getStatus();
    log.info("[wechat] 微信扫码连接已保存并重启", {
      accountId: config.accountId,
      status: status.status
    });
    return { config, status };
  }

  private async handleMessage(message: WechatInboundMessage): Promise<void> {
    try {
      if (message.messageType !== "text" || !message.text) {
        await this.safeSendText(message.chatId, UNSUPPORTED_REPLY, "unsupported");
        return;
      }
      if (this.busyChats.has(message.chatId)) {
        await this.safeSendText(message.chatId, BUSY_REPLY, "busy");
        return;
      }
      this.busyChats.add(message.chatId);
      try {
        const session = await this.resolveSession(message);
        const reply = await this.runPrompt(session.id, message.text);
        await this.safeSendText(message.chatId, reply, "reply");
      } finally {
        this.busyChats.delete(message.chatId);
      }
    } catch (error) {
      log.warn("[wechat] 处理微信消息失败", {
        chatId: message.chatId,
        messageId: message.messageId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async resolveSession(message: WechatInboundMessage): Promise<Session> {
    const existing = await this.options.store.findSessionByWechatChatId(message.chatId);
    if (existing) {
      return existing;
    }
    const titleName = message.senderName?.trim() || `联系人 ${message.chatId.slice(-6)}`;
    const session = await this.options.store.createSession({
      projectId: null,
      title: `微信 · ${titleName}`,
      accessMode: "approval",
      wechatChatId: message.chatId
    });
    log.info("[wechat] 已创建微信绑定会话", {
      sessionId: session.id,
      chatId: message.chatId,
      title: session.title
    });
    return session;
  }

  private async runPrompt(sessionId: string, prompt: string): Promise<string> {
    const texts: string[] = [];
    let errorText: string | undefined;
    let aborted = false;
    try {
      for await (const event of this.options.runner.stream(
        {
          sessionId,
          prompt,
          accessMode: "approval",
          planMode: false
        },
        { headless: true }
      )) {
        if (
          event.type === "tool_call" &&
          (event.toolCall.status === "pending_approval" ||
            event.toolCall.status === "pending_smart_approval")
        ) {
          log.info("[wechat] 只读会话自动拒绝工具", {
            toolCallId: event.toolCall.id,
            tool: event.toolCall.name
          });
          this.options.runner.approvals.decide(event.toolCall.id, { approved: false });
        } else if (event.type === "message" && event.message.role === "assistant") {
          const content = event.message.content.trim();
          if (content) {
            texts.push(content);
          }
        } else if (event.type === "run_end" && event.status === "failed") {
          errorText = event.error ?? "未知错误";
        } else if (event.type === "run_end" && event.status === "aborted") {
          aborted = true;
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.warn("[wechat] 微信会话运行失败", { sessionId, error: message });
      return message;
    }
    if (texts.length > 0) {
      const joined = texts.join("\n\n");
      log.info("[wechat] 微信会话运行完成", {
        sessionId,
        chars: joined.length,
        hasError: Boolean(errorText)
      });
      return errorText ? `${joined}\n\n处理出错：${errorText}` : joined;
    }
    if (errorText) {
      return `处理出错：${errorText}`;
    }
    if (aborted) {
      return READ_ONLY_CANCELLED;
    }
    return EMPTY_REPLY;
  }

  private async safeSendText(chatId: string, text: string, reason: string): Promise<void> {
    try {
      await this.options.bridge.sendText(chatId, text);
    } catch (error) {
      log.warn("[wechat] 发送微信回复失败", {
        chatId,
        reason,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
}
