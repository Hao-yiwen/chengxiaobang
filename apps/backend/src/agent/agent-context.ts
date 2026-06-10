import type { AccessMode, Message } from "@chengxiaobang/shared";
import type { ModelMessage } from "../model/openai-compatible";

/** Build the system prompt that turns the model into the 程小帮 agent. */
export function buildSystemPrompt(input: {
  workspacePath: string;
  accessMode: AccessMode;
  projectName?: string;
  /** The session is driven by a Feishu chat; replies go back as plain text. */
  viaFeishu?: boolean;
}): string {
  const platform = process.platform;
  const accessLine =
    input.accessMode === "approval"
      ? "当前为「审批模式」：每次执行写文件、编辑、新建目录、运行命令或生成文档前，用户都会看到并需要点击确认。请合理拆分操作，并在调用前用简短文字说明你要做什么。"
      : "当前为「完全访问模式」：你可以直接执行工具，无需逐次确认。仍要谨慎，避免破坏性操作。";
  return [
    "你是「程小帮」，一个运行在用户 macOS 桌面上的本地 AI 助手。",
    "你能够通过工具真实地读取、创建、编辑用户本地工作目录中的文件，执行命令，并生成 PPT / Word 等文档。",
    "",
    `工作目录: ${input.workspacePath}`,
    input.projectName ? `项目名称: ${input.projectName}` : "（独立会话，使用临时工作目录）",
    `运行平台: ${platform}`,
    "",
    "## 工作方式",
    "- 当任务需要操作本地文件或环境时，主动调用工具完成，而不是只给出文字建议。",
    "- 所有文件路径都相对于工作目录；不要访问工作目录以外的路径。",
    "- 先用 list_directory / glob / search / read_file 了解现状，再动手修改。",
    "- 用户消息中以 @相对路径 形式引用的文件，请先用 read_file 读取其内容再继续。",
    "- 制作演示文稿（PPT/幻灯片）时，使用 create_pptx 工具并提供结构化的 deck 规格（标题页、章节页、要点页等），生成真正的 .pptx 文件。",
    "- 撰写 Word 文档/报告时，使用 create_docx 工具。",
    "- 需要把消息主动发送到飞书群聊/私聊时，使用 feishu_send_message 工具（用户需已在设置中配置飞书机器人）。",
    "- 完成后用简洁的中文总结你做了什么、生成了哪些文件，以及用户下一步可以怎么做。",
    "- 如果工具返回错误，阅读错误信息并尝试自行修复，不要直接放弃。",
    "",
    accessLine,
    ...(input.viaFeishu
      ? [
          "",
          "当前对话来自飞书：你的回复会以纯文本发送回飞书，请避免使用 Markdown 表格或复杂格式；不要调用 feishu_send_message 重复发送你的回复。"
        ]
      : []),
    "",
    "始终使用中文回复用户。"
  ].join("\n");
}

/**
 * Reconstruct prior conversation as plain model messages. Tool messages from
 * earlier runs are folded into user-visible context (we don't replay structured
 * tool_call linkage across runs — only within the current run does that matter).
 *
 * After a /compact, messages up to and including `compactedUpToMessageId` are
 * replaced by the latest compaction summary, hoisted to the front as a user
 * block; summary rows themselves never appear inline.
 */
export function buildHistory(
  messages: Message[],
  compactedUpToMessageId?: string
): ModelMessage[] {
  const summary = [...messages]
    .reverse()
    .find((message) => message.kind === "compaction_summary");
  const cutoffIndex = compactedUpToMessageId
    ? messages.findIndex((message) => message.id === compactedUpToMessageId)
    : -1;

  const history: ModelMessage[] = [];
  for (const [index, message] of messages.entries()) {
    if (index <= cutoffIndex || message.kind === "compaction_summary") {
      continue;
    }
    if (message.role === "system") {
      continue;
    }
    if (message.role === "tool") {
      history.push({ role: "user", content: `【工具结果】\n${message.content}` });
      continue;
    }
    history.push({ role: message.role, content: message.content });
  }
  if (summary) {
    history.unshift({ role: "user", content: `【此前对话的摘要】\n${summary.content}` });
  }
  return history;
}

/**
 * Model request asking for a compaction summary of `history` — kept separate
 * so the prompt is unit-testable without the runner.
 */
export function buildCompactionRequest(history: ModelMessage[]): ModelMessage[] {
  const transcript = history
    .map((message) => `[${message.role}]\n${message.content}`)
    .join("\n\n");
  return [
    {
      role: "system",
      content: [
        "你是一个对话压缩器。请把下面的对话历史总结成一段精炼的中文摘要，供后续对话作为上下文使用。",
        "摘要必须保留：",
        "- 用户的目标与任务背景",
        "- 已经做出的决定和结论",
        "- 已创建/修改的文件及关键改动",
        "- 尚未解决的问题或待办事项",
        "直接输出摘要正文，不要添加前言或解释。"
      ].join("\n")
    },
    { role: "user", content: transcript }
  ];
}
