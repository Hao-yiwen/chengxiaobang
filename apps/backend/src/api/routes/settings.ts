import { Hono } from "hono";
import {
  connectPhoneInstallPollInputSchema,
  connectPhoneInstallStartInputSchema,
  feishuConfigInputSchema,
  feishuInstallPollInputSchema,
  feishuInstallStartInputSchema,
  normalizeConnectPhoneStartResult,
  providerInputSchema,
  usageStatsSchema,
  webSearchConfigInputSchema
} from "@chengxiaobang/shared";
import type { AppContext } from "../context";

import { getLogger } from "../../logging/logger";

const log = getLogger({ module: "api/routes/settings" });

export function settingsRoutes(context: AppContext): Hono {
  const app = new Hono();

  app.post("/connect-phone/install/start", async (c) => {
    const input = connectPhoneInstallStartInputSchema.parse(await c.req.json());
    log.info("[settings-routes] 生成连接手机扫码连接", { target: input.target });
    if (input.target === "wechat") {
      if (!context.wechatService) {
        return c.json({ ok: false, target: "wechat", message: "微信连接服务不可用" });
      }
      return c.json(await context.wechatService.startInstall());
    }
    if (!context.feishuInstallService) {
      return c.json({ ok: false, target: input.target, message: "飞书扫码安装服务不可用" });
    }
    const domain = input.target;
    return c.json(
      normalizeConnectPhoneStartResult(input.target, await context.feishuInstallService.start(domain))
    );
  });

  app.post("/connect-phone/install/poll", async (c) => {
    const input = connectPhoneInstallPollInputSchema.parse(await c.req.json());
    log.debug("[settings-routes] 轮询连接手机扫码连接", {
      target: input.target,
      deviceCodePrefix: input.deviceCode.slice(0, 8)
    });
    if (input.target === "wechat") {
      if (!context.wechatService) {
        return c.json({ done: false, target: "wechat", error: "微信连接服务不可用" });
      }
      const result = await context.wechatService.pollInstall(input.deviceCode);
      if (!result.done) {
        return c.json({ ...result, target: "wechat" });
      }
      const { config, status } = await context.wechatService.saveInstallAndRestart(result);
      return c.json({ done: true, target: "wechat", config, status });
    }

    if (!context.feishuInstallService || !context.feishuConfigService || !context.feishuService) {
      return c.json({ done: false, target: input.target, error: "飞书服务不可用" });
    }
    const result = await context.feishuInstallService.poll(input.deviceCode);
    if (!result.done) {
      return c.json({ ...result, target: input.target });
    }

    const current = await context.feishuConfigService.load();
    const config = await context.feishuConfigService.save({
      enabled: true,
      appId: result.appId,
      appSecret: result.appSecret,
      domain: result.domain,
      fullAccess: current.fullAccess
    });
    await context.feishuService.restart();
    const status = context.feishuService.getStatus();
    log.info("[settings-routes] 连接手机飞书扫码连接已保存并重启", {
      appId: config.appId,
      domain: config.domain,
      status: status.status
    });
    return c.json({ done: true, target: config.domain, config, status });
  });

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

  app.post("/feishu/install/start", async (c) => {
    if (!context.feishuInstallService) {
      return c.json({ error: "飞书扫码安装服务不可用" }, 404);
    }
    const input = feishuInstallStartInputSchema.parse(await c.req.json());
    log.info("[settings-routes] 生成飞书扫码连接", { domain: input.domain });
    return c.json(await context.feishuInstallService.start(input.domain));
  });

  app.post("/feishu/install/poll", async (c) => {
    if (!context.feishuInstallService || !context.feishuConfigService || !context.feishuService) {
      return c.json({ error: "飞书服务不可用" }, 404);
    }
    const input = feishuInstallPollInputSchema.parse(await c.req.json());
    log.debug("[settings-routes] 轮询飞书扫码连接", {
      deviceCodePrefix: input.deviceCode.slice(0, 8)
    });
    const result = await context.feishuInstallService.poll(input.deviceCode);
    if (!result.done) {
      return c.json(result);
    }

    const current = await context.feishuConfigService.load();
    const config = await context.feishuConfigService.save({
      enabled: true,
      appId: result.appId,
      appSecret: result.appSecret,
      domain: result.domain,
      fullAccess: current.fullAccess
    });
    await context.feishuService.restart();
    const status = context.feishuService.getStatus();
    log.info("[settings-routes] 飞书扫码连接已保存并重启", {
      appId: config.appId,
      domain: config.domain,
      status: status.status
    });
    return c.json({ done: true, config, status });
  });

  app.get("/feishu/status", (c) => {
    return c.json({
      status: context.feishuService?.getStatus() ?? { status: "disconnected" }
    });
  });

  app.get("/wechat", async (c) => {
    if (!context.wechatConfigService) {
      return c.json({ error: "微信服务不可用" }, 404);
    }
    return c.json({ config: await context.wechatConfigService.load() });
  });

  app.get("/wechat/status", (c) => {
    return c.json({
      status: context.wechatService?.getStatus() ?? { status: "disconnected" }
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
    log.info("[settings-routes] 拉取全局 Token 与预估费用统计", {
      timezoneOffsetMinutes
    });
    const stats = usageStatsSchema.parse(
      await context.usageCostLedgerService.buildUsageStats({ timezoneOffsetMinutes })
    );
    log.info("[settings-routes] 全局用量统计返回完成", {
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
    log.info(`[settings-routes] 拉取 provider 模型列表 providerId=${providerId}`);
    return c.json({ models: await context.providerService.listModels(providerId) });
  });

  app.get("/providers/:providerId/model-options", async (c) => {
    const providerId = c.req.param("providerId");
    log.info(`[settings-routes] 拉取 provider 模型选项 providerId=${providerId}`);
    return c.json({ models: await context.providerService.listModelOptions(providerId) });
  });

  app.delete("/providers/:providerId", async (c) => {
    return c.json({
      deleted: await context.providerService.deleteProvider(c.req.param("providerId"))
    });
  });

  return app;
}
