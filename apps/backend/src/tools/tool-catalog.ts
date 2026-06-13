import { TOOL_DEFINITIONS, type ToolDefinition } from "./tool-schemas";

export type PlanPhase = "none" | "draft" | "execute";

const READ_ONLY_TOOLS = new Set([
  "list_directory",
  "read_file",
  "glob",
  "search",
  "git_status",
  "git_diff",
  "fetch_url",
  "web_search"
]);
/** 起草阶段额外可见：提计划、提问、旁注、按需取技能、读写长期记忆。 */
const DRAFT_EXTRA = new Set(["propose_plan", "ask_user", "btw", "use_skill", "memory"]);

/**
 * 按阶段/通道裁剪模型可见的工具表（纯函数，直接单测）：
 * - viaFeishu：剔除 propose_plan 与 ask_user —— 飞书 full_access 分支不消费
 *   tool_call_pending（feishu-service.ts:165），暴露阻塞型工具必死锁；read-only
 *   分支会把提问自动拒绝，语义错乱。计划模式不对飞书通道开放（飞书 RunRequest
 *   不带 planMode，默认 false）。
 * - draft（planMode 且计划未确认）：只读工具 + propose_plan/ask_user/btw/use_skill。
 *   模型根本看不到写类工具，不浪费轮次去试；不依赖 DeepSeek 兼容端点会忽略的
 *   forced tool_choice。runModelTool 的 planConfirmed 门是第二道防线（§2.3-4）。
 * - execute（计划已确认）：恢复普通工具，但不再含 propose_plan/update_plan；新版计划模式
 *   确认后直接执行，不维护逐步进度。
 * - none：全量，但不含 propose_plan/update_plan（非计划模式没有计划工具）。
 */
export function selectToolDefinitions(opts: {
  planPhase: PlanPhase;
  viaFeishu: boolean;
}): ToolDefinition[] {
  const visible = (name: string): boolean => {
    if (opts.viaFeishu && (name === "propose_plan" || name === "ask_user")) return false;
    if (opts.viaFeishu && (name === "todo_create" || name === "todo_update")) return false;
    if (name === "todo_create" || name === "todo_update") return opts.planPhase === "none";
    switch (opts.planPhase) {
      case "draft":
        return READ_ONLY_TOOLS.has(name) || DRAFT_EXTRA.has(name);
      case "execute":
        return name !== "propose_plan" && name !== "update_plan";
      case "none":
        return name !== "propose_plan" && name !== "update_plan";
    }
  };
  return TOOL_DEFINITIONS.filter((def) => visible(def.function.name));
}
