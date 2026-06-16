import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Cron } from "croner";
import type { StateStore } from "../repository/state-store";
import { computeNextRunAt, normalizeRunAt, validateCron, validateRunAt } from "../tasks/schedule";
import { textResult } from "./tool-result";

const createParams = Type.Object({
  kind: Type.Union([Type.Literal("once"), Type.Literal("recurring")], {
    description:
      "任务类型：once 表示指定绝对时间只执行一次，recurring 表示按 5 字段 cron 周期重复执行。"
  }),
  name: Type.String({ description: "任务名称，简短易认，例如「AI 日报」" }),
  cron: Type.Optional(
    Type.String({
      description:
        "kind=recurring 时必填。5 字段 cron 表达式（分 时 日 月 周），按本地时区解释。例如：每天 9 点 = 0 9 * * *，每 5 分钟 = */5 * * * *，工作日 8:30 = 30 8 * * 1-5"
    })
  ),
  run_at: Type.Optional(
    Type.String({
      description:
        "kind=once 时必填。一次性任务的绝对执行时间，必须带时区，例如 2026-06-13T01:53:00+08:00。适用于「明天 9 点提醒我」「某天某时执行一次」。"
    })
  ),
  prompt: Type.String({
    description: "执行时喂给模型的完整提示词；执行发生在当前会话中，可以依赖已有上下文"
  }),
  full_access: Type.Optional(
    Type.Boolean({
      description:
        "默认 false：执行时为只读，写文件/执行命令等操作会被自动拒绝。仅当任务确实需要修改文件或执行命令、且用户明确同意时才设为 true"
    })
  )
});

const cancelParams = Type.Object({
  id: Type.String({ description: "要取消的定时任务 ID（可用 ScheduleList 查询）" })
});

const listParams = Type.Object({});

export interface ScheduleToolRuntime {
  store: StateStore;
  /** 任务绑定的会话：到点后在该会话中追加执行。 */
  sessionId: string;
  /** 飞书绑定会话不支持创建（执行结果不会回发飞书，会成为静默黑洞）。 */
  feishuChatId?: string;
  /** 微信绑定会话不支持创建（执行结果不会回发微信，会成为静默黑洞）。 */
  wechatChatId?: string;
}

/** 本地时间字符串，给模型/用户复述用。 */
function formatLocal(iso: string): string {
  return new Date(iso).toLocaleString("zh-CN", { hour12: false });
}

/** 接下来 count 次触发时间（本地格式），创建后让模型复述以自检 cron 正确性。 */
function previewRuns(cron: string, count: number): string[] {
  const job = new Cron(cron, { paused: true });
  const result: string[] = [];
  let from = new Date();
  for (let index = 0; index < count; index += 1) {
    const next = job.nextRun(from);
    if (!next) {
      break;
    }
    result.push(next.toLocaleString("zh-CN", { hour12: false }));
    from = next;
  }
  return result;
}

