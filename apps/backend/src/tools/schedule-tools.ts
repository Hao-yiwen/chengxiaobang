import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Cron } from "croner";
import type { StateStore } from "../repository/state-store";
import { computeNextRunAt, normalizeRunAt, validateCron, validateRunAt } from "../tasks/schedule";
import { textResult } from "./tool-result";

import { getLogger } from "../logging/logger";

const log = getLogger({ module: "tools/schedule-tools" });

const scheduleParams = Type.Object({
  action: Type.Union([Type.Literal("create"), Type.Literal("list"), Type.Literal("cancel")], {
    description: "要执行的定时任务操作：create 创建，list 查看，cancel 取消"
  }),
  kind: Type.Optional(Type.Union([Type.Literal("once"), Type.Literal("recurring")], {
    description:
      "action=create 时必填。任务类型：once 表示指定绝对时间只执行一次，recurring 表示按 5 字段 cron 周期重复执行。"
  })),
  name: Type.Optional(Type.String({ description: "action=create 时必填。任务名称，简短易认，例如「AI 日报」" })),
  cron: Type.Optional(
    Type.String({
      description:
        "action=create 且 kind=recurring 时必填。5 字段 cron 表达式（分 时 日 月 周），按本地时区解释。例如：每天 9 点 = 0 9 * * *，每 5 分钟 = */5 * * * *，工作日 8:30 = 30 8 * * 1-5"
    })
  ),
  run_at: Type.Optional(
    Type.String({
      description:
        "action=create 且 kind=once 时必填。一次性任务的绝对执行时间，必须带时区，例如 2026-06-13T01:53:00+08:00。适用于「明天 9 点提醒我」「某天某时执行一次」。"
    })
  ),
  prompt: Type.Optional(Type.String({
    description: "action=create 时必填。执行时喂给模型的完整提示词；执行发生在当前会话中，可以依赖已有上下文"
  })),
  full_access: Type.Optional(
    Type.Boolean({
      description:
        "action=create 可选。默认 false：执行时为只读，写文件/执行命令等操作会被自动拒绝。仅当任务确实需要修改文件或执行命令、且用户明确同意时才设为 true"
    })
  ),
  id: Type.Optional(Type.String({ description: "action=cancel 时必填。要取消的定时任务 ID（可用 Schedule action=list 查询）" }))
});

type ScheduleParams = {
  action: "create" | "list" | "cancel";
  kind?: "once" | "recurring";
  name?: string;
  cron?: string;
  run_at?: string;
  prompt?: string;
  full_access?: boolean;
  id?: string;
};

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
  const scheduleTool: AgentTool<typeof scheduleParams> = {
    name: "Schedule",
    label: "管理定时任务",
    description:
      "管理定时任务：action=create 创建任务，kind=once 用带时区 ISO 时间 run_at 创建具体某天某时只执行一次的任务，kind=recurring 用 5 字段 cron 创建每天、每周或每隔一段时间重复执行的周期任务；action=list 查看任务；action=cancel 按 id 取消任务。不要用 cron 表达一次性任务。",
    parameters: scheduleParams,
    execute: async (_toolCallId, params) => {
      const input = params as ScheduleParams;
      switch (input.action) {
        case "create":
          return createTask(runtime, input);
        case "list":
          return listTasks(runtime);
        case "cancel":
          return cancelTask(runtime, input);
        default:
          throw new Error(`未知的定时任务操作：${String(input.action)}`);
      }
    }
  };

  return [scheduleTool];
}

async function createTask(runtime: ScheduleToolRuntime, params: ScheduleParams) {
  const kind = requireScheduleKind(params.kind);
  const name = requireStringParam(params.name, "name", "create");
  const prompt = requireStringParam(params.prompt, "prompt", "create");
  if (runtime.feishuChatId || runtime.wechatChatId) {
    const channel = runtime.wechatChatId ? "微信" : "飞书";
    log.warn(
      `[schedule-tools] ${channel}会话拒绝创建定时任务 sessionId=${runtime.sessionId}`
    );
    throw new Error(`${channel}会话暂不支持定时任务（执行结果无法回发${channel}），请在桌面端会话中创建。`);
  }

  if (kind === "once") {
    if (!params.run_at) {
      log.warn(
        `[schedule-tools] 一次性任务缺少 run_at sessionId=${runtime.sessionId} name=${name}`
      );
      throw new Error("一次性定时任务必须传入 run_at（带时区的 ISO 8601 绝对时间）。");
    }
    if (params.cron) {
      log.warn(
        `[schedule-tools] 一次性任务不接受 cron sessionId=${runtime.sessionId} name=${name} cron=${params.cron}`
      );
      throw new Error("一次性定时任务请使用 run_at，不要传入 cron。");
    }
    const runAtError = validateRunAt(params.run_at);
    if (runAtError) {
      log.warn(`[schedule-tools] run_at 校验失败 runAt=${params.run_at}: ${runAtError}`);
      throw new Error(runAtError);
    }
    const runAt = normalizeRunAt(params.run_at);
    const task = await runtime.store.createScheduledTask({
      sessionId: runtime.sessionId,
      name,
      prompt,
      kind: "once",
      runAt,
      fullAccess: params.full_access ?? false,
      nextRunAt: runAt
    });
    log.info(
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
    log.warn(
      `[schedule-tools] 周期任务缺少 cron sessionId=${runtime.sessionId} name=${name}`
    );
    throw new Error("周期定时任务必须传入 cron（5 字段 cron 表达式）。");
  }
  if (params.run_at) {
    log.warn(
      `[schedule-tools] 周期任务不接受 run_at sessionId=${runtime.sessionId} name=${name} runAt=${params.run_at}`
    );
    throw new Error("周期定时任务请使用 cron，不要传入 run_at。");
  }
  const cronError = validateCron(params.cron);
  if (cronError) {
    log.warn(`[schedule-tools] cron 校验失败 cron=${params.cron}: ${cronError}`);
    throw new Error(cronError);
  }
  const task = await runtime.store.createScheduledTask({
    sessionId: runtime.sessionId,
    name,
    prompt,
    kind: "recurring",
    cron: params.cron,
    fullAccess: params.full_access ?? false,
    nextRunAt: computeNextRunAt(params.cron, new Date())
  });
  const upcoming = previewRuns(params.cron, 2);
  log.info(
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

async function listTasks(runtime: ScheduleToolRuntime) {
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

async function cancelTask(runtime: ScheduleToolRuntime, params: ScheduleParams) {
  const id = requireStringParam(params.id, "id", "cancel");
  const deleted = await runtime.store.deleteScheduledTask(id);
  if (!deleted) {
    log.warn(`[schedule-tools] 取消定时任务失败：不存在 id=${id}`);
    throw new Error(`定时任务不存在：${id}`);
  }
  log.info(`[schedule-tools] 已取消定时任务 id=${id}`);
  return textResult(`已取消定时任务 ${id}。`);
}

function requireScheduleKind(kind: ScheduleParams["kind"]): "once" | "recurring" {
  if (kind !== "once" && kind !== "recurring") {
    throw new Error("Schedule action=create 必须传入 kind（once 或 recurring）。");
  }
  return kind;
}

function requireStringParam(value: string | undefined, name: string, action: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Schedule action=${action} 必须传入 ${name}。`);
  }
  return value;
}
