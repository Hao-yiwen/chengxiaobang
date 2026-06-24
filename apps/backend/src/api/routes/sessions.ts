import { Hono } from "hono";
import {
  DEFAULT_ACCESS_MODE,
  messageFeedbackUpdateSchema,
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

import { getLogger } from "../../logging/logger";

const log = getLogger({ module: "api/routes/sessions" });

/** The payload column is model-context internals — never expose it to clients. */
function toClientMessage({ payload: _payload, ...message }: StoredMessage): Message {
  return message;
}

function parseRequiredPage(query: (name: string) => string | undefined):
  | { ok: true; limit: number; offset: number }
  | { ok: false; error: string } {
  const limitRaw = query("limit");
  const offsetRaw = query("offset");
  const limit = Number(limitRaw);
  const offset = Number(offsetRaw);
  if (!limitRaw || !offsetRaw || !Number.isInteger(limit) || !Number.isInteger(offset)) {
    return { ok: false, error: "缺少有效的分页参数 limit/offset" };
  }
  if (limit < 1 || offset < 0) {
    return { ok: false, error: "分页参数 limit/offset 超出范围" };
  }
  return { ok: true, limit, offset };
}

function parseProjectId(value: string | undefined): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  return value === "null" ? null : value;
}

function parsePinned(value: string | undefined): boolean {
  return value === "true";
}

export function sessionRoutes(context: AppContext): Hono {
  const app = new Hono();

  app.get("/", async (c) => {
    const page = parseRequiredPage((name) => c.req.query(name));
    if (!page.ok) {
      return c.json({ error: page.error }, 400);
    }
    const projectId = parseProjectId(c.req.query("projectId"));
    const pinned = parsePinned(c.req.query("pinned"));
    const result = await context.store.listSessions(projectId, {
      limit: page.limit,
      offset: page.offset,
      pinned
    });
    log.debug("[sessions-route] 返回会话分页列表", {
      projectId,
      pinned,
      limit: page.limit,
      offset: page.offset,
      count: result.items.length,
      total: result.total
    });
    return c.json(result);
  });

  app.get("/search", async (c) => {
    const query = c.req.query("query") ?? "";
    const limitParam = c.req.query("limit");
    const limit = limitParam === undefined ? undefined : Number(limitParam);
    if (!query.trim()) {
      log.debug("[sessions-route] 跳过空会话搜索请求");
      return c.json({ results: [] });
    }
    try {
      const results = await context.store.searchSessions(
        query,
        Number.isFinite(limit) ? limit : undefined
      );
      log.info("[sessions-route] 会话搜索请求完成", {
        query: query.trim(),
        resultCount: results.length
      });
      return c.json({ results });
    } catch (error) {
      log.error("[sessions-route] 会话搜索请求失败", {
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
      accessMode: input.accessMode ?? DEFAULT_ACCESS_MODE
    });
    return c.json({ session }, 201);
  });

  app.get("/:sessionId", async (c) => {
    const session = await context.store.getSession(c.req.param("sessionId"));
    if (!session) {
      return c.json({ error: "会话不存在" }, 404);
    }
    return c.json({ session });
  });

  app.get("/:sessionId/side-chats", async (c) => {
    const sessionId = c.req.param("sessionId");
    const sideChats = await context.store.listSideChatsForSession(sessionId);
    log.debug("[sessions-route] 返回主会话侧边会话摘要", {
      sessionId,
      count: sideChats.length
    });
    return c.json({ sideChats });
  });

  app.get("/:sessionId/messages", async (c) => {
    const messages = await context.store.listMessages(c.req.param("sessionId"));
    return c.json({ messages: messages.map(toClientMessage) });
  });

  app.post("/:sessionId/read", async (c) => {
    const sessionId = c.req.param("sessionId");
    try {
      const session = await context.store.markSessionRead(sessionId);
      log.info("[sessions-route] 已标记会话已读", {
        sessionId,
        lastViewedAt: session.lastViewedAt,
        clearedNotice: session.notice === undefined
      });
      return c.json({ session });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.warn("[sessions-route] 标记会话已读失败", { sessionId, error: message });
      if (message === "会话不存在") {
        return c.json({ error: "会话不存在" }, 404);
      }
      throw error;
    }
  });

  app.patch("/:sessionId/messages/:messageId/feedback", async (c) => {
    const sessionId = c.req.param("sessionId");
    const messageId = c.req.param("messageId");
    const input = messageFeedbackUpdateSchema.parse(await c.req.json());
    try {
      const message = await context.store.setMessageFeedback(sessionId, messageId, input.feedback);
      log.info("[sessions-route] 已更新消息反馈", {
        sessionId,
        messageId,
        feedback: input.feedback
      });
      return c.json({ message: toClientMessage(message) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.warn("[sessions-route] 更新消息反馈失败", {
        sessionId,
        messageId,
        feedback: input.feedback,
        error: message
      });
      if (message === "消息不存在") {
        return c.json({ error: "消息不存在" }, 404);
      }
      if (message === "只能评价助手消息") {
        return c.json({ error: "只能评价助手消息" }, 400);
      }
      throw error;
    }
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
    log.debug("[sessions-route] 返回会话上下文用量", {
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
    const [runs, toolCalls, modelDebugRecords] = await Promise.all([
      context.store.listRuns(sessionId),
      context.store.listToolCallsForSession(sessionId),
      context.modelDebugEnabled
        ? context.store.listModelDebugRecordsForSession(sessionId)
        : Promise.resolve([])
    ]);
    return c.json({
      runs,
      toolCalls,
      ...(context.modelDebugEnabled ? { modelDebugRecords } : {})
    });
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
        log.info("[sessions-route] 已复制派生会话工作区", {
          sourceSessionId: sourceSession.id,
          forkSessionId: forkSession.id,
          method: workspaceCopy.method,
          sourcePath: workspaceCopy.sourcePath,
          targetPath: workspaceCopy.targetPath,
          scannedBytes: workspaceCopy.scannedBytes,
          scannedEntries: workspaceCopy.scannedEntries
        });
      } else {
        log.debug("[sessions-route] 跳过派生会话工作区复制", {
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
          log.error("[sessions-route] 回滚派生会话失败", {
            sourceSessionId: sourceSession.id,
            forkSessionId: forkSession.id,
            error: rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
          });
        }
        log.error("[sessions-route] 派生会话工作区复制失败，已取消派生", {
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
