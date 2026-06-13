import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { FeishuSender } from "../feishu/feishu-bridge";
import type { WebSearchExecutor } from "../web-search/web-search-config-service";
import { createFsTools } from "./fs-tools";
import { createShellTools } from "./shell-tools";
import { createWebTools } from "./web-tools";
import { createFeishuTools } from "./feishu-tools";
import { createMemoryTools } from "./memory-tools";
import { createSkillTools } from "./skill-tools";
import type { SkillMarketService } from "./skill-market-service";

export type PlanPhase = "none" | "draft" | "execute";

const MUTATING_TOOLS = new Set<string>([
  "write_file",
  "edit_file",
  "make_directory",
  "shell",
  // 主动向外发消息也需要用户同意；审批门控也能保证飞书只读运行不会自行发消息。
  "feishu_send_message",
  // 创建/取消定时任务会改变后台行为，需用户在审批卡上看到 cron 后确认。
  "schedule_create",
  "schedule_cancel",
  // 安装技能会向全局技能目录写入文件、改变后续可用能力，需用户确认。
  "create_skill"
]);

const READ_ONLY_TOOLS = new Set<string>([
  "list_directory",
  "read_file",
  "glob",
  "search",
  "shell_status",
  "shell_cancel",
  "git_status",
  "git_diff",
  "fetch_url",
  "web_search",
  "schedule_list"
]);

// memory 在起草阶段也可见：制定计划前先查记忆，规划中的发现也值得随手记录。
const DRAFT_EXTRA_TOOLS = new Set<string>(["propose_plan", "ask_user", "btw", "use_skill", "memory"]);

export function requiresApproval(name: string): boolean {
  return MUTATING_TOOLS.has(name);
}

export function isMutatingTool(name: string): boolean {
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
    // todo 是桌面端旁观进度，不在正式计划、飞书或无人值守场景里混用。
    if (tool.name === "todo_create" || tool.name === "todo_update") {
      return options.planPhase === "none" && !options.viaFeishu && !options.headless;
    }
    if (options.planPhase === "draft") {
      return READ_ONLY_TOOLS.has(tool.name) || DRAFT_EXTRA_TOOLS.has(tool.name);
    }
    if (options.planPhase === "execute") {
      return tool.name !== "propose_plan" && tool.name !== "update_plan";
    }
    return tool.name !== "propose_plan" && tool.name !== "update_plan";
  });
}

/** 绑定到工作区的基础工具；飞书 sender 因构造顺序需要懒解析。 */
export function createAgentTools(
  workspacePath: string,
  optionsOrFeishuSender?:
    | (() => FeishuSender | undefined)
    | {
        getFeishuSender?: () => FeishuSender | undefined;
        webSearch?: WebSearchExecutor;
        /** 长期记忆的落盘目录；提供时注册 memory 工具。 */
        memoryDir?: string;
        /** 技能市场服务；提供时注册 create_skill 工具（对话内创建/安装技能）。 */
        skillMarketService?: SkillMarketService;
      }
): AgentTool<any>[] {
  const options =
    typeof optionsOrFeishuSender === "function"
      ? { getFeishuSender: optionsOrFeishuSender }
      : (optionsOrFeishuSender ?? {});
  return [
    ...createFsTools(workspacePath),
    ...createShellTools(workspacePath),
    ...createWebTools(options.webSearch),
    ...createFeishuTools(options.getFeishuSender),
    ...(options.memoryDir ? createMemoryTools(options.memoryDir) : []),
    ...(options.skillMarketService
      ? createSkillTools({ skillMarketService: options.skillMarketService })
      : [])
  ];
}

export function findTool(
  tools: AgentTool<any>[],
  name: string
): AgentTool<any> | undefined {
  return tools.find((tool) => tool.name === name);
}
