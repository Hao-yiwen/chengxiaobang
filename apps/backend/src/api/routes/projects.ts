import { basename } from "node:path";
import { Hono } from "hono";
import { projectInputSchema } from "@chengxiaobang/shared";
import { listProjectFiles } from "../../tools/workspace";
import type { AppContext } from "../context";

export function projectRoutes(context: AppContext): Hono {
  const app = new Hono();

  app.get("/", async (c) => c.json({ projects: await context.store.listProjects() }));

  app.post("/", async (c) => {
    const input = projectInputSchema.parse(await c.req.json());
    const project = await context.store.createProject({
      path: input.path,
      name: input.name ?? basename(input.path)
    });
    return c.json({ project }, 201);
  });

  app.delete("/:projectId", async (c) => {
    return c.json({ deleted: await context.store.deleteProject(c.req.param("projectId")) });
  });

  app.get("/:projectId/files", async (c) => {
    const project = await context.store.getProject(c.req.param("projectId"));
    if (!project) {
      return c.json({ error: "项目不存在" }, 404);
    }
    const query = c.req.query("query") ?? "";
    const limit = Number(c.req.query("limit") ?? "") || 50;
    return c.json({ files: await listProjectFiles(project.path, query, limit) });
  });

  return app;
}
