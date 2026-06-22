import { Hono } from "hono";
import { cors } from "hono/cors";
import { normalizeErrorMessage, type AppEvent } from "@chengxiaobang/shared";
import { EventHub } from "../events/event-hub";
import { SlashCommandService } from "../tools/slash-command-service";
import { UsageCostLedgerService } from "../usage/usage-cost-ledger";
import type { AppContext, AppOptions } from "./context";
import { registerRoutes } from "./routes/index";

export type { AppContext, AppOptions } from "./context";

const ALLOWED_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];
const ALLOWED_HEADERS = ["Content-Type", "x-chengxiaobang-token", "Last-Event-ID"];

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
    const origin = c.req.header("origin");
    if (origin && !isAllowedCorsOrigin(origin)) {
      console.warn("[api] 拒绝不受信任的跨源请求", {
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
      console.warn("[api] 拒绝未授权请求", {
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
    console.error("[api] 未捕获的请求错误", {
      method: c.req.method,
      path: c.req.path,
      error
    });
    return c.json({ error: normalizeErrorMessage(error) }, 500);
  });

  return async (request) => app.fetch(request);
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
