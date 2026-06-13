import {
  derivePlanState,
  proposePlanArgsSchema,
  proposedPlanTitle,
  type Message,
  type PlanState,
  type ToolCall
} from "@chengxiaobang/shared";

export type TimelineItem =
  | { kind: "message"; at: string; message: Message }
  | { kind: "tool"; at: string; toolCall: ToolCall };

export type GroupedTimelineItem =
  | TimelineItem
  | { kind: "tool-group"; at: string; toolCalls: ToolCall[] };

export const ASIDE_INLINE_LIMIT = 2;

export type PlanViewStatus = "draft" | "awaiting" | "approved" | "rejected";

export interface PlanView {
  anchor: ToolCall;
  state: PlanState;
  status: PlanViewStatus;
}

export type ChatTimelineItem =
  | { kind: "message"; at: string; message: Message; turnStart: boolean }
  | { kind: "tool"; at: string; toolCall: ToolCall; index: number; residualPending: boolean }
  | { kind: "separator"; at: string }
  | { kind: "plan"; at: string; plan: PlanView }
  | { kind: "plan-history"; at: string; toolCall: ToolCall; title: string }
  | { kind: "aside"; at: string; toolCall: ToolCall }
  | { kind: "aside-group"; at: string; runId: string; toolCalls: ToolCall[] };

interface ChatTimelineOptions {
  activeRunId?: string;
  pendingToolId?: string;
}

