import { basename } from "node:path";
import { Hono } from "hono";
import {
  gitCheckoutBranchInputSchema,
  gitChangeScopeSchema,
  gitCommitInputSchema,
  gitCreateBranchInputSchema,
  projectInputSchema,
  projectUpdateSchema,
  type Project
} from "@chengxiaobang/shared";
import {
  checkoutGitBranch,
  collectGitChanges,
  collectGitEnvironment,
  collectGitFileDiff,
  collectGitGraph,
  collectGitInfo,
  commitGitChanges,
  createGitBranch,
  pushGitBranch
} from "../../tools/git-changes";
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

  app.get("/:projectId/git/environment", async (c) => {
    const project = await context.store.getProject(c.req.param("projectId"));
    if (!project) {
      return c.json({ error: "项目不存在" }, 404);
    }
    const environment = await collectGitEnvironment(project.path);
    log.debug("[projects] Git 环境读取完成", {
      projectId: project.id,
      isRepo: environment.isRepo,
      branchName: environment.branchName,
      changedFileCount: environment.changedFileCount,
      branchCount: environment.branches.length
    });
    return c.json({ environment });
  });

  app.get("/:projectId/git/graph", async (c) => {
    const project = await context.store.getProject(c.req.param("projectId"));
    if (!project) {
      return c.json({ error: "项目不存在" }, 404);
    }
    const limitRaw = c.req.query("limit");
    const limit = limitRaw ? Number(limitRaw) : undefined;
    try {
      const graph = await collectGitGraph(project.path, { limit });
      log.debug("[projects] Git 图谱读取完成", {
        projectId: project.id,
        isRepo: graph.isRepo,
        commitCount: graph.commits.length
      });
      return c.json({ graph });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.warn("[projects] Git 图谱读取失败", { projectId: project.id, error: message });
      return c.json({ error: message }, 500);
    }
  });

  app.post("/:projectId/git/checkout", async (c) => {
    const project = await context.store.getProject(c.req.param("projectId"));
    if (!project) {
      return c.json({ error: "项目不存在" }, 404);
    }
    const input = gitCheckoutBranchInputSchema.parse(await c.req.json());
    try {
      const result = await checkoutGitBranch(project.path, input);
      log.info("[projects] Git 分支切换完成", {
        projectId: project.id,
        branchName: input.branchName,
        branchType: input.branchType
      });
      return c.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.warn("[projects] Git 分支切换失败", {
        projectId: project.id,
        branchName: input.branchName,
        branchType: input.branchType,
        error: message
      });
      return c.json({ error: message }, 400);
    }
  });

  app.post("/:projectId/git/branches", async (c) => {
    const project = await context.store.getProject(c.req.param("projectId"));
    if (!project) {
      return c.json({ error: "项目不存在" }, 404);
    }
    const input = gitCreateBranchInputSchema.parse(await c.req.json());
    try {
      const result = await createGitBranch(project.path, input);
      log.info("[projects] Git 分支创建完成", {
        projectId: project.id,
        branchName: input.branchName
      });
      return c.json(result, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.warn("[projects] Git 分支创建失败", {
        projectId: project.id,
        branchName: input.branchName,
        error: message
      });
      return c.json({ error: message }, 400);
    }
  });

  app.post("/:projectId/git/commit", async (c) => {
    const project = await context.store.getProject(c.req.param("projectId"));
    if (!project) {
      return c.json({ error: "项目不存在" }, 404);
    }
    const input = gitCommitInputSchema.parse(await c.req.json());
    try {
      const result = await commitGitChanges(project.path, input, {
        generateMessage: input.message?.trim()
          ? undefined
          : async ({ status, diff }) => {
              if (!input.sessionId) {
                throw new Error("缺少会话，无法生成提交信息");
              }
              return context.runner.generateCommitMessageForSession({
                sessionId: input.sessionId,
                status,
                diff
              });
            }
      });
      log.info("[projects] Git 提交完成", {
        projectId: project.id,
        commitHash: result.commitHash,
        generatedMessage: !input.message?.trim()
      });
      return c.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.warn("[projects] Git 提交失败", {
        projectId: project.id,
        includeUnstaged: input.includeUnstaged,
        generatedMessage: !input.message?.trim(),
        error: message
      });
      return c.json({ error: message }, 400);
    }
  });

  app.post("/:projectId/git/push", async (c) => {
    const project = await context.store.getProject(c.req.param("projectId"));
    if (!project) {
      return c.json({ error: "项目不存在" }, 404);
    }
    try {
      const result = await pushGitBranch(project.path);
      log.info("[projects] Git 推送完成", { projectId: project.id });
      return c.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.warn("[projects] Git 推送失败", { projectId: project.id, error: message });
      return c.json({ error: message }, 400);
    }
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
