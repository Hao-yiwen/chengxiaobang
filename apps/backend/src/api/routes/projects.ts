import { basename } from "node:path";
import { Hono } from "hono";
import { projectInputSchema, projectUpdateSchema, type Project } from "@chengxiaobang/shared";
import { collectGitChanges, detectGitRepository } from "../../tools/git-changes";
import { listProjectDirectoryEntries, listProjectFiles } from "../../tools/workspace";
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

  app.patch("/:projectId", async (c) => {
    const input = projectUpdateSchema.parse(await c.req.json());
    const id = c.req.param("projectId");
    if (input.name === undefined && input.pinned === undefined) {
      return c.json({ error: "没有可更新的字段" }, 400);
    }
    let project: Project | undefined;
    if (input.name !== undefined) {
      project = await context.store.renameProject(id, input.name);
    }
    if (input.pinned !== undefined) {
      project = await context.store.setProjectPinned(id, input.pinned);
    }
    return c.json({ project });
  });

  app.delete("/:projectId", async (c) => {
    return c.json({ deleted: await context.store.deleteProject(c.req.param("projectId")) });
  });

  app.get("/:projectId/git/changes", async (c) => {
    const project = await context.store.getProject(c.req.param("projectId"));
    if (!project) {
      return c.json({ error: "项目不存在" }, 404);
    }
    return c.json({ changes: await collectGitChanges(project.path) });
  });

  app.get("/:projectId/git/info", async (c) => {
    const project = await context.store.getProject(c.req.param("projectId"));
    if (!project) {
      return c.json({ error: "项目不存在" }, 404);
    }
    const isRepo = await detectGitRepository(project.path);
    console.debug(`[projects] Git 信息读取完成 projectId=${project.id} isRepo=${isRepo}`);
    return c.json({ info: { isRepo } });
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

  app.get("/:projectId/files/tree", async (c) => {
    const project = await context.store.getProject(c.req.param("projectId"));
    if (!project) {
      console.warn(`[projects] 文件树读取失败：项目不存在 projectId=${c.req.param("projectId")}`);
      return c.json({ error: "项目不存在" }, 404);
    }
    const path = c.req.query("path") ?? ".";
    try {
      const entries = await listProjectDirectoryEntries(project.path, path);
      console.debug(
        `[projects] 文件树目录读取完成 projectId=${project.id} path=${path} count=${entries.length}`
      );
      return c.json({ entries });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[projects] 文件树目录读取失败 projectId=${project.id} path=${path}: ${message}`
      );
      return c.json({ error: message }, 400);
    }
  });

  return app;
}
