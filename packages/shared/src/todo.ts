import { z } from "zod";

import type { ToolCall } from "./tool";

export const todoStatusSchema = z.enum(["pending", "in_progress", "completed", "skipped"]);
export type TodoStatus = z.infer<typeof todoStatusSchema>;

/** AI 自用进度清单中的一个步骤。 */
export const todoItemSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  status: todoStatusSchema.default("pending"),
  detail: z.string().optional()
});
export type TodoItem = z.infer<typeof todoItemSchema>;

export const todoCreateArgsSchema = z.object({
  title: z.string().min(1),
  items: z.array(todoItemSchema).min(1).max(20)
});
export type TodoCreateArgs = z.infer<typeof todoCreateArgsSchema>;

export const todoUpdateArgsSchema = z.object({
  itemId: z.string().min(1),
  status: z.enum(["in_progress", "completed", "skipped"]),
  note: z.string().optional()
});
export type TodoUpdateArgs = z.infer<typeof todoUpdateArgsSchema>;

export interface TodoState {
  /** 锚点 todo_create 的 toolCallId。 */
  toolCallId: string;
  /** 锚点所在 run，用于右侧面板优先显示当前 run。 */
  runId: string;
  title: string;
  items: TodoItem[];
  /** 所有步骤均为 completed/skipped。 */
  finished: boolean;
  latestNote?: {
    toolCallId: string;
    itemId: string;
    status: TodoUpdateArgs["status"];
    note: string;
    updatedAt: string;
  };
}

export interface TodoCurrentItem {
  index: number;
  total: number;
  item: TodoItem;
}

/**
 * 从 append-only 工具记录推导 AI 自用 todo 进度：
 * - 最后一个有效 todo_create 是锚点；
 * - 只叠放同一 run、锚点之后完成的 todo_update；
 * - update 指向未知 item 时忽略，避免模型笔误污染状态。
 */
export function deriveTodoState(
  toolCalls: ToolCall[],
  options: { runId?: string } = {}
): TodoState | undefined {
  const candidates = toolCalls
    .filter(
      (toolCall) =>
        toolCall.name === "todo_create" &&
        toolCall.status !== "failed" &&
        (!options.runId || toolCall.runId === options.runId)
    )
    .sort(compareToolCalls);

  for (const anchor of [...candidates].reverse()) {
    const parsedArgs = todoCreateArgsSchema.safeParse(anchor.args);
    if (!parsedArgs.success) {
      console.warn("[todo] todo_create 参数解析失败，尝试更早的清单", {
        toolCallId: anchor.id,
        error: parsedArgs.error.message
      });
      continue;
    }

    const items = parsedArgs.data.items.map((item) => todoItemSchema.parse(item));
    let latestNote: TodoState["latestNote"];
    const updates = toolCalls
      .filter(
        (toolCall) =>
          toolCall.name === "todo_update" &&
          toolCall.status === "completed" &&
          toolCall.runId === anchor.runId &&
          compareToolCallTime(toolCall, anchor) >= 0
      )
      .sort(compareToolCalls);

    for (const toolCall of updates) {
      const parsedUpdate = todoUpdateArgsSchema.safeParse(toolCall.args);
      if (!parsedUpdate.success) {
        console.warn("[todo] todo_update 参数解析失败，已跳过", {
          toolCallId: toolCall.id,
          error: parsedUpdate.error.message
        });
        continue;
      }
      const item = items.find((candidate) => candidate.id === parsedUpdate.data.itemId);
      if (!item) {
        console.warn("[todo] todo_update 指向未知步骤，已跳过", {
          toolCallId: toolCall.id,
          itemId: parsedUpdate.data.itemId
        });
        continue;
      }
      item.status = parsedUpdate.data.status;
      if (parsedUpdate.data.note?.trim()) {
        latestNote = {
          toolCallId: toolCall.id,
          itemId: parsedUpdate.data.itemId,
          status: parsedUpdate.data.status,
          note: parsedUpdate.data.note.trim(),
          updatedAt: toolCall.updatedAt
        };
      }
    }

    const finished = items.every((item) => item.status === "completed" || item.status === "skipped");
    return {
      toolCallId: anchor.id,
      runId: anchor.runId,
      title: parsedArgs.data.title,
      items,
      finished,
      ...(latestNote ? { latestNote } : {})
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
