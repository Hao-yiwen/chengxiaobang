import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { deriveTodoState, todoWriteArgsSchema, type ToolCall } from "@chengxiaobang/shared";
import { textResult } from "./tool-result";

import { getLogger } from "../logging/logger";

const log = getLogger({ module: "tools/todo-tools" });

const todoStatusParams = Type.Union([
  Type.Literal("pending"),
  Type.Literal("in_progress"),
  Type.Literal("completed")
]);

const todoPriorityParams = Type.Union([
  Type.Literal("high"),
  Type.Literal("medium"),
  Type.Literal("low")
]);

const todoItemParams = Type.Object({
  content: Type.String({ description: "步骤内容，一句话描述" }),
  status: todoStatusParams,
  priority: todoPriorityParams
});

const todoWriteParams = Type.Object({
  todos: Type.Array(todoItemParams, { description: "完整 todo 快照，最多 20 个；最多一个 in_progress" })
});

const todoReadParams = Type.Object({});

export interface TodoToolRuntime {
  listToolCalls?: () => Promise<ToolCall[]>;
  runId?: string;
}

export function createTodoTools(runtime: TodoToolRuntime = {}): AgentTool<any>[] {
  const todoRead: AgentTool<typeof todoReadParams> = {
    name: "TodoRead",
    label: "读取 Todo",
    description: "读取当前会话最新 AI 自用执行清单。",
    parameters: todoReadParams,
    execute: async () => {
      const toolCalls = await runtime.listToolCalls?.();
      if (!toolCalls) {
        return textResult("当前没有可读取的 Todo 快照。");
      }
      const state = deriveTodoState(toolCalls, runtime.runId ? { runId: runtime.runId } : {});
      if (!state || state.items.length === 0) {
        return textResult("当前没有 Todo。");
      }
      return textResult(
        state.items
          .map(
            (item) =>
              `- [${item.status === "completed" ? "x" : item.status === "in_progress" ? ">" : " "}] ${item.content} (${item.priority})`
          )
          .join("\n")
      );
    }
  };

  const todoWrite: AgentTool<typeof todoWriteParams> = {
    name: "TodoWrite",
    label: "写入 Todo",
    description:
      "替换 AI 自用执行清单的完整快照。适合多步任务进度展示；简单问答、小改动或单次工具调用不要创建 todo。",
    parameters: todoWriteParams,
    execute: async (_toolCallId, params) => {
      const parsed = todoWriteArgsSchema.safeParse(params);
      if (!parsed.success) {
        log.warn("[todo-tools] TodoWrite 参数非法", { error: parsed.error.message });
        throw new Error("TodoWrite 参数非法：" + parsed.error.message);
      }
      log.info("[todo-tools] 写入 todo 快照", {
        itemCount: parsed.data.todos.length,
        inProgressCount: parsed.data.todos.filter((todo) => todo.status === "in_progress").length
      });
      if (parsed.data.todos.length === 0) {
        return textResult("已清空 todo。");
      }
      return textResult(
        ["已更新 todo：", ...parsed.data.todos.map((todo) => `- ${todo.status} ${todo.priority} ${todo.content}`)].join(
          "\n"
        )
      );
    }
  };

  return [todoRead, todoWrite];
}
