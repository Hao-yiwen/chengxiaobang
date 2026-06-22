import { Hono } from "hono";
import {
  pluginConfigUpdateInputSchema,
  pluginInstallInputSchema,
  pluginToggleInputSchema
} from "@chengxiaobang/shared";
import { PluginError } from "../../tools/plugin-service";
import type { AppContext } from "../context";

import { getLogger } from "../../logging/logger";

const log = getLogger({ module: "api/routes/plugins" });

export function pluginRoutes(context: AppContext): Hono {
  const app = new Hono();

  app.get("/", async (c) => {
    if (!context.pluginService) {
      return c.json({ error: "插件服务不可用" }, 404);
    }
    return c.json({ plugins: await context.pluginService.list() });
  });

  app.get("/detail/:name", async (c) => {
    if (!context.pluginService) {
      return c.json({ error: "插件服务不可用" }, 404);
    }
    const detail = await context.pluginService.getDetail(c.req.param("name"));
    if (!detail) {
      return c.json({ error: "插件不存在" }, 404);
    }
    return c.json({ plugin: detail });
  });

  app.post("/install", async (c) => {
    if (!context.pluginService) {
      return c.json({ error: "插件服务不可用" }, 404);
    }
    const input = pluginInstallInputSchema.parse(await c.req.json());
    try {
      const plugin = await context.pluginService.install(input);
      return c.json({ plugin });
    } catch (error) {
      if (error instanceof PluginError) {
        log.warn(
          `[plugins-routes] 安装插件失败 input=${JSON.stringify(input)}: ${error.message}`
        );
        return c.json({ error: error.message }, 400);
      }
      throw error;
    }
  });

  app.delete("/:name", async (c) => {
    if (!context.pluginService) {
      return c.json({ error: "插件服务不可用" }, 404);
    }
    const name = c.req.param("name");
    try {
      return c.json({ uninstalled: await context.pluginService.uninstall(name) });
    } catch (error) {
      if (error instanceof PluginError) {
        log.warn(`[plugins-routes] 卸载插件失败 name=${name}: ${error.message}`);
        return c.json({ error: error.message }, 400);
      }
      throw error;
    }
  });

  app.put("/:name/enabled", async (c) => {
    if (!context.pluginService) {
      return c.json({ error: "插件服务不可用" }, 404);
    }
    const name = c.req.param("name");
    const { enabled } = pluginToggleInputSchema.parse(await c.req.json());
    try {
      const plugins = await context.pluginService.setEnabled(name, enabled);
      return c.json({ plugins });
    } catch (error) {
      if (error instanceof PluginError) {
        log.warn(`[plugins-routes] 切换插件启停失败 name=${name}: ${error.message}`);
        return c.json({ error: error.message }, 400);
      }
      throw error;
    }
  });

  app.put("/:name/config", async (c) => {
    if (!context.pluginService) {
      return c.json({ error: "插件服务不可用" }, 404);
    }
    const name = c.req.param("name");
    const { values } = pluginConfigUpdateInputSchema.parse(await c.req.json());
    try {
      const plugin = await context.pluginService.setConfigValues(name, values);
      return c.json({ plugin });
    } catch (error) {
      if (error instanceof PluginError) {
        log.warn(`[plugins-routes] 更新插件配置失败 name=${name}: ${error.message}`);
        return c.json({ error: error.message }, 400);
      }
      throw error;
    }
  });

  return app;
}
