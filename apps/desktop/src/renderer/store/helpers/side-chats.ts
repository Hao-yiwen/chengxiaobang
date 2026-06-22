import type { Message, SideChatSummary } from "@chengxiaobang/shared";

/** 把后端侧边会话摘要转成按锚点消息 id 索引，便于消息侧边标记 O(1) 判断状态。 */
export function indexSideChatsByMessageId(
  sideChats: SideChatSummary[]
): Record<string, SideChatSummary> {
  return Object.fromEntries(sideChats.map((sideChat) => [sideChat.anchorMessageId, sideChat]));
}

/** 右侧面板发起侧边会话时，绑定当前主会话里最近一条可追问的普通消息。 */
export function latestSideChatAnchorMessage(
  messages: Message[],
  activeSessionId: string | undefined
): Message | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (
      !message ||
      message.sessionId !== activeSessionId ||
      message.kind === "compaction_summary"
    ) {
      continue;
    }
    if (message.role === "user") {
      return message;
    }
    if (message.role === "assistant" && message.content.trim()) {
      return message;
    }
  }
  return undefined;
}
