// 面向用户展示的错误信息归一化:把任意错误压成简短、单段的文案,
// 避免完整堆栈 / 超长 HTTP 响应体 / 多 KB JSON 被原样透传到前端,撑满展示区域。
// 注意:这里只产出给 UI 用的精简文案;完整错误应由各调用点自行写入日志后再调用本函数。

export interface NormalizeErrorMessageOptions {
  /** 最大字符数,超出后截断并追加省略号。默认 240(与既有审批摘要约定一致)。 */
  maxLength?: number;
  /** 归一化后内容为空时的回退文案,保证返回值始终非空。默认「未知错误」。 */
  fallback?: string;
}

const DEFAULT_MAX_LENGTH = 240;
const DEFAULT_FALLBACK = "未知错误";

/**
 * 将任意错误归一化为简短的单段文本。
 * 处理步骤:取出原始 message → 剥离堆栈帧 → 折叠空白/换行 → 限长加省略号 → 空则回退。
 */
export function normalizeErrorMessage(
  error: unknown,
  options?: NormalizeErrorMessageOptions
): string {
  const maxLength = options?.maxLength ?? DEFAULT_MAX_LENGTH;
  const fallback = options?.fallback ?? DEFAULT_FALLBACK;

  const collapsed = collapseWhitespace(stripStackFrames(extractRawMessage(error)));

  if (collapsed.length === 0) {
    return fallback;
  }
  if (collapsed.length <= maxLength) {
    return collapsed;
  }
  // 预留省略号位置,保证截断后总长度不超过 maxLength。
  return `${collapsed.slice(0, Math.max(0, maxLength - 1))}…`;
}

/** 从各种错误形态中取出可读的原始文本。 */
function extractRawMessage(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }
  if (error instanceof Error) {
    return error.message;
  }
  // 兼容部分库抛出的非 Error 但带 message 字段的对象。
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") {
      return message;
    }
  }
  return String(error);
}

/** 丢弃形如 "    at fn (file:line:col)" 的堆栈帧行,只保留错误描述本身。 */
function stripStackFrames(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((line) => !/^\s*at\s+/.test(line))
    .join("\n");
}

/** 将连续空白(含换行)折叠为单个空格,避免多行 / 大量缩进纵向撑高展示区域。 */
function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
