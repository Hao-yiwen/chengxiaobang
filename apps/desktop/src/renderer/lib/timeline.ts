import type { Message, ToolCall } from "@chengxiaobang/shared";

export type TimelineItem =
  | { kind: "message"; at: string; message: Message }
  | { kind: "tool"; at: string; toolCall: ToolCall };

/** Chronological chat timeline, shared by ChatView and session export. */
export function timelineItems(messages: Message[], toolCalls: ToolCall[]): TimelineItem[] {
  return [
    // Tool-role messages are rendered as tool-call rows, not chat bubbles.
    ...messages
      .filter((message) => message.role !== "tool")
      .map((message) => ({
        kind: "message" as const,
        at: message.createdAt,
        message
      })),
    ...toolCalls.map((toolCall) => ({
      kind: "tool" as const,
      at: toolCall.updatedAt,
      toolCall
    }))
  ].sort((left, right) => left.at.localeCompare(right.at));
}
