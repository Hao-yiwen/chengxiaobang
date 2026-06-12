import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { FeishuSender } from "../feishu/feishu-bridge";
import { createFsTools } from "./fs-tools";
import { createShellTools } from "./shell-tools";
import { createWebTools } from "./web-tools";
import { createOfficeTools } from "./office-tools";
import { createFeishuTools } from "./feishu-tools";

export type PlanPhase = "none" | "draft" | "execute";

const MUTATING_TOOLS = new Set<string>([
  "write_file",
  "edit_file",
  "make_directory",
  "shell",
  "create_pptx",
  "create_docx",
  "create_xlsx",
  // Outbound messaging needs consent too — and being approval-gated means
  // read-only Feishu-triggered runs can never spam Feishu themselves.
  "feishu_send_message",
  // 创建/取消定时任务会改变后台行为，需用户在审批卡上看到 cron 后确认。
  "schedule_create",
  "schedule_cancel"
]);

const READ_ONLY_TOOLS = new Set<string>([
  "list_directory",
  "read_file",
  "glob",
  "search",
  "git_status",
  "git_diff",
  "fetch_url",
  "schedule_list"
]);

const DRAFT_EXTRA_TOOLS = new Set<string>(["propose_plan", "ask_user", "btw", "use_skill"]);

export function requiresApproval(name: string): boolean {
  return MUTATING_TOOLS.has(name);
}

/** 计划模式下按阶段裁剪模型可见工具；飞书/headless 通道隐藏会阻塞的计划/提问工具。 */
export function selectAgentTools(
  tools: AgentTool<any>[],
  options: { planPhase: PlanPhase; viaFeishu: boolean; headless?: boolean }
): AgentTool<any>[] {
  return tools.filter((tool) => {
    if (options.viaFeishu && (tool.name === "propose_plan" || tool.name === "ask_user")) {
      return false;
    }
    // 定时任务的无人值守执行：ask_user 无条件进入 pending_approval 等待，
    // 没有人会回答，必须在工具层面隐藏而不是依赖自动拒绝。
    if (options.headless && tool.name === "ask_user") {
      return false;
    }
    if (options.planPhase === "draft") {
      return READ_ONLY_TOOLS.has(tool.name) || DRAFT_EXTRA_TOOLS.has(tool.name);
    }
    if (options.planPhase === "execute") {
      return tool.name !== "propose_plan";
    }
    return tool.name !== "propose_plan" && tool.name !== "update_plan";
  });
}

/**
 * All builtin tools bound to a workspace. The Feishu sender is resolved lazily
 * because the FeishuService is constructed after the agent runner.
 */
export function createAgentTools(
  workspacePath: string,
  getFeishuSender?: () => FeishuSender | undefined
): AgentTool<any>[] {
  return [
    ...createFsTools(workspacePath),
    ...createShellTools(workspacePath),
    ...createWebTools(),
    ...createOfficeTools(workspacePath),
    ...createFeishuTools(getFeishuSender)
  ];
}

export function findTool(
  tools: AgentTool<any>[],
  name: string
): AgentTool<any> | undefined {
  return tools.find((tool) => tool.name === name);
}
