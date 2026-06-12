import { z } from "zod";

import { messageSchema, type Message } from "./message";
import { reasoningModeSchema, type ReasoningMode } from "./model";
import { tokenUsageSchema, type TokenUsage } from "./model";
import { sessionSchema, type Session } from "./session";
import { toolCallSchema, type ToolCall } from "./tool";

export type RunEndStatus = "completed" | "failed" | "aborted";

/**
 * The SSE contract between the agent loop and its clients (renderer, Feishu).
 *
 * - `delta` streams incremental model output on the text or thinking channel.
 * - `message` delivers a persisted message (the user echo, assistant turns,
 *   including a partial answer kept on abort).
 * - `tool_call` fires on every tool-call status transition; the status field
 *   carries the state machine (pending_approval → running → completed |
 *   failed | rejected).
 * - `session_updated` delivers session metadata changed mid-run (e.g. the
 *   AI-generated title) so clients can update lists without a refetch.
 * - `run_end` is always the final event of a run.
 */
export type StreamEvent =
  | {
      type: "run_started";
      runId: string;
      sessionId: string;
      providerId?: string;
      model?: string;
      reasoningMode?: ReasoningMode;
    }
  | { type: "delta"; runId: string; channel: "text" | "thinking"; delta: string }
  | { type: "message"; runId: string; message: Message }
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

export const streamEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("run_started"),
    runId: z.string().min(1),
    sessionId: z.string().min(1),
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

export function encodeSseEvent(event: StreamEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

export function parseSseChunk(chunk: string): StreamEvent[] {
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
      return JSON.parse(dataLine.slice(6)) as StreamEvent;
    });
}
