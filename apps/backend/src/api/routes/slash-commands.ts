import { Hono } from "hono";
import { z } from "zod";
import type { AppContext } from "../context";

const commandDisabledSchema = z.object({ disabled: z.boolean() });

export function slashCommandRoutes(context: AppContext): Hono {
  const app = new Hono();

  app.get("/slash-commands", async (c) => {
    const projectId = c.req.query("projectId");
    const project = projectId ? await context.store.getProject(projectId) : undefined;
    return c.json(await context.slashCommandService.list(project));
  });

  // 单项停用/恢复插件来源命令（写入 commands.disabled 黑名单），返回刷新后的命令列表。
  app.put("/slash-commands/:name/disabled", async (c) => {
    if (!context.skillMarketService) {
      return c.json({ error: "命令停用服务不可用" }, 404);
    }
    const name = c.req.param("name");
    const { disabled } = commandDisabledSchema.parse(await c.req.json());
    await context.skillMarketService.setCommandDisabled(name, disabled);
    const projectId = c.req.query("projectId");
    const project = projectId ? await context.store.getProject(projectId) : undefined;
    return c.json(await context.slashCommandService.list(project));
  });

  return app;
}
