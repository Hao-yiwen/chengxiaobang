import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { FeishuSender } from "../feishu/feishu-bridge";
import { textResult } from "./tool-result";

const sendMessageParams = Type.Object({
  chatId: Type.String({ description: "飞书会话 chat_id（通常以 oc_ 开头）" }),
  content: Type.String({ description: "要发送的文本内容" })
});

export function createFeishuTools(
  getFeishuSender?: () => FeishuSender | undefined
): AgentTool<any>[] {
  const sendMessage: AgentTool<typeof sendMessageParams> = {
    name: "feishu_send_message",
    label: "发送飞书消息",
    description:
      "将一条文本消息主动发送到飞书群聊或私聊。需要用户已在设置中配置并启用飞书机器人。",
    parameters: sendMessageParams,
    execute: async (_id, params) => {
      const sender = getFeishuSender?.();
      if (!sender) {
        throw new Error("飞书未配置或未启用，请先在设置中配置飞书机器人");
      }
      await sender.sendText(params.chatId, params.content);
      return textResult(`已发送飞书消息到 ${params.chatId}`);
    }
  };

  return [sendMessage];
}
