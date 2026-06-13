import { Hono } from "hono";
import { z } from "zod";
import { skillCreateInputSchema, skillImportInputSchema } from "@chengxiaobang/shared";
import { SkillMarketError } from "../../tools/skill-market-service";
import type { AppContext } from "../context";

const marketToggleSchema = z.object({ enabled: z.boolean() });

export function skillRoutes(context: AppContext): Hono {
  const app = new Hono();

  app.get("/", async (c) => {
    if (!context.skillMarketService) {
      return c.json({ error: "技能市场服务不可用" }, 404);
    }
    return c.json({ skills: await context.skillMarketService.list() });
  });

  app.get("/detail/:name", async (c) => {
    if (!context.skillMarketService) {
      return c.json({ error: "技能市场服务不可用" }, 404);
    }
    const name = c.req.param("name");
    const detail = await context.skillMarketService.getDetail(name);
    if (!detail) {
      return c.json({ error: "技能不存在" }, 404);
    }
    return c.json({ skill: detail });
  });

  app.put("/market/:name", async (c) => {
    if (!context.skillMarketService) {
      return c.json({ error: "技能市场服务不可用" }, 404);
    }
    const name = c.req.param("name");
    const { enabled } = marketToggleSchema.parse(await c.req.json());
    try {
      const skills = await context.skillMarketService.setMarketSkillEnabled(name, enabled);
      return c.json({ skills });
    } catch (error) {
      if (error instanceof SkillMarketError) {
        console.warn(`[skills-routes] 切换市场技能失败 name=${name}: ${error.message}`);
        return c.json({ error: error.message }, 400);
      }
      throw error;
    }
  });

  app.post("/custom/import", async (c) => {
    if (!context.skillMarketService) {
      return c.json({ error: "技能市场服务不可用" }, 404);
    }
    const input = skillImportInputSchema.parse(await c.req.json());
    try {
      const skill = await context.skillMarketService.importFromUrl(input);
      return c.json({ skill });
    } catch (error) {
      if (error instanceof SkillMarketError) {
        console.warn(`[skills-routes] 导入自定义技能失败 url=${input.url}: ${error.message}`);
        return c.json({ error: error.message }, 400);
      }
      throw error;
    }
  });

  app.post("/custom", async (c) => {
    if (!context.skillMarketService) {
      return c.json({ error: "技能市场服务不可用" }, 404);
    }
    const input = skillCreateInputSchema.parse(await c.req.json());
    try {
      const skill = await context.skillMarketService.createCustom(input);
      return c.json({ skill });
    } catch (error) {
      if (error instanceof SkillMarketError) {
        console.warn(`[skills-routes] 创建自定义技能失败 name=${input.name}: ${error.message}`);
        return c.json({ error: error.message }, 400);
      }
      throw error;
    }
  });

  app.delete("/custom/:name", async (c) => {
    if (!context.skillMarketService) {
      return c.json({ error: "技能市场服务不可用" }, 404);
    }
    const name = c.req.param("name");
    try {
      return c.json({ deleted: await context.skillMarketService.deleteCustom(name) });
    } catch (error) {
      if (error instanceof SkillMarketError) {
        console.warn(`[skills-routes] 删除自定义技能失败 name=${name}: ${error.message}`);
        return c.json({ error: error.message }, 400);
      }
      throw error;
    }
  });

  return app;
}
