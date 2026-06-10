import type { FeishuConfig, FeishuStatus, Session } from "@chengxiaobang/shared";
import type { AgentRunner } from "../agent/agent-runner";
import type { StateStore } from "../repository/state-store";
import type {
  FeishuBridge,
  FeishuBridgeFactory,
  FeishuInboundMessage,
  FeishuSender
} from "./feishu-bridge";
import type { FeishuConfigService } from "./feishu-config-service";
import { chunkFeishuText } from "./feishu-text";

const BUSY_REPLY = "上一条消息还在处理中，请稍候再试。";
const UNSUPPORTED_REPLY = "目前只支持文本消息。";
const READ_ONLY_CANCELLED = "该操作需要修改本地文件或执行命令，飞书会话默认只读，已取消。";
const EMPTY_REPLY = "（没有生成回复）";

/**
 * Hosts the Feishu long-connection: inbound messages become headless agent
 * runs on a per-chat session, and the final answer is sent back to Feishu.
 * Runs are read-only by default — mutating tools are auto-denied via the
 * approval queue unless the config opts into full access.
 */
export class FeishuService {
  private bridge?: FeishuBridge;
  private config?: FeishuConfig;
  private status: FeishuStatus = { status: "disconnected" };
  private readonly busyChats = new Set<string>();

  constructor(
    private readonly options: {
      configService: FeishuConfigService;
      store: StateStore;
      runner: AgentRunner;
      bridgeFactory: FeishuBridgeFactory;
    }
  ) {}

  /** Connects when enabled and configured; never throws (boot must survive). */
  async start(): Promise<void> {
    const config = await this.options.configService.load();
    this.config = config;
    if (!config.enabled || !config.appId) {
      this.status = { status: "disconnected" };
      return;
    }
    const appSecret = await this.options.configService.getAppSecret(config);
    if (!appSecret) {
      this.status = { status: "error", error: "未找到飞书 App Secret，请重新保存配置" };
      return;
    }
    this.status = { status: "connecting" };
    try {
      const bridge = this.options.bridgeFactory({
        appId: config.appId,
        appSecret,
        domain: config.domain
      });
      const { botName } = await bridge.connect((message) => {
        void this.handleMessage(message);
      });
      this.bridge = bridge;
      this.status = { status: "connected", ...(botName ? { botName } : {}) };
    } catch (error) {
      this.status = {
        status: "error",
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  async stop(): Promise<void> {
    const bridge = this.bridge;
    this.bridge = undefined;
    this.status = { status: "disconnected" };
    await bridge?.disconnect();
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  getStatus(): FeishuStatus {
    return this.status;
  }

  /** The outbound surface for the feishu_send_message tool, when connected. */
  getSender(): FeishuSender | undefined {
    return this.bridge;
  }

  private async handleMessage(message: FeishuInboundMessage): Promise<void> {
    const bridge = this.bridge;
    const config = this.config;
    if (!bridge || !config) {
      return;
    }
    try {
      // Group chats only respond when the bot is @-mentioned; DMs always do.
      if (message.chatType === "group" && !message.mentionedBot) {
        return;
      }
      if (message.messageType !== "text" || !message.text) {
        await bridge.replyText(message.messageId, UNSUPPORTED_REPLY);
        return;
      }
      if (this.busyChats.has(message.chatId)) {
        await bridge.replyText(message.messageId, BUSY_REPLY);
        return;
      }
      this.busyChats.add(message.chatId);
      try {
        const session = await this.resolveSession(bridge, message, config);
        const reply = await this.runPrompt(session.id, message.text, config.fullAccess);
        await this.reply(bridge, message, reply);
      } finally {
        this.busyChats.delete(message.chatId);
      }
    } catch (error) {
      // One bad message must never kill the dispatcher.
      console.warn("[feishu] 处理消息失败", error);
    }
  }

  /** One session per Feishu chat; created here so feishuChatId gets stamped. */
  private async resolveSession(
    bridge: FeishuBridge,
    message: FeishuInboundMessage,
    config: FeishuConfig
  ): Promise<Session> {
    const existing = await this.options.store.findSessionByFeishuChatId(message.chatId);
    if (existing) {
      return existing;
    }
    const resolved = await bridge.resolveChatTitle(
      message.chatId,
      message.chatType,
      message.senderId
    );
    const fallback = `${message.chatType === "group" ? "群聊" : "私聊"} ${message.chatId.slice(-6)}`;
    return this.options.store.createSession({
      projectId: null,
      title: `飞书 · ${resolved ?? fallback}`,
      accessMode: config.fullAccess ? "full_access" : "approval",
      feishuChatId: message.chatId
    });
  }

  /** Consumes a headless run and folds its events into one reply text. */
  private async runPrompt(
    sessionId: string,
    prompt: string,
    fullAccess: boolean
  ): Promise<string> {
    const texts: string[] = [];
    let errorText: string | undefined;
    let aborted = false;
    try {
      for await (const event of this.options.runner.stream({
        sessionId,
        prompt,
        accessMode: fullAccess ? "full_access" : "approval"
      })) {
        if (event.type === "tool_call_pending" && !fullAccess) {
          // Read-only enforcement: nobody is around to approve, so mutating
          // tools are denied and the model gets the standard rejection text.
          this.options.runner.approvals.decide(event.toolCall.id, false);
        } else if (event.type === "assistant_done") {
          const content = event.message.content.trim();
          if (content) {
            texts.push(content);
          }
        } else if (event.type === "run_error") {
          errorText = event.error;
        } else if (event.type === "run_aborted") {
          aborted = true;
        }
      }
    } catch (error) {
      // stream() can throw before run_started (e.g. no model configured).
      return error instanceof Error ? error.message : String(error);
    }
    if (texts.length > 0) {
      const joined = texts.join("\n\n");
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

  private async reply(
    bridge: FeishuBridge,
    message: FeishuInboundMessage,
    text: string
  ): Promise<void> {
    const chunks = chunkFeishuText(text);
    for (const [index, chunk] of chunks.entries()) {
      if (index === 0) {
        await bridge.replyText(message.messageId, chunk);
      } else {
        await bridge.sendText(message.chatId, chunk);
      }
    }
  }
}
