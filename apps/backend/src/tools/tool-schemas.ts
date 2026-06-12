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
  defineTool("read_file", "读取工作区中的文本文件。"),
  defineTool("write_file", "写入或覆盖工作区中的文本文件。"),
  defineTool("edit_file", "对已有文件执行精确文本替换。"),
  defineTool("list_directory", "列出工作区目录内容。"),
  defineTool("shell", "在工作区执行 shell 命令。"),
  defineTool("git_status", "查看 Git 状态。"),
  defineTool("git_diff", "查看 Git 变更摘要。"),
  defineTool("glob", "按通配符查找文件。"),
  defineTool("search", "搜索工作区文本内容。"),
  defineTool("make_directory", "创建目录。"),
  defineTool("fetch_url", "抓取网页或接口文本内容。"),
  defineTool("create_pptx", "生成 PowerPoint 文件。"),
  defineTool("create_docx", "生成 Word 文件。"),
  defineTool("create_xlsx", "生成 Excel 文件。"),
  defineTool("feishu_send_message", "向飞书会话发送消息。"),
  defineTool("propose_plan", "在计划模式中提出执行计划。"),
  defineTool("update_plan", "更新已确认计划的步骤状态。"),
  defineTool("ask_user", "向用户提出需要确认的问题。"),
  defineTool("btw", "记录旁注或后续提醒。"),
  defineTool("use_skill", "按需加载技能上下文。")
];
