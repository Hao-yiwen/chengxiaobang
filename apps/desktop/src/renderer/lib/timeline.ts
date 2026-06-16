import {
  derivePlanState,
  proposePlanArgsSchema,
  proposedPlanTitle,
  type Message,
  type PlanState,
  type RunRecord,
  type StreamEvent,
  type ToolCall
} from "@chengxiaobang/shared";

export type TimelineItem =
  | { kind: "message"; at: string; message: Message }
  | { kind: "tool"; at: string; toolCall: ToolCall };

export type GroupedTimelineItem =
  | TimelineItem
  | { kind: "tool-group"; at: string; toolCalls: ToolCall[] };

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
  | { kind: "plan-history"; at: string; toolCall: ToolCall; title: string };

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

/** 有专属渲染（提问卡、技能 chip、计划卡）的工具不进普通分组。 */
const UNGROUPABLE_TOOLS = new Set<string>([
  "AskUserQuestion",
  "Skill",
  "ExitPlanMode",
  "TodoRead",
  "TodoWrite"
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
    if (toolCall.id === options.pendingToolId && toolCall.name !== "ExitPlanMode") {
      continue;
    }
    if (toolCall.name === "TodoRead" || toolCall.name === "TodoWrite") {
      continue;
    }
    if (toolCall.name === "ExitPlanMode") {
      appendPlanItem(result, item, toolCall, plan);
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

// ───────────────────────── ChatView 渲染时间线 ─────────────────────────
// 以下类型与函数原属 ChatView；因 groupTurns 需要消费 ChatViewTimelineRenderItem，
// 统一上移到本文件导出，避免 ChatView ↔ timeline 的循环依赖。

export type PlanTimelineItem = { kind: "plan"; at: string; plan: PlanView };
export type ChatViewTimelineItem = GroupedTimelineItem | PlanTimelineItem;

/** 失败 run 的提示卡数据：持久化失败记录 + 本次会话内的实时失败事件。 */
export interface FailedRunNotice {
  id: string;
  message: string;
  at: string;
  persisted: boolean;
}
export type RunErrorTimelineItem = { kind: "run-error"; at: string; notice: FailedRunNotice };

export type ChatViewTimelineRenderItem = ChatViewTimelineItem | RunErrorTimelineItem;

const FAILED_RUN_FALLBACK = "运行失败，但未记录错误详情";

export function isFailedRunEndEvent(
  event: StreamEvent
): event is Extract<StreamEvent, { type: "run_end" }> & { status: "failed" } {
  return event.type === "run_end" && event.status === "failed";
}

/** ChatView 渲染时间线：在分组时间线上插入失败提示、把 ExitPlanMode 折成计划卡、丢弃 Todo 工具。 */
export function chatViewTimelineItems(
  messages: Message[],
  toolCalls: ToolCall[],
  failedNotices: FailedRunNotice[],
  activeRunId?: string
): ChatViewTimelineRenderItem[] {
  const groupedItems = groupTimelineItems(timelineItems(messages, toolCalls));
  const chronologicalItems: ChatViewTimelineRenderItem[] = [
    ...groupedItems,
    ...failedNotices.map((notice) => ({
      kind: "run-error" as const,
      at: notice.at,
      notice
    }))
  ].sort((left, right) => left.at.localeCompare(right.at));
  const result: ChatViewTimelineRenderItem[] = [];

  for (const item of chronologicalItems) {
    if (item.kind === "run-error") {
      result.push(item);
      continue;
    }
    if (
      item.kind === "tool" &&
      (item.toolCall.name === "TodoRead" || item.toolCall.name === "TodoWrite")
    ) {
      continue;
    }
    if (item.kind === "tool" && item.toolCall.name === "ExitPlanMode") {
      const plan = derivePlanView(
        toolCalls.filter((toolCall) => toolCall.name === "ExitPlanMode"),
        { activeRunId }
      );
      const visiblePlan =
        plan?.anchor.id === item.toolCall.id
          ? plan
          : derivePlanView([item.toolCall], { activeRunId });
      if (visiblePlan) {
        result.push({ kind: "plan", at: item.at, plan: visiblePlan });
      }
      continue;
    }
    result.push(item);
  }

  return result;
}

export function failedRunNotices(runs: RunRecord[], events: StreamEvent[]): FailedRunNotice[] {
  const persisted = runs
    .filter((run) => run.status === "failed")
    .map((run) => ({
      id: run.id,
      message: run.error ?? FAILED_RUN_FALLBACK,
      at: run.updatedAt,
      persisted: true
    }));
  const persistedIds = new Set(persisted.map((notice) => notice.id));
  const live = events
    .filter(isFailedRunEndEvent)
    .filter((event) => !persistedIds.has(event.runId))
    .map((event, index) => ({
      id: `live-${event.runId}-${index}`,
      message: event.error ?? FAILED_RUN_FALLBACK,
      // 排序哨兵：U+FFFF 大于任何正常 ISO 时间戳字符，让实时失败提示排到末尾。
      at: String.fromCharCode(0xffff),
      persisted: false
    }));
  return [...persisted, ...live].sort((left, right) => left.at.localeCompare(right.at));
}

// ─────────────────── 轮次分组（「已工作 X 分 Y 秒」折叠头）───────────────────

export type MessageRenderItem = Extract<ChatViewTimelineRenderItem, { kind: "message" }>;

/** 单个轮次的「已工作」计时口径。 */
export type TurnTiming =
  | { mode: "running"; startedAt: number }
  | { mode: "settled"; durationMs: number }
  | { mode: "unknown" };

export interface TurnMember {
  item: ChatViewTimelineRenderItem;
  /** 该 item 在扁平 items 数组里的原下标，渲染时透传给依赖全局位置的 props 计算。 */
  index: number;
}

/** user 消息 / 最终答复成员：item 收窄为 message，并保留全局 index 供 actions 计算使用。 */
export interface MessageMember {
  item: MessageRenderItem;
  index: number;
}

/** 一个 AI 轮次块：一条 user 触发的全部响应，附折叠头所需的派生信息。 */
export interface TurnBlock {
  kind: "turn";
  key: string;
  /** 本轮起点 user 消息（历史首条/孤立响应时为 undefined）；渲染在折叠头外、上方。 */
  user?: MessageMember;
  /** 折叠体内的中间过程（思考、工具、计划、早于最终答复的叙述），附全局 index。 */
  intermediate: TurnMember[];
  /** 折叠头外的最终答复：本轮最后一条有内容 assistant 消息；失败/中止/仍在流式时为 undefined。 */
  answer?: MessageMember;
  /** 是否当前活跃 run：决定折叠头展开 + 实时计时，并承载运行中临时块。 */
  active: boolean;
  timing: TurnTiming;
}

/** 不属于任何 AI 轮次、独立成块的卡片（/compact 摘要、system 消息）。 */
export interface StandaloneBlock {
  kind: "standalone";
  key: string;
  item: ChatViewTimelineRenderItem;
  index: number;
}

export type ChatBlock = TurnBlock | StandaloneBlock;

export interface GroupTurnsContext {
  isRunning: boolean;
  activeRunId?: string;
  /** 当前 run 推送过的 assistant 消息 id 集合（events 里 runId===activeRunId）。 */
  activeRunAssistantIds: Set<string>;
  /** 当前 run 起点 epoch ms（store.activeRunStartedAt）。 */
  activeRunStartedAt?: number;
  /** 兜底「现在」时间，仅活跃轮缺起点时使用；注入便于单测。 */
  nowMs: number;
}

interface RawTurn {
  user?: MessageMember;
  members: TurnMember[];
  terminalAt?: string;
}

type RawBlock =
  | { kind: "turn"; turn: RawTurn }
  | { kind: "standalone"; item: ChatViewTimelineRenderItem; index: number };

/**
 * 把扁平的渲染时间线按「user 消息」边界切成轮次块：每个 AI 轮次的中间过程进折叠体、
 * 最终答复和失败提示留在折叠头外；compaction/system 独立成块。纯函数，便于单测。
 */
export function groupTurns(
  items: ChatViewTimelineRenderItem[],
  ctx: GroupTurnsContext
): ChatBlock[] {
  const raw: RawBlock[] = [];
  let cur: RawTurn | null = null;
  const flush = () => {
    if (cur) {
      raw.push({ kind: "turn", turn: cur });
      cur = null;
    }
  };

  items.forEach((item, index) => {
    if (item.kind === "message" && item.message.kind === "compaction_summary") {
      flush();
      raw.push({ kind: "standalone", item, index });
      return;
    }
    if (item.kind === "message" && item.message.role === "user") {
      flush();
      cur = { user: { item, index }, members: [] };
      return;
    }
    if (item.kind === "message" && item.message.role === "system") {
      flush();
      raw.push({ kind: "standalone", item, index });
      return;
    }
    if (item.kind === "run-error") {
      if (cur) {
        cur.terminalAt = item.at;
        flush();
      }
      raw.push({ kind: "standalone", item, index });
      return;
    }
    if (!cur) {
      cur = { user: undefined, members: [] };
    }
    cur.members.push({ item, index });
  });
  flush();

  let lastTurnIndex = -1;
  for (let i = raw.length - 1; i >= 0; i -= 1) {
    if (raw[i].kind === "turn") {
      lastTurnIndex = i;
      break;
    }
  }

  return raw.map((entry, i) => {
    if (entry.kind === "standalone") {
      return {
        kind: "standalone" as const,
        key: standaloneKey(entry.item),
        item: entry.item,
        index: entry.index
      };
    }
    return buildTurnBlock(entry.turn, i === lastTurnIndex, ctx);
  });
}

function buildTurnBlock(turn: RawTurn, isLastTurn: boolean, ctx: GroupTurnsContext): TurnBlock {
  const { user, members, terminalAt } = turn;
  if (!user) {
    console.debug("[timeline] 轮次缺起点用户消息，按孤立轮处理", {
      firstKind: members[0]?.item.kind,
      count: members.length
    });
  }
  const active = computeTurnActive(members, isLastTurn, ctx);

  // 活跃轮：最终答复尚未定稿，全部成员进折叠体（answer 留空，run_end 后重新分组才提出来）。
  let answer: MessageMember | undefined;
  let answerListIndex = -1;
  if (!active) {
    for (let i = members.length - 1; i >= 0; i -= 1) {
      const member = members[i];
      if (
        member.item.kind === "message" &&
        member.item.message.role === "assistant" &&
        member.item.message.content.trim().length > 0
      ) {
        answer = { item: member.item, index: member.index };
        answerListIndex = i;
        break;
      }
    }
  }
  const intermediate =
    answerListIndex >= 0 ? members.filter((_, idx) => idx !== answerListIndex) : members;

  return {
    kind: "turn",
    key: turnKey(user, members),
    user,
    intermediate,
    answer,
    active,
    timing: computeTurnTiming(user, answer, members, active, ctx, terminalAt)
  };
}

function computeTurnActive(
  members: TurnMember[],
  isLastTurn: boolean,
  ctx: GroupTurnsContext
): boolean {
  if (!ctx.isRunning || !ctx.activeRunId) {
    return false;
  }
  const hasActiveAssistant = members.some(
    (member) =>
      member.item.kind === "message" && ctx.activeRunAssistantIds.has(member.item.message.id)
  );
  // 命中当前 run 的 assistant 消息，或它是运行中正在构建的末轮（AI 还没落任何消息）。
  return hasActiveAssistant || isLastTurn;
}

function computeTurnTiming(
  user: MessageMember | undefined,
  answer: MessageMember | undefined,
  members: TurnMember[],
  active: boolean,
  ctx: GroupTurnsContext,
  terminalAt?: string
): TurnTiming {
  if (active) {
    const startedAt =
      ctx.activeRunStartedAt ??
      (user ? parseIsoMs(user.item.message.createdAt) : undefined) ??
      ctx.nowMs;
    return { mode: "running", startedAt };
  }
  const startMs = user ? parseIsoMs(user.item.message.createdAt) : undefined;
  if (startMs === undefined) {
    return { mode: "unknown" };
  }
  // 完成/历史：最终答复 createdAt − user createdAt；无答复（失败/中止）用成员最大时间戳兜底。
  const endMs = answer
    ? parseIsoMs(answer.item.message.createdAt)
    : maxMemberMs(members, terminalAt);
  if (endMs === undefined) {
    return { mode: "unknown" };
  }
  const durationMs = endMs - startMs;
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    console.warn("[timeline] 轮次耗时计算异常，回退无计时", {
      userId: user?.item.message.id,
      startMs,
      endMs
    });
    return { mode: "unknown" };
  }
  return { mode: "settled", durationMs };
}

function parseIsoMs(iso: string): number | undefined {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : undefined;
}

function maxMemberMs(members: TurnMember[], terminalAt?: string): number | undefined {
  let max: number | undefined;
  if (terminalAt) {
    max = parseIsoMs(terminalAt);
  }
  for (const member of members) {
    const ms = parseIsoMs(member.item.at);
    if (ms === undefined) {
      continue;
    }
    if (max === undefined || ms > max) {
      max = ms;
    }
  }
  return max;
}

function renderItemId(item: ChatViewTimelineRenderItem): string {
  switch (item.kind) {
    case "message":
      return item.message.id;
    case "tool":
      return item.toolCall.id;
    case "tool-group":
      return item.toolCalls[0]?.id ?? "group";
    case "plan":
      return item.plan.anchor.id;
    case "run-error":
      return item.notice.id;
  }
}

function turnKey(user: MessageMember | undefined, members: TurnMember[]): string {
  if (user) {
    return `turn-${user.item.message.id}`;
  }
  const first = members[0]?.item;
  return `turn-orphan-${first ? renderItemId(first) : "empty"}`;
}

function standaloneKey(item: ChatViewTimelineRenderItem): string {
  return `standalone-${renderItemId(item)}`;
}
