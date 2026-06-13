import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { todoCreateArgsSchema, todoUpdateArgsSchema } from "@chengxiaobang/shared";
import { textResult } from "./tool-result";

const todoStatusParams = Type.Union([
  Type.Literal("pending"),
  Type.Literal("in_progress"),
  Type.Literal("completed"),
  Type.Literal("skipped")
]);

const todoItemParams = Type.Object({
  id: Type.String({ description: "稳定步骤 ID，例如 s1、s2" }),
  title: Type.String({ description: "步骤标题，一句话描述" }),
  status: Type.Optional(todoStatusParams),
  detail: Type.Optional(Type.String({ description: "可选步骤细节" }))
});

const todoCreateParams = Type.Object({
  title: Type.String({ description: "这组 todo 的标题" }),
  items: Type.Array(todoItemParams, { description: "1 到 20 个步骤" })
});

const todoUpdateParams = Type.Object({
  itemId: Type.String({ description: "要更新的 todo 步骤 ID" }),
  status: Type.Union([
    Type.Literal("in_progress"),
    Type.Literal("completed"),
    Type.Literal("skipped")
  ]),
  note: Type.Optional(Type.String({ description: "可选进展说明" }))
});

export function createTodoTools(): AgentTool<any>[] {
  const todoCreate: AgentTool<typeof todoCreateParams> = {
    name: "todo_create",
    label: "创建 Todo",
    description:
      "为稍复杂的任务创建 AI 自用执行清单。用户只旁观进度，不需要确认，也不应替代计划模式。",
    parameters: todoCreateParams,
    execute: async (_toolCallId, params) => {
      const parsed = todoCreateArgsSchema.safeParse(params);
      if (!parsed.success) {
        console.warn("[todo-tools] todo_create 参数非法", { error: parsed.error.message });
        throw new Error("todo_create 参数非法");
      }
      console.info("[todo-tools] 创建 todo 清单", {
        title: parsed.data.title,
        items: parsed.data.items.length
      });
      return textResult(
        [`已创建 todo「${parsed.data.title}」。`, ...parsed.data.items.map((item) => `- ${item.id} ${item.title}`)].join(
          "\n"
        )
      );
    }
  };

  const todoUpdate: AgentTool<typeof todoUpdateParams> = {
    name: "todo_update",
    label: "更新 Todo",
    description: "更新 AI 自用执行清单中的某个步骤状态。",
    parameters: todoUpdateParams,
    execute: async (_toolCallId, params) => {
      const parsed = todoUpdateArgsSchema.safeParse(params);
      if (!parsed.success) {
        console.warn("[todo-tools] todo_update 参数非法", { error: parsed.error.message });
        throw new Error("todo_update 参数非法");
      }
      console.info("[todo-tools] 更新 todo 步骤", {
        itemId: parsed.data.itemId,
        status: parsed.data.status,
        note: parsed.data.note
      });
      return textResult(
        `已更新 todo ${parsed.data.itemId} -> ${parsed.data.status}${
          parsed.data.note ? `（${parsed.data.note}）` : ""
        }`
      );
    }
  };

  return [todoCreate, todoUpdate];
}
