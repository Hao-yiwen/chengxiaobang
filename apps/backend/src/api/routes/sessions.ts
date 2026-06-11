import { Hono } from "hono";
import {
  rewindRequestSchema,
  sessionForkInputSchema,
  sessionInputSchema,
  sessionUpdateSchema,
  type Message
} from "@chengxiaobang/shared";
import type { AppContext } from "../context";
import type { StoredMessage } from "../../repository/state-store";

/** The payload column is model-context internals — never expose it to clients. */
function toClientMessage({ payload: _payload, ...message }: StoredMessage): Message {
  return message;
}

export function sessionRoutes(context: AppContext): Hono {
  const app = new Hono();

  app.get("/", async (c) => {
    const projectId = c.req.query("projectId");
    return c.json({
      sessions: await context.store.listSessions(projectId ?? undefined)
    });
  });

  app.post("/", async (c) => {
    const input = sessionInputSchema.parse(await c.req.json());
    const session = await context.store.createSession({
      projectId: input.projectId ?? null,
      title: input.title ?? "新对话",
      providerId: input.providerId,
      accessMode: input.accessMode ?? "approval"
    });
    return c.json({ session }, 201);
  });

  app.get("/:sessionId/messages", async (c) => {
    const messages = await context.store.listMessages(c.req.param("sessionId"));
    return c.json({ messages: messages.map(toClientMessage) });
  });

  app.get("/:sessionId/runs", async (c) => {
    const sessionId = c.req.param("sessionId");
    const [runs, toolCalls] = await Promise.all([
      context.store.listRuns(sessionId),
      context.store.listToolCallsForSession(sessionId)
    ]);
    return c.json({ runs, toolCalls });
  });

  app.post("/:sessionId/rewind", async (c) => {
    const sessionId = c.req.param("sessionId");
    const input = rewindRequestSchema.parse(await c.req.json());
    const deleted = await context.store.deleteMessagesFrom(sessionId, input.messageId);
    if (deleted === 0) {
      return c.json({ error: "消息不存在" }, 404);
    }
    const messages = await context.store.listMessages(sessionId);
    return c.json({ messages: messages.map(toClientMessage) });
  });

  app.post("/:sessionId/fork", async (c) => {
    const sessionId = c.req.param("sessionId");
    if (!(await context.store.getSession(sessionId))) {
      return c.json({ error: "会话不存在" }, 404);
    }
    const input = sessionForkInputSchema.parse(await c.req.json());
    try {
      const session = await context.store.forkSession(sessionId, input.messageId);
      return c.json({ session }, 201);
    } catch (error) {
      if (error instanceof Error && error.message === "消息不存在") {
        return c.json({ error: "消息不存在" }, 404);
      }
      throw error;
    }
  });

  app.patch("/:sessionId", async (c) => {
    const session = await context.store.updateSession(
      c.req.param("sessionId"),
      sessionUpdateSchema.parse(await c.req.json())
    );
    return c.json({ session });
  });

  app.delete("/:sessionId", async (c) => {
    return c.json({ deleted: await context.store.deleteSession(c.req.param("sessionId")) });
  });

  return app;
}
