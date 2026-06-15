import { z } from "zod";

import type { ToolCall } from "./tool";

export const todoStatusSchema = z.enum(["pending", "in_progress", "completed"]);
export type TodoStatus = z.infer<typeof todoStatusSchema>;

export const todoPrioritySchema = z.enum(["high", "medium", "low"]);
export type TodoPriority = z.infer<typeof todoPrioritySchema>;

/** AI 自用进度清单中的一个步骤。 */
export const todoItemSchema = z.object({
  id: z.string().min(1),
  content: z.string().min(1),
  status: todoStatusSchema,
  priority: todoPrioritySchema
});
export type TodoItem = z.infer<typeof todoItemSchema>;

export const todoWriteItemSchema = z.object({
  content: z.string().min(1),
  status: todoStatusSchema,
  priority: todoPrioritySchema
});
export type TodoWriteItem = z.infer<typeof todoWriteItemSchema>;

export const todoWriteArgsSchema = z
  .object({
    todos: z.array(todoWriteItemSchema).min(0).max(20)
  })
  .refine(
    (value) => value.todos.filter((todo) => todo.status === "in_progress").length <= 1,
    { message: "最多只能有一个 in_progress todo" }
  );
export type TodoWriteArgs = z.infer<typeof todoWriteArgsSchema>;

export interface TodoState {
  /** 锚点 TodoWrite 的 toolCallId。 */
  toolCallId: string;
  /** 锚点所在 run，用于右侧面板优先显示当前 run。 */
  runId: string;
  title: string;
  items: TodoItem[];
  /** 所有步骤均为 completed。 */
  finished: boolean;
}

export interface TodoCurrentItem {
  index: number;
  total: number;
  item: TodoItem;
}

/** 从 append-only 工具记录推导 AI 自用 todo 进度：最后一个有效 TodoWrite 即当前快照。 */
export function deriveTodoState(
  toolCalls: ToolCall[],
  options: { runId?: string } = {}
): TodoState | undefined {
  const candidates = toolCalls
    .filter(
      (toolCall) =>
        toolCall.name === "TodoWrite" &&
        toolCall.status !== "failed" &&
        (!options.runId || toolCall.runId === options.runId)
    )
    .sort(compareToolCalls);

  for (const anchor of [...candidates].reverse()) {
    const parsedArgs = todoWriteArgsSchema.safeParse(anchor.args);
    if (!parsedArgs.success) {
      console.warn("[todo] TodoWrite 参数解析失败，尝试更早的清单", {
        toolCallId: anchor.id,
        error: parsedArgs.error.message
      });
      continue;
    }
    if (parsedArgs.data.todos.length === 0) {
      return undefined;
    }

    const items = parsedArgs.data.todos.map((todo, index) =>
      todoItemSchema.parse({
        id: `todo_${index + 1}`,
        content: todo.content,
        status: todo.status,
        priority: todo.priority
      })
    );
    const finished = items.length > 0 && items.every((item) => item.status === "completed");
    return {
      toolCallId: anchor.id,
      runId: anchor.runId,
      title: "执行清单",
      items,
      finished
    };
  }

  return undefined;
}

export function todoCurrentItem(state: TodoState): TodoCurrentItem | undefined {
  if (state.items.length === 0) {
    return undefined;
  }
  const item =
    state.items.find((candidate) => candidate.status === "in_progress") ??
    state.items.find((candidate) => candidate.status === "pending") ??
    state.items[state.items.length - 1];
  const index = state.items.findIndex((candidate) => candidate.id === item.id);
  return { index: index + 1, total: state.items.length, item };
}

function compareToolCalls(left: ToolCall, right: ToolCall): number {
  return compareToolCallTime(left, right) || left.id.localeCompare(right.id);
}

function compareToolCallTime(left: ToolCall, right: ToolCall): number {
  return left.createdAt.localeCompare(right.createdAt) || left.updatedAt.localeCompare(right.updatedAt);
}
