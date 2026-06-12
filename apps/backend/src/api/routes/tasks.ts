import { Hono } from "hono";
import { scheduledTaskUpdateSchema } from "@chengxiaobang/shared";
import { computeNextRunAt, validateCron } from "../../tasks/schedule";
import type { AppContext } from "../context";

export function taskRoutes(context: AppContext): Hono {
  const app = new Hono();

  app.get("/", async (c) => c.json({ tasks: await context.store.listScheduledTasks() }));

  app.patch("/:taskId", async (c) => {
    const taskId = c.req.param("taskId");
    const input = scheduledTaskUpdateSchema.parse(await c.req.json());
    if (input.cron) {
      const cronError = validateCron(input.cron);
      if (cronError) {
        console.warn(`[api/tasks] cron 校验失败 taskId=${taskId}: ${cronError}`);
        return c.json({ error: cronError }, 400);
      }
    }
    const current = await context.store.getScheduledTask(taskId);
    if (!current) {
      return c.json({ error: "定时任务不存在" }, 404);
    }
    // cron 变更或重新启用时重算 nextRunAt：停用很久的任务一启用不应
    // 立刻“补跑”陈旧的时间点。
    const reEnabled = input.enabled === true && !current.enabled;
    const nextRunAt =
      input.cron || reEnabled
        ? computeNextRunAt(input.cron ?? current.cron, new Date())
        : undefined;
    const task = await context.store.updateScheduledTask(taskId, {
      ...input,
      ...(nextRunAt ? { nextRunAt } : {})
    });
    return c.json({ task });
  });

  app.delete("/:taskId", async (c) => {
    return c.json({ deleted: await context.store.deleteScheduledTask(c.req.param("taskId")) });
  });

  app.post("/:taskId/run", async (c) => {
    const taskId = c.req.param("taskId");
    const scheduler = context.taskScheduler;
    if (!scheduler) {
      return c.json({ error: "调度器未启用" }, 503);
    }
    const task = await context.store.getScheduledTask(taskId);
    if (!task) {
      return c.json({ error: "定时任务不存在" }, 404);
    }
    // fire-and-forget：执行可能耗时数分钟，结果经任务行的 lastStatus 反映。
    void scheduler.runNow(taskId).catch((error) => {
      console.error(`[api/tasks] 立即运行失败 taskId=${taskId}:`, error);
    });
    return c.json({ ok: true }, 202);
  });

  return app;
}
