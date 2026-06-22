import { Hono } from "hono";
import type { SideChatDetail, Session } from "@chengxiaobang/shared";
import type { AppContext } from "../context";
import type { StoredMessage } from "../../repository/state-store";

import { getLogger } from "../../logging/logger";

const log = getLogger({ module: "api/routes/messages" });

function toClientMessage({
  payload: _payload,
  ...message
}: StoredMessage): SideChatDetail["messages"][number] {
  return { ...message, attachments: message.attachments ?? [] };
}

async function buildSideChatDetail(
  context: AppContext,
  session: Session | undefined
): Promise<SideChatDetail> {
  if (!session) {
    return { messages: [], runs: [], toolCalls: [] };
  }
  const [messages, runs, toolCalls] = await Promise.all([
    context.store.listMessages(session.id),
    context.store.listRuns(session.id),
    context.store.listToolCallsForSession(session.id)
  ]);
  return {
    session,
    messages: messages.map(toClientMessage),
    runs,
    toolCalls
  };
}

export function messageRoutes(context: AppContext): Hono {
  const app = new Hono();

  app.get("/:messageId/side-chat", async (c) => {
    const messageId = c.req.param("messageId");
    const session = await context.store.getSideChatForMessage(messageId);
    log.debug("[messages-route] 读取消息绑定侧边会话", {
      anchorMessageId: messageId,
      sideSessionId: session?.id
    });
    return c.json({ sideChat: session ? await buildSideChatDetail(context, session) : null });
  });

  app.post("/:messageId/side-chat", async (c) => {
    const messageId = c.req.param("messageId");
    const existing = await context.store.getSideChatForMessage(messageId);
    try {
      const session = existing ?? (await context.store.createSideChatForMessage(messageId));
      const sideChat = await buildSideChatDetail(context, session);
      log.info("[messages-route] 准备消息绑定侧边会话", {
        anchorMessageId: messageId,
        sideSessionId: session.id,
        parentSessionId: session.sideChatParentSessionId,
        reused: Boolean(existing)
      });
      return c.json({ sideChat }, existing ? 200 : 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.warn("[messages-route] 准备消息绑定侧边会话失败", {
        anchorMessageId: messageId,
        error: message
      });
      if (message === "消息不存在") {
        return c.json({ error: "消息不存在" }, 404);
      }
      if (message === "该消息不支持侧边会话" || message === "侧边会话内不能再创建侧边会话") {
        return c.json({ error: message }, 400);
      }
      throw error;
    }
  });

  return app;
}
