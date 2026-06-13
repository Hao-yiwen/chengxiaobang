import type { ToolName } from "@chengxiaobang/shared";

export interface ToolDefinition {
  type: "function";
  function: {
    name: ToolName;
    description: string;
    parameters: Record<string, unknown>;
  };
}

const emptyParameters = {
  type: "object",
  properties: {},
  additionalProperties: true
};

function defineTool(name: ToolName, description: string): ToolDefinition {
  return {
    type: "function",
    function: {
      name,
      description,
      // 这里只给模型目录和阶段裁剪使用，真实执行参数以各 tool 工厂中的 TypeBox schema 为准。
      parameters: emptyParameters
    }
  };
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  defineTool("read_file", "读取工作区中的文本文件，可用 startLine/lineLimit 分段读取大文件。"),
  defineTool("write_file", "写入或覆盖工作区中的文本文件，也可用 startLine/deleteLineCount 做行级写入。"),
  defineTool("edit_file", "对已有文件执行精确文本替换，也可用 startLine/deleteLineCount 做行级编辑。"),
  defineTool("list_directory", "列出工作区目录内容。"),
  defineTool("shell", "在工作区执行 shell 命令。"),
  defineTool("shell_status", "查看后台 shell 命令的状态和输出文件路径。"),
  defineTool("shell_cancel", "终止仍在后台执行的 shell 命令。"),
  defineTool("git_status", "查看 Git 状态。"),
  defineTool("git_diff", "查看 Git 变更摘要。"),
  defineTool("glob", "按通配符查找文件。"),
  defineTool("search", "搜索工作区文本内容。"),
  defineTool("make_directory", "创建目录。"),
  defineTool("fetch_url", "抓取网页或接口文本内容。"),
  defineTool("web_search", "使用 Tavily 纯搜索 API 查询公网信息。"),
  defineTool("feishu_send_message", "向飞书会话发送消息。"),
  defineTool("propose_plan", "在计划模式中提交完整 Markdown 执行计划。"),
  defineTool("update_plan", "旧版计划进度工具，仅用于历史兼容。"),
  defineTool("ask_user", "向用户提出需要确认的问题。"),
  defineTool("btw", "记录旁注或后续提醒。"),
  defineTool("use_skill", "按需加载技能上下文。"),
  defineTool("todo_create", "为稍复杂任务创建 AI 自用执行清单。"),
  defineTool("todo_update", "更新 AI 自用执行清单中的步骤进度。"),
  defineTool("memory", "读写跨会话长期记忆（/memories 目录）。")
];
