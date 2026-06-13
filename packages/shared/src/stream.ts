import { z } from "zod";

import { messageSchema, type Message } from "./message";
import { reasoningModeSchema, type ReasoningMode } from "./model";
import { tokenUsageSchema, type TokenUsage } from "./model";
import { sessionSchema, type Session } from "./session";
import { toolActivitySchema, toolCallSchema, type ToolActivity, type ToolCall } from "./tool";
import { scheduledTaskStatusSchema, type ScheduledTaskStatus } from "./scheduled-task";

export type RunEndStatus = "completed" | "failed" | "aborted";
export type ScheduledTaskTrigger = "schedule" | "manual";

/**
 * agent 循环和客户端（渲染层、飞书）之间的 SSE 契约。
 *
 * - `delta`：按 text/thinking 通道流式输出模型增量。
 * - `message`：传递已持久化消息（用户回显、assistant 轮次，以及 abort 时保留的部分回答）。
 * - `tool_call`：每次工具调用状态迁移都会触发，status 字段承载状态机。
 * - `session_updated`：传递 run 中途更新的会话元数据，让客户端不必等 run 结束再刷新。
 * - `run_end`：一个 run 的最终事件。
 */
export type StreamEvent =
  | {
      type: "run_started";
      runId: string;
      sessionId: string;
      clientRequestId?: string;
      providerId?: string;
      model?: string;
      reasoningMode?: ReasoningMode;
    }
  | { type: "delta"; runId: string; channel: "text" | "thinking"; delta: string }
  | { type: "message"; runId: string; message: Message }
  | { type: "tool_activity"; runId: string; activity: ToolActivity }
  | { type: "tool_call"; runId: string; toolCall: ToolCall }
  | { type: "session_updated"; runId: string; session: Session }
  | {
      type: "run_end";
      runId: string;
      status: RunEndStatus;
      usage?: TokenUsage;
      error?: string;
    };

export type StreamEventType = StreamEvent["type"];

export type ScheduledTaskEvent =
  | {
      type: "scheduled_task_started";
      taskId: string;
      sessionId: string;
      name: string;
      trigger: ScheduledTaskTrigger;
      occurredAt: string;
    }
  | {
      type: "scheduled_task_finished";
      taskId: string;
      sessionId: string;
      name: string;
      trigger: ScheduledTaskTrigger;
      status: ScheduledTaskStatus;
      runId?: string;
      error?: string;
      occurredAt: string;
    };

export type AppEvent = StreamEvent | ScheduledTaskEvent;
export type AppEventType = AppEvent["type"];

export const streamEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("run_started"),
    runId: z.string().min(1),
    sessionId: z.string().min(1),
    clientRequestId: z.string().min(1).optional(),
    providerId: z.string().min(1).optional(),
    model: z.string().min(1).optional(),
    reasoningMode: reasoningModeSchema.optional()
  }),
  z.object({
    type: z.literal("delta"),
    runId: z.string().min(1),
    channel: z.enum(["text", "thinking"]),
    delta: z.string()
  }),
  z.object({
    type: z.literal("message"),
    runId: z.string().min(1),
    message: messageSchema
  }),
  z.object({
    type: z.literal("tool_activity"),
    runId: z.string().min(1),
    activity: toolActivitySchema
  }),
  z.object({
    type: z.literal("tool_call"),
    runId: z.string().min(1),
    toolCall: toolCallSchema
  }),
  z.object({
    type: z.literal("session_updated"),
    runId: z.string().min(1),
    session: sessionSchema
  }),
  z.object({
    type: z.literal("run_end"),
    runId: z.string().min(1),
    status: z.enum(["completed", "failed", "aborted"]),
    usage: tokenUsageSchema.optional(),
    error: z.string().optional()
  })
]);

export const scheduledTaskEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("scheduled_task_started"),
    taskId: z.string().min(1),
    sessionId: z.string().min(1),
    name: z.string().min(1),
    trigger: z.enum(["schedule", "manual"]),
    occurredAt: z.string().min(1)
  }),
  z.object({
    type: z.literal("scheduled_task_finished"),
    taskId: z.string().min(1),
    sessionId: z.string().min(1),
    name: z.string().min(1),
    trigger: z.enum(["schedule", "manual"]),
    status: scheduledTaskStatusSchema,
    runId: z.string().min(1).optional(),
    error: z.string().optional(),
    occurredAt: z.string().min(1)
  })
]);

export const appEventSchema = z.discriminatedUnion("type", [
  ...streamEventSchema.options,
  ...scheduledTaskEventSchema.options
]);

export function isStreamEvent(event: AppEvent): event is StreamEvent {
  return !event.type.startsWith("scheduled_task_");
}

export function encodeSseEvent(event: AppEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

export function parseSseChunk(chunk: string): AppEvent[] {
  return chunk
    .split(/\n\n+/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const dataLine = block
        .split("\n")
        .find((line) => line.startsWith("data: "));
      if (!dataLine) {
        throw new Error(`Invalid SSE block: ${block}`);
      }
      return JSON.parse(dataLine.slice(6)) as AppEvent;
    });
}
