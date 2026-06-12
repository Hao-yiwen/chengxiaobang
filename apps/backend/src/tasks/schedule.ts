import { Cron } from "croner";

/**
 * cron 工具的薄封装：全仓只在这里接触 croner，调度器与工具层
 * 只消费这两个纯函数，便于单测与替换。
 *
 * 约定：5 字段 cron（分 时 日 月 周），按本地时区解释；
 * croner 额外支持 6 字段（秒），这里显式拒绝以锁定语义。
 */

/** 返回错误信息；undefined 表示合法。 */
export function validateCron(cron: string): string | undefined {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) {
    return `cron 表达式必须是 5 个字段（分 时 日 月 周），收到 ${fields.length} 个：${cron}`;
  }
  try {
    new Cron(cron, { paused: true });
    return undefined;
  } catch (error) {
    return `cron 表达式无效：${error instanceof Error ? error.message : String(error)}`;
  }
}

/**
 * 从 from 起算的下一次触发时间（UTC ISO）。
 * cron 无下一次触发（理论上 5 字段不会发生）或表达式非法时抛错。
 */
export function computeNextRunAt(cron: string, from: Date): string {
  const next = new Cron(cron, { paused: true }).nextRun(from);
  if (!next) {
    throw new Error(`cron 表达式没有下一次触发时间：${cron}`);
  }
  return next.toISOString();
}
