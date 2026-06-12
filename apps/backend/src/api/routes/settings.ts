import { Hono } from "hono";
import { feishuConfigInputSchema, providerInputSchema } from "@chengxiaobang/shared";
import type { AppContext } from "../context";

export function settingsRoutes(context: AppContext): Hono {
  const app = new Hono();

  app.get("/feishu", async (c) => {
    if (!context.feishuConfigService) {
      return c.json({ error: "飞书服务不可用" }, 404);
    }
    return c.json({ config: await context.feishuConfigService.load() });
  });

  app.put("/feishu", async (c) => {
    if (!context.feishuConfigService || !context.feishuService) {
      return c.json({ error: "飞书服务不可用" }, 404);
    }
    const input = feishuConfigInputSchema.parse(await c.req.json());
    const feishuConfig = await context.feishuConfigService.save(input);
    await context.feishuService.restart();
    return c.json({
      config: feishuConfig,
      status: context.feishuService.getStatus()
    });
  });

  app.get("/feishu/status", (c) => {
    return c.json({
      status: context.feishuService?.getStatus() ?? { status: "disconnected" }
    });
  });

  app.get("/providers", async (c) => {
    return c.json({ providers: await context.providerService.listProviders() });
  });

  app.put("/providers", async (c) => {
    const provider = await context.providerService.saveProvider(
      providerInputSchema.parse(await c.req.json())
    );
    return c.json({ provider });
  });

  app.post("/providers/:providerId/test", async (c) => {
    await context.providerService.testProvider(c.req.param("providerId"));
    return c.json({ ok: true });
  });

  app.delete("/providers/:providerId", async (c) => {
    return c.json({
      deleted: await context.providerService.deleteProvider(c.req.param("providerId"))
    });
  });

  return app;
}
