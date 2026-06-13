import type { Message, StreamEvent, ToolCall } from "@chengxiaobang/shared";

/** 侧边会话的一条时间线记录：已持久化消息或工具调用。 */
export type SideChatItem =
  | { kind: "message"; message: Message }
  | { kind: "tool"; toolCall: ToolCall };

export interface SideChatState {
  /** 首次 run_started 后写入，后续发送沿用同一个侧边会话。 */
  sessionId?: string;
  clientRequestId?: string;
  runId?: string;
  items: SideChatItem[];
  streamText: string;
  pendingTool?: ToolCall;
  running: boolean;
  error?: string;
}

export type SideChatAction =
  | { type: "send"; clientRequestId?: string }
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

/** 复用主运行循环的事件语义，但状态只收敛到侧边会话本地。 */
export function sideChatReducer(state: SideChatState, action: SideChatAction): SideChatState {
  switch (action.type) {
    case "send":
      return {
        ...state,
        clientRequestId: action.clientRequestId,
        runId: undefined,
        running: true,
        error: undefined
      };
    case "finish":
      return {
        ...state,
        clientRequestId: undefined,
        runId: undefined,
        running: false,
        streamText: "",
        pendingTool: undefined,
        error: action.error ?? state.error
      };
    case "reset":
      return { ...initialSideChatState };
    case "event": {
      const event = action.event;
      switch (event.type) {
        case "run_started":
          return {
            ...state,
            sessionId: event.sessionId,
            runId: event.runId,
            clientRequestId: event.clientRequestId ?? state.clientRequestId
          };
        case "delta":
          // 侧边小聊天不展示 reasoning，只显示 text 增量。
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
            clientRequestId: undefined,
            runId: undefined,
            running: false,
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
