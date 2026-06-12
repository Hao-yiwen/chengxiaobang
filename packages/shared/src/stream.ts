import type { Message } from "./message";
import type { TokenUsage } from "./model";
import type { ToolCall } from "./tool";

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
 * - `run_end` is always the final event of a run.
 */
export type StreamEvent =
  | { type: "run_started"; runId: string; sessionId: string }
  | { type: "delta"; runId: string; channel: "text" | "thinking"; delta: string }
  | { type: "message"; runId: string; message: Message }
  | { type: "tool_call"; runId: string; toolCall: ToolCall }
  | {
      type: "run_end";
      runId: string;
      status: RunEndStatus;
      usage?: TokenUsage;
      error?: string;
    };

export type StreamEventType = StreamEvent["type"];

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
