import { Hono } from "hono";
import { scheduledTaskUpdateSchema } from "@chengxiaobang/shared";
import { computeNextRunAt, normalizeRunAt, validateCron, validateRunAt } from "../../tasks/schedule";
import type { AppContext } from "../context";

import { getLogger } from "../../logging/logger";

const log = getLogger({ module: "api/routes/tasks" });

export function taskRoutes(context: AppContext): Hono {
  const app = new Hono();

  app.get("/", async (c) => c.json({ tasks: await context.store.listScheduledTasks() }));

  app.patch("/:taskId", async (c) => {
    const taskId = c.req.param("taskId");
    const input = scheduledTaskUpdateSchema.parse(await c.req.json());
    if (input.cron) {
      const cronError = validateCron(input.cron);
      if (cronError) {
        log.warn(`[api/tasks] cron 校验失败 taskId=${taskId}: ${cronError}`);
        return c.json({ error: cronError }, 400);
      }
    }
    const current = await context.store.getScheduledTask(taskId);
    if (!current) {
      return c.json({ error: "定时任务不存在" }, 404);
    }
    if (input.cron && current.kind !== "recurring") {
      log.warn(`[api/tasks] 拒绝修改一次性任务 cron taskId=${taskId}`);
      return c.json({ error: "一次性任务不支持修改 cron，请重新创建一次性任务。" }, 400);
    }
    if (input.runAt && current.kind !== "once") {
      log.warn(`[api/tasks] 拒绝修改周期任务 runAt taskId=${taskId}`);
      return c.json({ error: "周期任务不支持 runAt，请修改 cron。" }, 400);
    }
    // cron 变更或重新启用时重算 nextRunAt：停用很久的任务一启用不应
    // 立刻“补跑”陈旧的时间点。
    const reEnabled = input.enabled === true && !current.enabled;
    let normalizedRunAt: string | undefined;
    let nextRunAt: string | null | undefined;
    if (current.kind === "once") {
      if (input.runAt) {
        const runAtError = validateRunAt(input.runAt);
        if (runAtError) {
          log.warn(`[api/tasks] runAt 校验失败 taskId=${taskId}: ${runAtError}`);
          return c.json({ error: runAtError }, 400);
        }
        normalizedRunAt = normalizeRunAt(input.runAt);
        nextRunAt = normalizedRunAt;
      } else if (reEnabled && !current.nextRunAt) {
        log.warn(`[api/tasks] 拒绝重新启用已过期一次性任务 taskId=${taskId}`);
        return c.json({ error: "一次性任务已过期，不能直接重新启用，请重新创建任务。" }, 400);
      }
    } else if (input.cron || reEnabled) {
      nextRunAt = computeNextRunAt(input.cron ?? current.cron!, new Date());
    }
    const task = await context.store.updateScheduledTask(taskId, {
      ...input,
      ...(normalizedRunAt ? { runAt: normalizedRunAt } : {}),
      ...(nextRunAt !== undefined ? { nextRunAt } : {})
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
      log.error(`[api/tasks] 立即运行失败 taskId=${taskId}:`, error);
    });
    return c.json({ ok: true }, 202);
  });

  return app;
}
