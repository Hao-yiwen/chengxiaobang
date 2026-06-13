import { Hono } from "hono";
import {
  feishuConfigInputSchema,
  providerInputSchema,
  usageStatsSchema,
  webSearchConfigInputSchema
} from "@chengxiaobang/shared";
import type { AppContext } from "../context";
import { buildUsageStats } from "../../usage/usage-stats";

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

  app.get("/web-search", async (c) => {
    if (!context.webSearchConfigService) {
      return c.json({ error: "网络搜索服务不可用" }, 404);
    }
    return c.json({ config: await context.webSearchConfigService.load() });
  });

  app.put("/web-search", async (c) => {
    if (!context.webSearchConfigService) {
      return c.json({ error: "网络搜索服务不可用" }, 404);
    }
    const input = webSearchConfigInputSchema.parse(await c.req.json());
    return c.json({ config: await context.webSearchConfigService.save(input) });
  });

  app.post("/web-search/test", async (c) => {
    if (!context.webSearchConfigService) {
      return c.json({ error: "网络搜索服务不可用" }, 404);
    }
    await context.webSearchConfigService.test();
    return c.json({ ok: true });
  });

  app.get("/usage-stats", async (c) => {
    const rawOffset = Number(c.req.query("timezoneOffsetMinutes") ?? 0);
    const timezoneOffsetMinutes = Number.isFinite(rawOffset) ? Math.trunc(rawOffset) : 0;
    console.info("[settings-routes] 拉取全局 Token 与预估费用统计", {
      timezoneOffsetMinutes
    });
    const stats = usageStatsSchema.parse(
      await buildUsageStats(context.store, { timezoneOffsetMinutes })
    );
    console.info("[settings-routes] 全局用量统计返回完成", {
      totalRunCount: stats.dataQuality.totalRunCount,
      todayCostCny: stats.today.costCny,
      todayTokens: stats.today.totalTokens
    });
    return c.json({ stats });
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

  app.get("/providers/:providerId/models", async (c) => {
    const providerId = c.req.param("providerId");
    console.info(`[settings-routes] 拉取 provider 模型列表 providerId=${providerId}`);
    return c.json({ models: await context.providerService.listModels(providerId) });
  });

  app.get("/providers/:providerId/model-options", async (c) => {
    const providerId = c.req.param("providerId");
    console.info(`[settings-routes] 拉取 provider 模型选项 providerId=${providerId}`);
    return c.json({ models: await context.providerService.listModelOptions(providerId) });
  });

  app.delete("/providers/:providerId", async (c) => {
    return c.json({
      deleted: await context.providerService.deleteProvider(c.req.param("providerId"))
    });
  });

  return app;
}
