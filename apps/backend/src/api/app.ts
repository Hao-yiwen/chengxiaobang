import { Hono } from "hono";
import { cors } from "hono/cors";
import { SlashCommandService } from "../tools/slash-command-service";
import type { AppContext, AppOptions } from "./context";
import { registerRoutes } from "./routes/index";

export type { AppContext, AppOptions } from "./context";

const ALLOWED_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];
const ALLOWED_HEADERS = ["Content-Type", "x-chengxiaobang-token"];

export function createApp(options: AppOptions): (request: Request) => Promise<Response> {
  const context: AppContext = {
    ...options,
    slashCommandService: options.slashCommandService ?? new SlashCommandService()
  };
  const app = new Hono();

  app.use(
    "*",
    cors({
      origin: "*",
      allowHeaders: ALLOWED_HEADERS,
      allowMethods: ALLOWED_METHODS
    })
  );
  app.use("*", async (c, next) => {
    if (
      c.req.method !== "OPTIONS" &&
      c.req.path !== "/api/health" &&
      context.token &&
      c.req.header("x-chengxiaobang-token") !== context.token
    ) {
      return c.json({ error: "未授权" }, 401);
    }
    await next();
  });

  app.get("/api/health", (c) => c.json({ ok: true, name: "程小帮" }));
  registerRoutes(app, context);

  app.notFound((c) => c.json({ error: "接口不存在" }, 404));
  app.onError((error, c) => c.json({ error: error.message }, 500));

  return async (request) => app.fetch(request);
}