/** 按时间排序的聊天时间线，供 ChatView 和会话导出共用。 */
export function timelineItems(messages: Message[], toolCalls: ToolCall[]): TimelineItem[] {
  return [
    // tool 角色消息由工具行承载，不作为聊天气泡展示。
    // 只有携带思考内容的空 assistant 轮次会保留，用来把思考面板放回工具调用前的真实位置。
    ...messages
      .filter(
        (message) =>
          message.role !== "tool" &&
          (message.content.trim().length > 0 ||
            Boolean(message.reasoning) ||
            (message.attachments?.length ?? 0) > 0)
      )
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

/** 有专属渲染（提问卡、技能 chip、计划卡、旁注）的工具不进普通分组。 */
const UNGROUPABLE_TOOLS = new Set<string>([
  "ask_user",
  "use_skill",
  "propose_plan",
  "update_plan",
  "todo_create",
  "todo_update",
  "btw"
]);

/** 可并入「连续工具调用」折叠组的普通工具。 */
export function isGroupableToolCall(toolCall: ToolCall): boolean {
  return !UNGROUPABLE_TOOLS.has(toolCall.name);
}

/**
 * 将连续的普通工具调用折叠成 tool-group。遇到消息或专属渲染工具会断开分组；
 * 单个工具仍保持普通 tool 项。分组时间取第一条工具调用，流式追加时 React key 更稳定。
 */
export function groupTimelineItems(items: TimelineItem[]): GroupedTimelineItem[] {
  const result: GroupedTimelineItem[] = [];
  let current: Array<TimelineItem & { kind: "tool" }> = [];

  const flush = () => {
    if (current.length >= 2) {
      result.push({
        kind: "tool-group",
        at: current[0].at,
        toolCalls: current.map((item) => item.toolCall)
      });
    } else if (current.length === 1) {
      result.push(current[0]);
    }
    current = [];
  };

  for (const item of items) {
    if (item.kind === "tool" && isGroupableToolCall(item.toolCall)) {
      current.push(item);
      continue;
    }
    flush();
    result.push(item);
  }
  flush();
  return result;
}

export function derivePlanView(
  toolCalls: ToolCall[],
  options: ChatTimelineOptions = {}
): PlanView | undefined {
  const state = derivePlanState(toolCalls);
  if (!state) {
    return undefined;
  }
  const anchor = toolCalls.find((toolCall) => toolCall.id === state.toolCallId);
  if (!anchor) {
    console.warn("[timeline] 计划锚点不存在", { toolCallId: state.toolCallId });
    return undefined;
  }
  return {
    anchor,
    state,
    status: derivePlanStatus(anchor, state, options.activeRunId)
  };
}

export function chatTimeline(
  messages: Message[],
  toolCalls: ToolCall[],
  options: ChatTimelineOptions = {}
): ChatTimelineItem[] {
  const plan = derivePlanView(toolCalls, options);
  const toolIndicesByRun = new Map<string, number>();
  const asideCountsByRun = new Map<string, number>();
  const result: ChatTimelineItem[] = [];
  let lastVisibleMessageRole: Message["role"] | undefined;

  for (const item of timelineItems(messages, toolCalls)) {
    if (item.kind === "message") {
      if (item.message.role === "user" && result.length > 0) {
        result.push({ kind: "separator", at: item.at });
      }
      const turnStart =
        item.message.role === "assistant" && lastVisibleMessageRole === "user";
      result.push({ ...item, turnStart });
      lastVisibleMessageRole = item.message.role;
      continue;
    }

    const toolCall = item.toolCall;
    if (toolCall.id === options.pendingToolId && toolCall.name !== "propose_plan") {
      continue;
    }
    if (toolCall.name === "update_plan") {
      continue;
    }
    if (toolCall.name === "todo_create" || toolCall.name === "todo_update") {
      continue;
    }
    if (toolCall.name === "propose_plan") {
      appendPlanItem(result, item, toolCall, plan);
      continue;
    }
    if (toolCall.name === "btw") {
      appendAsideItem(result, item, toolCall, asideCountsByRun);
      continue;
    }

    const index = (toolIndicesByRun.get(toolCall.runId) ?? 0) + 1;
    toolIndicesByRun.set(toolCall.runId, index);
    result.push({
      ...item,
      index,
      residualPending:
        (toolCall.status === "pending_approval" ||
          toolCall.status === "pending_smart_approval") &&
        toolCall.runId !== options.activeRunId
    });
  }

  return result;
}

function derivePlanStatus(
  anchor: ToolCall,
  state: PlanState,
  activeRunId?: string
): PlanViewStatus {
  if (anchor.status === "rejected" || anchor.status === "failed") {
    return "rejected";
  }
  if (
    anchor.status === "pending_approval" ||
    anchor.status === "pending_smart_approval" ||
    anchor.status === "running"
  ) {
    return anchor.runId === activeRunId ? "draft" : "awaiting";
  }
  return state.confirmed ? "approved" : "awaiting";
}

function appendPlanItem(
  result: ChatTimelineItem[],
  item: TimelineItem & { kind: "tool" },
  toolCall: ToolCall,
  plan: PlanView | undefined
): void {
  if (plan?.anchor.id === toolCall.id) {
    result.push({ kind: "plan", at: item.at, plan });
    return;
  }
  const parsed = proposePlanArgsSchema.safeParse(toolCall.args);
  if (!parsed.success) {
    console.warn("[timeline] 历史计划参数解析失败，已跳过", {
      toolCallId: toolCall.id,
      error: parsed.error.message
    });
    return;
  }
  result.push({
    kind: "plan-history",
    at: item.at,
    toolCall,
    title: proposedPlanTitle(parsed.data.markdown)
  });
}

function appendAsideItem(
  result: ChatTimelineItem[],
  item: TimelineItem & { kind: "tool" },
  toolCall: ToolCall,
  asideCountsByRun: Map<string, number>
): void {
  const count = (asideCountsByRun.get(toolCall.runId) ?? 0) + 1;
  asideCountsByRun.set(toolCall.runId, count);
  if (count <= ASIDE_INLINE_LIMIT) {
    result.push({ kind: "aside", at: item.at, toolCall });
    return;
  }
  const previous = result[result.length - 1];
  if (previous?.kind === "aside-group" && previous.runId === toolCall.runId) {
    previous.toolCalls.push(toolCall);
    return;
  }
  result.push({
    kind: "aside-group",
    at: item.at,
    runId: toolCall.runId,
    toolCalls: [toolCall]
  });
}
