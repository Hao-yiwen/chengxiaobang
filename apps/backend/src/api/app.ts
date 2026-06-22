import { Hono } from "hono";
import { cors } from "hono/cors";
import { normalizeErrorMessage, type AppEvent } from "@chengxiaobang/shared";
import { EventHub } from "../events/event-hub";
import {
  createRequestId,
  errorToLogFields,
  getLogger,
  withLogContext
} from "../logging/logger";
import { SlashCommandService } from "../tools/slash-command-service";
import { UsageCostLedgerService } from "../usage/usage-cost-ledger";
import type { AppContext, AppOptions } from "./context";
import { registerRoutes } from "./routes/index";

export type { AppContext, AppOptions } from "./context";

const ALLOWED_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];
const ALLOWED_HEADERS = [
  "Content-Type",
  "x-chengxiaobang-token",
  "x-request-id",
  "Last-Event-ID"
];
const log = getLogger({ module: "api" });

export function createApp(options: AppOptions): (request: Request) => Promise<Response> {
  const context: AppContext = {
    ...options,
    slashCommandService: options.slashCommandService ?? new SlashCommandService(),
    usageCostLedgerService:
      options.usageCostLedgerService ?? new UsageCostLedgerService(options.store),
    eventHub: options.eventHub ?? new EventHub<AppEvent>()
  };
  const app = new Hono();

  app.use("*", async (c, next) => {
    const startedAt = Date.now();
    const requestId = c.req.header("x-request-id")?.trim() || createRequestId();
    const sessionId = await sessionIdFromRequest(c.req.raw);
    return withLogContext(
      {
        requestId,
        method: c.req.method,
        path: c.req.path,
        sessionId
      },
      async () => {
        log.debug("HTTP 请求开始", { action: "request.start" });
        let thrown = false;
        try {
          await next();
        } catch (error) {
          thrown = true;
          throw error;
        } finally {
          log.info("HTTP 请求结束", {
            action: "request.end",
            status: thrown ? 500 : c.res.status,
            durationMs: Date.now() - startedAt
          });
        }
      }
    );
  });

  app.use("*", async (c, next) => {
    const origin = c.req.header("origin");
    if (origin && !isAllowedCorsOrigin(origin)) {
      log.warn("拒绝不受信任的跨源请求", {
        action: "cors.reject",
        origin,
        method: c.req.method,
        path: c.req.path
      });
      return c.json({ error: "不允许的请求来源" }, 403);
    }
    await next();
  });

  app.use(
    "*",
    cors({
      origin: (origin) => (isAllowedCorsOrigin(origin) ? origin : null),
      allowHeaders: ALLOWED_HEADERS,
      allowMethods: ALLOWED_METHODS
    })
  );
  app.use("*", async (c, next) => {
    if (
      c.req.method !== "OPTIONS" &&
      c.req.path !== "/api/health" &&
      !context.allowUnauthenticated &&
      (!context.token || c.req.header("x-chengxiaobang-token") !== context.token)
    ) {
      log.warn("拒绝未授权请求", {
        action: "auth.reject",
        method: c.req.method,
        path: c.req.path,
        hasToken: Boolean(context.token),
        hasHeader: Boolean(c.req.header("x-chengxiaobang-token"))
      });
      return c.json({ error: "未授权" }, 401);
    }
    await next();
  });

  app.get("/api/health", (c) => c.json({ ok: true, name: "程小帮" }));
  registerRoutes(app, context);

  app.notFound((c) => c.json({ error: "接口不存在" }, 404));
  app.onError((error, c) => {
    // 完整错误进日志便于排查,响应体只回归一化后的精简文案,避免长错误透传到前端撑满屏幕。
    log.error("未捕获的请求错误", {
      action: "request.unhandled_error",
      method: c.req.method,
      path: c.req.path,
      ...errorToLogFields(error)
    });
    return c.json({ error: normalizeErrorMessage(error) }, 500);
  });

  return async (request) => app.fetch(request);
}

async function sessionIdFromRequest(request: Request): Promise<string | undefined> {
  const url = new URL(request.url);
  const querySessionId = url.searchParams.get("sessionId")?.trim();
  if (querySessionId) {
    return querySessionId;
  }
  const match = url.pathname.match(/^\/api\/sessions\/([^/]+)/);
  if (match) {
    return decodeURIComponent(match[1]);
  }
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return undefined;
  }
  try {
    const body = (await request.clone().json()) as { sessionId?: unknown };
    return typeof body.sessionId === "string" && body.sessionId.trim()
      ? body.sessionId.trim()
      : undefined;
  } catch {
    return undefined;
  }
}

function isAllowedCorsOrigin(origin: string): boolean {
  if (!origin) {
    return true;
  }
  if (origin === "null" || origin.startsWith("file://")) {
    return true;
  }
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return false;
  }
  return (
    parsed.hostname === "localhost" ||
    parsed.hostname === "127.0.0.1" ||
    parsed.hostname === "::1" ||
    parsed.hostname === "[::1]"
  );
}
