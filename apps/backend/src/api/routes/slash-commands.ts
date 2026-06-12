import { Hono } from "hono";
import type { AppContext } from "../context";

export function slashCommandRoutes(context: AppContext): Hono {
  const app = new Hono();

  app.get("/slash-commands", async (c) => {
    const projectId = c.req.query("projectId");
    const project = projectId ? await context.store.getProject(projectId) : undefined;
    return c.json(await context.slashCommandService.list(project));
  });

  return app;
}
