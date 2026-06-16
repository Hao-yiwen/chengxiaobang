import { Hono } from "hono";
import {
  rewindRequestSchema,
  reasoningModeSchema,
  sessionForkInputSchema,
  sessionInputSchema,
  sessionUpdateSchema,
  type Message,
  type Session
} from "@chengxiaobang/shared";
import type { AppContext } from "../context";
import type { StoredMessage } from "../../repository/state-store";
import {
  copyForkedSessionWorkspace,
  ForkWorkspaceCopyError
} from "../session-workspace-copy";

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

  app.get("/search", async (c) => {
    const query = c.req.query("query") ?? "";
    const limitParam = c.req.query("limit");
    const limit = limitParam === undefined ? undefined : Number(limitParam);
    if (!query.trim()) {
      console.debug("[sessions-route] 跳过空会话搜索请求");
      return c.json({ results: [] });
    }
    try {
      const results = await context.store.searchSessions(
        query,
        Number.isFinite(limit) ? limit : undefined
      );
      console.info("[sessions-route] 会话搜索请求完成", {
        query: query.trim(),
        resultCount: results.length
      });
      return c.json({ results });
    } catch (error) {
      console.error("[sessions-route] 会话搜索请求失败", {
        query: query.trim(),
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
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

  app.get("/:sessionId/context-usage", async (c) => {
    const sessionId = c.req.param("sessionId");
    const reasoningModeQuery = c.req.query("reasoningMode");
    const reasoningMode = reasoningModeQuery
      ? reasoningModeSchema.parse(reasoningModeQuery)
      : undefined;
    const usage = await context.runner.buildSessionContextUsage(sessionId, {
      providerId: c.req.query("providerId"),
      model: c.req.query("model"),
      reasoningMode,
      planMode: c.req.query("planMode") === "true"
    });
    if (!usage) {
      return c.json({ error: "会话不存在" }, 404);
    }
    console.debug("[sessions-route] 返回会话上下文用量", {
      sessionId,
      model: usage.model,
      estimatedTokens: usage.estimatedTokens,
      sessionCostCny: usage.sessionCostCny,
      status: usage.status
    });
    return c.json({ usage });
  });

  app.get("/:sessionId/runs", async (c) => {
    const sessionId = c.req.param("sessionId");
    const [runs, toolCalls] = await Promise.all([
      context.store.listRuns(sessionId),
      context.store.listToolCallsForSession(sessionId)
    ]);
    return c.json({ runs, toolCalls });
  });

  app.get("/:sessionId/debug-context", async (c) => {
    const sessionId = c.req.param("sessionId");
    const planMode = c.req.query("planMode") === "true";
    const debug = await context.runner.buildSessionDebugContext(sessionId, { planMode });
    if (!debug) {
      return c.json({ error: "会话不存在" }, 404);
    }
    return c.json({ debug });
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
    const sourceSession = await context.store.getSession(sessionId);
    if (!sourceSession) {
      return c.json({ error: "会话不存在" }, 404);
    }
    const input = sessionForkInputSchema.parse(await c.req.json());
    let forkSession: Session | undefined;
    try {
      forkSession = await context.store.forkSession(sessionId, input.messageId);
      const workspaceCopy = await copyForkedSessionWorkspace({
        resolver: context.runner,
        sourceSession,
        forkSession
      });
      if (workspaceCopy.status === "copied") {
        console.info("[sessions-route] 已复制派生会话工作区", {
          sourceSessionId: sourceSession.id,
          forkSessionId: forkSession.id,
          method: workspaceCopy.method,
          sourcePath: workspaceCopy.sourcePath,
          targetPath: workspaceCopy.targetPath,
          scannedBytes: workspaceCopy.scannedBytes,
          scannedEntries: workspaceCopy.scannedEntries
        });
      } else {
        console.debug("[sessions-route] 跳过派生会话工作区复制", {
          sourceSessionId: sourceSession.id,
          forkSessionId: forkSession.id,
          reason: workspaceCopy.reason,
          sourcePath: workspaceCopy.sourcePath,
          targetPath: workspaceCopy.targetPath
        });
      }
      return c.json({ session: forkSession }, 201);
    } catch (error) {
      if (forkSession) {
        let rolledBack = false;
        try {
          rolledBack = await context.store.deleteSession(forkSession.id);
        } catch (rollbackError) {
          console.error("[sessions-route] 回滚派生会话失败", {
            sourceSessionId: sourceSession.id,
            forkSessionId: forkSession.id,
            error: rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
          });
        }
        console.error("[sessions-route] 派生会话工作区复制失败，已取消派生", {
          sourceSessionId: sourceSession.id,
          forkSessionId: forkSession.id,
          rolledBack,
          error: error instanceof Error ? error.message : String(error),
          details: error instanceof ForkWorkspaceCopyError ? error.details : undefined
        });
        throw error instanceof ForkWorkspaceCopyError
          ? error
          : new Error("派生工作区复制失败，已取消派生");
      }
      if (error instanceof Error && error.message === "消息不存在") {
        return c.json({ error: "消息不存在" }, 404);
      }
      throw error;
    }
  });

  app.patch("/:sessionId", async (c) => {
    const { pinned, ...update } = sessionUpdateSchema.parse(await c.req.json());
    const id = c.req.param("sessionId");
    let session: Session | undefined;
    // pinned 单独出现时绕开 updateSession，避免 bump updated_at 扰动列表排序。
    if (Object.keys(update).length > 0 || pinned === undefined) {
      session = await context.store.updateSession(id, update);
    }
    if (pinned !== undefined) {
      session = await context.store.setSessionPinned(id, pinned);
    }
    return c.json({ session });
  });

  app.delete("/:sessionId", async (c) => {
    return c.json({ deleted: await context.store.deleteSession(c.req.param("sessionId")) });
  });

  return app;
}