export function createScheduleTools(runtime: ScheduleToolRuntime): AgentTool<any>[] {
  const scheduleCreate: AgentTool<typeof createParams> = {
    name: "ScheduleCreate",
    label: "创建定时任务",
    description:
      "创建定时任务：kind=once 用带时区 ISO 时间 run_at 创建一次性任务；kind=recurring 用 5 字段 cron 创建周期任务。具体某天某时执行一次不要用 cron 表达。",
    parameters: createParams,
    execute: async (_toolCallId, params) => {
      if (runtime.feishuChatId || runtime.wechatChatId) {
        const channel = runtime.wechatChatId ? "微信" : "飞书";
        console.warn(
          `[schedule-tools] ${channel}会话拒绝创建定时任务 sessionId=${runtime.sessionId}`
        );
        throw new Error(`${channel}会话暂不支持定时任务（执行结果无法回发${channel}），请在桌面端会话中创建。`);
      }

      if (params.kind === "once") {
        if (!params.run_at) {
          console.warn(
            `[schedule-tools] 一次性任务缺少 run_at sessionId=${runtime.sessionId} name=${params.name}`
          );
          throw new Error("一次性定时任务必须传入 run_at（带时区的 ISO 8601 绝对时间）。");
        }
        if (params.cron) {
          console.warn(
            `[schedule-tools] 一次性任务不接受 cron sessionId=${runtime.sessionId} name=${params.name} cron=${params.cron}`
          );
          throw new Error("一次性定时任务请使用 run_at，不要传入 cron。");
        }
        const runAtError = validateRunAt(params.run_at);
        if (runAtError) {
          console.warn(`[schedule-tools] run_at 校验失败 runAt=${params.run_at}: ${runAtError}`);
          throw new Error(runAtError);
        }
        const runAt = normalizeRunAt(params.run_at);
        const task = await runtime.store.createScheduledTask({
          sessionId: runtime.sessionId,
          name: params.name,
          prompt: params.prompt,
          kind: "once",
          runAt,
          fullAccess: params.full_access ?? false,
          nextRunAt: runAt
        });
        console.info(
          `[schedule-tools] 已创建一次性任务 id=${task.id} sessionId=${runtime.sessionId} runAt=${runAt} fullAccess=${task.fullAccess}`
        );
        return textResult(
          [
            `已创建一次性任务「${task.name}」（id: ${task.id}）。`,
            `计划执行时间：${formatLocal(runAt)}（${task.fullAccess ? "完全访问" : "只读执行"}）`,
            "执行完成后任务会进入侧边栏「定时任务」页的已过期任务。"
          ].join("\n")
        );
      }

      if (!params.cron) {
        console.warn(
          `[schedule-tools] 周期任务缺少 cron sessionId=${runtime.sessionId} name=${params.name}`
        );
        throw new Error("周期定时任务必须传入 cron（5 字段 cron 表达式）。");
      }
      if (params.run_at) {
        console.warn(
          `[schedule-tools] 周期任务不接受 run_at sessionId=${runtime.sessionId} name=${params.name} runAt=${params.run_at}`
        );
        throw new Error("周期定时任务请使用 cron，不要传入 run_at。");
      }
      const cronError = validateCron(params.cron);
      if (cronError) {
        console.warn(`[schedule-tools] cron 校验失败 cron=${params.cron}: ${cronError}`);
        throw new Error(cronError);
      }
      const task = await runtime.store.createScheduledTask({
        sessionId: runtime.sessionId,
        name: params.name,
        prompt: params.prompt,
        kind: "recurring",
        cron: params.cron,
        fullAccess: params.full_access ?? false,
        nextRunAt: computeNextRunAt(params.cron, new Date())
      });
      const upcoming = previewRuns(params.cron, 2);
      console.info(
        `[schedule-tools] 已创建周期任务 id=${task.id} sessionId=${runtime.sessionId} cron=${params.cron} fullAccess=${task.fullAccess}`
      );
      return textResult(
        [
          `已创建周期定时任务「${task.name}」（id: ${task.id}）。`,
          `cron: ${task.cron}（${task.fullAccess ? "完全访问" : "只读执行"}）`,
          upcoming.length > 0 ? `接下来的触发时间：${upcoming.join("、")}` : "",
          "请向用户复述触发时间以确认理解一致；可在侧边栏「定时任务」页查看和管理。"
        ]
          .filter(Boolean)
          .join("\n")
      );
    }
  };

  const scheduleList: AgentTool<typeof listParams> = {
    name: "ScheduleList",
    label: "查看定时任务",
    description: "列出当前所有定时任务（含 ID、类型、启用状态、下次/上次执行时间）。",
    parameters: listParams,
    execute: async () => {
      const tasks = await runtime.store.listScheduledTasks();
      if (tasks.length === 0) {
        return textResult("当前没有定时任务。");
      }
      const lines = tasks.map((task) => {
        const parts = [
          task.kind === "once"
            ? `- ${task.name}（id: ${task.id}）一次性任务`
            : `- ${task.name}（id: ${task.id}）周期任务 cron: ${task.cron ?? "未知"}`,
          task.enabled ? "已启用" : "已停用",
          task.sessionId === runtime.sessionId ? "本会话" : `会话 ${task.sessionId}`,
          task.kind === "once" && task.runAt ? `计划 ${formatLocal(task.runAt)}` : "",
          task.nextRunAt ? `下次 ${formatLocal(task.nextRunAt)}` : "",
          task.lastRunAt ? `上次 ${formatLocal(task.lastRunAt)}（${task.lastStatus ?? "未知"}）` : ""
        ];
        return parts.filter(Boolean).join("，");
      });
      return textResult(lines.join("\n"));
    }
  };

  const scheduleCancel: AgentTool<typeof cancelParams> = {
    name: "ScheduleCancel",
    label: "取消定时任务",
    description: "按 ID 删除一个定时任务（不可恢复）。",
    parameters: cancelParams,
    execute: async (_toolCallId, params) => {
      const deleted = await runtime.store.deleteScheduledTask(params.id);
      if (!deleted) {
        console.warn(`[schedule-tools] 取消定时任务失败：不存在 id=${params.id}`);
        throw new Error(`定时任务不存在：${params.id}`);
      }
      console.info(`[schedule-tools] 已取消定时任务 id=${params.id}`);
      return textResult(`已取消定时任务 ${params.id}。`);
    }
  };

  return [scheduleCreate, scheduleList, scheduleCancel];
}
