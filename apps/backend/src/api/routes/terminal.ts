import { Hono } from "hono";
import { terminalExecRequestSchema } from "@chengxiaobang/shared";
import { runCommand } from "../../tools/shell";
import type { AppContext } from "../context";

export function terminalRoutes(context: AppContext): Hono {
  const app = new Hono();

  app.post("/exec", async (c) => {
    const input = terminalExecRequestSchema.parse(await c.req.json());
    const project = await context.store.getProject(input.projectId);
    if (!project) {
      return c.json({ error: "项目不存在" }, 404);
    }
    return c.json({ result: await runCommand(input.command, project.path) });
  });

  return app;
}
