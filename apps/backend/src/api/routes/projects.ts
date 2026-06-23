import { basename } from "node:path";
import { Hono } from "hono";
import {
  gitChangeScopeSchema,
  projectInputSchema,
  projectUpdateSchema,
  type Project
} from "@chengxiaobang/shared";
import { collectGitChanges, collectGitFileDiff, collectGitInfo } from "../../tools/git-changes";
import { listProjectDirectoryEntries, listProjectFiles } from "../../tools/workspace";
import type { AppContext } from "../context";

import { getLogger } from "../../logging/logger";

const log = getLogger({ module: "api/routes/projects" });

function parseRequiredPage(query: (name: string) => string | undefined):
  | { ok: true; limit: number; offset: number }
  | { ok: false; error: string } {
  const limitRaw = query("limit");
  const offsetRaw = query("offset");
  const limit = Number(limitRaw);
  const offset = Number(offsetRaw);
  if (!limitRaw || !offsetRaw || !Number.isInteger(limit) || !Number.isInteger(offset)) {
    return { ok: false, error: "缺少有效的分页参数 limit/offset" };
  }
  if (limit < 1 || offset < 0) {
    return { ok: false, error: "分页参数 limit/offset 超出范围" };
  }
  return { ok: true, limit, offset };
}

function parsePinned(value: string | undefined): boolean {
  return value === "true";
}

export function projectRoutes(context: AppContext): Hono {
  const app = new Hono();

  app.get("/", async (c) => {
    const page = parseRequiredPage((name) => c.req.query(name));
    if (!page.ok) {
      return c.json({ error: page.error }, 400);
    }
    const sortParam = c.req.query("sort");
    if (sortParam && sortParam !== "created" && sortParam !== "recent") {
      return c.json({ error: "项目排序参数无效" }, 400);
    }
    const sort: "created" | "recent" = sortParam === "recent" ? "recent" : "created";
    const pinned = parsePinned(c.req.query("pinned"));
    const result = await context.store.listProjects({
      limit: page.limit,
      offset: page.offset,
      sort,
      pinned
    });
    log.debug("[projects] 返回项目分页列表", {
      limit: page.limit,
      offset: page.offset,
      sort,
      pinned,
      count: result.items.length,
      total: result.total
    });
    return c.json(result);
  });

  app.get("/:projectId", async (c) => {
    const project = await context.store.getProject(c.req.param("projectId"));
    if (!project) {
      return c.json({ error: "项目不存在" }, 404);
    }
    return c.json({ project });
  });

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

  app.get("/:projectId/git/changes/diff", async (c) => {
    const project = await context.store.getProject(c.req.param("projectId"));
    if (!project) {
      return c.json({ error: "项目不存在" }, 404);
    }
    const scope = gitChangeScopeSchema.safeParse(c.req.query("scope"));
    const path = c.req.query("path");
    if (!scope.success || !path) {
      return c.json({ error: "缺少有效的 scope 或 path" }, 400);
    }
    try {
      const file = await collectGitFileDiff(project.path, { scope: scope.data, path });
      if (!file) {
        return c.json({ error: "变更文件不存在" }, 404);
      }
      log.debug("[projects] Git 单文件 diff 读取完成", {
        projectId: project.id,
        scope: scope.data,
        path,
        emptyDiff: file.diff.length === 0
      });
      return c.json({ file });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.warn("[projects] Git 单文件 diff 读取失败", {
        projectId: project.id,
        scope: scope.data,
        path,
        error: message
      });
      return c.json({ error: message }, 500);
    }
  });

  app.get("/:projectId/git/info", async (c) => {
    const project = await context.store.getProject(c.req.param("projectId"));
    if (!project) {
      return c.json({ error: "项目不存在" }, 404);
    }
    const info = await collectGitInfo(project.path);
    log.debug("[projects] Git 信息读取完成", {
      projectId: project.id,
      isRepo: info.isRepo,
      hasBranchName: Boolean(info.branchName)
    });
    return c.json({ info });
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
      log.warn(`[projects] 文件树读取失败：项目不存在 projectId=${c.req.param("projectId")}`);
      return c.json({ error: "项目不存在" }, 404);
    }
    const path = c.req.query("path") ?? ".";
    try {
      const entries = await listProjectDirectoryEntries(project.path, path);
      log.debug(
        `[projects] 文件树目录读取完成 projectId=${project.id} path=${path} count=${entries.length}`
      );
      return c.json({ entries });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.warn(
        `[projects] 文件树目录读取失败 projectId=${project.id} path=${path}: ${message}`
      );
      return c.json({ error: message }, 400);
    }
  });

  return app;
}
