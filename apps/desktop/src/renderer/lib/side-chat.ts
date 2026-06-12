import type { Message, StreamEvent, ToolCall } from "@chengxiaobang/shared";

/** One timeline entry in the side chat: a persisted message or a tool call. */
export type SideChatItem =
  | { kind: "message"; message: Message }
  | { kind: "tool"; toolCall: ToolCall };

export interface SideChatState {
  /** Assigned by the first run_started; later sends continue the same session. */
  sessionId?: string;
  items: SideChatItem[];
  streamText: string;
  pendingTool?: ToolCall;
  running: boolean;
  error?: string;
}

export type SideChatAction =
  | { type: "send" }
  | { type: "event"; event: StreamEvent }
  | { type: "finish"; error?: string }
  | { type: "reset" };

export const initialSideChatState: SideChatState = {
  items: [],
  streamText: "",
  running: false
};

function upsertToolItem(items: SideChatItem[], toolCall: ToolCall): SideChatItem[] {
  const exists = items.some((item) => item.kind === "tool" && item.toolCall.id === toolCall.id);
  if (exists) {
    return items.map((item) =>
      item.kind === "tool" && item.toolCall.id === toolCall.id ? { kind: "tool", toolCall } : item
    );
  }
  return [...items, { kind: "tool", toolCall }];
}

function appendMessageItem(items: SideChatItem[], message: Message): SideChatItem[] {
  if (items.some((item) => item.kind === "message" && item.message.id === message.id)) {
    return items;
  }
  return [...items, { kind: "message", message }];
}

/** Mirrors the main run loop's event handling, scoped to the side chat's local state. */
export function sideChatReducer(state: SideChatState, action: SideChatAction): SideChatState {
  switch (action.type) {
    case "send":
      return { ...state, running: true, error: undefined };
    case "finish":
      return { ...state, running: false, streamText: "", pendingTool: undefined, error: action.error ?? state.error };
    case "reset":
      return { ...initialSideChatState };
    case "event": {
      const event = action.event;
      switch (event.type) {
        case "run_started":
          return { ...state, sessionId: event.sessionId };
        case "delta":
          // The mini chat does not surface reasoning; only text deltas show.
          if (event.channel !== "text") {
            return state;
          }
          return { ...state, streamText: state.streamText + event.delta };
        case "message":
          return {
            ...state,
            items: appendMessageItem(state.items, event.message),
            streamText: event.message.role === "assistant" ? "" : state.streamText
          };
        case "tool_call":
          return {
            ...state,
            items: upsertToolItem(state.items, event.toolCall),
            pendingTool:
              event.toolCall.status === "pending_approval" ? event.toolCall : undefined
          };
        case "run_end":
          return {
            ...state,
            streamText: "",
            pendingTool: undefined,
            error: event.status === "failed" ? (event.error ?? "运行失败") : state.error
          };
        default:
          return state;
      }
    }
  }
}
