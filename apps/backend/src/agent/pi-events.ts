import { Buffer } from "node:buffer";
import type {
  AgentEvent,
  BeforeToolCallContext,
  BeforeToolCallResult
} from "@earendil-works/pi-agent-core";
import type {
  AssistantMessage,
  AssistantMessageEvent,
  ToolResultMessage,
  Usage
} from "@earendil-works/pi-ai";
import {
  askUserAnswerText,
  nowIso,
  proposePlanArgsSchema,
  type AccessMode,
  type AskUserAnswer,
  type ProposePlanArgs,
  type StreamEvent,
  type TokenUsage,
  type ToolActivityArgsPreview,
  type ToolCallApproval,
  type ToolCall
} from "@chengxiaobang/shared";
import type { StateStore } from "../repository/state-store";
import { toTokenUsage } from "../model/pi-model";
import { assessToolApprovalRisk } from "../tools/approval-policy";
import { requiresApproval } from "../tools/registry";
import { normalizeDecision, type ApprovalQueue } from "./approval-queue";
import type { AsyncEventQueue } from "./async-queue";

export const MAX_TOOL_ITERATIONS = 25;

const REJECTED_RESULT = "用户拒绝执行该操作";
const REJECTED_MODEL_HINT = "用户拒绝执行该操作。请考虑其他方式或向用户说明。";
const TOOL_ACTIVITY_PREVIEW_KEYS = [
  "path",
  "command",
  "query",
  "pattern",
  "url",
  "title",
  "name"
] as const;
const TOOL_ACTIVITY_PREVIEW_MAX = 120;

function answerText(answer: AskUserAnswer): string {
  return askUserAnswerText(answer);
}

function planAdjustmentResult(answer: AskUserAnswer): string {
  const text = answerText(answer);
  return text ? `用户要求调整计划：${text}` : "用户要求调整计划";
}

function planAdjustmentHint(answer: AskUserAnswer): string {
  const text = answerText(answer);
  return text
    ? `用户没有批准计划，调整意见：${text}。请根据意见重新提交一份完整 Markdown 计划。`
    : "用户没有批准计划。请重新提交一份完整 Markdown 计划。";
}

/**
 * Bridges the pi agent loop to the app: maps pi events onto the StreamEvent
 * queue and owns all run-scoped persistence (assistant/tool messages with
 * their pi payload, ToolCall entities, the final run status).
 *
 * `agent_end` is the single exhaustive outcome decision point — pi never
 * throws for model errors or aborts, it reports them via stopReason.
 */
export class RunEventTranslator {
  /** True once the terminal run_end event has been pushed. */
  finished = false;

  // key 是 pi/模型原始 toolCall.id，value 是应用层持久化的全局唯一 ToolCall。
  private readonly toolCalls = new Map<string, ToolCall>();
  private readonly toolCallOccurrences = new Map<string, number>();
  private readonly toolActivitySignatures = new Map<number, string>();
  private aborted = false;
  private errorMessage?: string;
  private maxIterationsHit = false;
  private usage?: Usage;
  private turnCount = 0;
  private turnStartedAt?: number;
  private reasoningStartedAt?: number;
  private reasoningMs?: number;

  constructor(
    private readonly options: {
      store: StateStore;
      queue: AsyncEventQueue<StreamEvent>;
      approvals: ApprovalQueue;
      runId: string;
      sessionId: string;
      accessMode: AccessMode;
      strictApproval?: boolean;
      signal: AbortSignal;
      planMode?: boolean;
      planConfirmed?: boolean;
      initialUsage?: TokenUsage;
      smartApproval?: (toolCall: ToolCall) => Promise<ToolCallApproval>;
      onPlanApproved?: (toolCallId: string, args: ProposePlanArgs) => void;
      onAskUserAnswered?: (toolCallId: string, answer: AskUserAnswer) => void;
    }
  ) {}

  isPlanConfirmed(): boolean {
    return Boolean(this.options.planConfirmed);
  }

  /** The AgentEventSink passed to runAgentLoopContinue. */
  readonly emit = async (event: AgentEvent): Promise<void> => {
    switch (event.type) {
      case "message_start":
        if (event.message.role === "assistant") {
          this.turnStartedAt = Date.now();
          this.reasoningStartedAt = undefined;
          this.reasoningMs = undefined;
          this.toolActivitySignatures.clear();
        }
        return;
      case "message_update": {
        const update = event.assistantMessageEvent;
        if (update.type === "text_delta") {
          this.push({ type: "delta", runId: this.options.runId, channel: "text", delta: update.delta });
        } else if (update.type === "thinking_delta") {
          if (this.reasoningStartedAt === undefined) {
            this.reasoningStartedAt = Date.now();
          }
          this.push({
            type: "delta",
            runId: this.options.runId,
            channel: "thinking",
            delta: update.delta
          });
        } else if (update.type === "thinking_end" && this.reasoningStartedAt !== undefined) {
          this.reasoningMs = Date.now() - this.reasoningStartedAt;
        } else if (
          update.type === "toolcall_start" ||
          update.type === "toolcall_delta" ||
          update.type === "toolcall_end"
        ) {
          this.onToolActivity(update);
        }
        return;
      }
      case "message_end":
        if (event.message.role === "assistant") {
          await this.onAssistantEnd(event.message as AssistantMessage);
        } else if (event.message.role === "toolResult") {
          await this.onToolResultMessage(event.message as ToolResultMessage);
        }
        return;
      case "tool_execution_start":
        await this.onToolExecutionStart(event.toolCallId, event.toolName, event.args);
        return;
      case "tool_execution_end":
        await this.onToolExecutionEnd(event.toolCallId, event.result, event.isError);
        return;
      case "turn_end":
        this.turnCount += 1;
        return;
      case "agent_end":
        await this.onAgentEnd();
        return;
      default:
        return;
    }
  };

  /** Approval gate, wired as AgentLoopConfig.beforeToolCall. */
  readonly beforeToolCall = async (
    context: BeforeToolCallContext
  ): Promise<BeforeToolCallResult | undefined> => {
    let entity = this.toolCalls.get(context.toolCall.id);
    if (!entity) {
      return undefined;
    }

    if (entity.status === "pending_smart_approval") {
      const smartDecision = await this.resolveSmartApproval(context.toolCall.id, entity);
      if (smartDecision.verdict === "allow") {
        return undefined;
      }
      if (smartDecision.verdict === "deny") {
        return { block: true, reason: "智能审批不同意执行该操作。" };
      }
      entity = this.toolCalls.get(context.toolCall.id);
    }

    if (!entity || entity.status !== "pending_approval") {
      return undefined;
    }
    const decision = normalizeDecision(
      entity.name,
      await this.options.approvals.wait(entity.id, this.options.signal)
    );
    if (!decision.approved) {
      const rejectedResult =
        entity.name === "propose_plan" && decision.answer
          ? planAdjustmentResult(decision.answer)
          : REJECTED_RESULT;
      const rejectedReason =
        entity.name === "propose_plan" && decision.answer
          ? planAdjustmentHint(decision.answer)
          : REJECTED_MODEL_HINT;
      const rejected = await this.saveToolCall(context.toolCall.id, {
        ...entity,
        status: "rejected",
        result: rejectedResult,
        ...(entity.approval ? { approval: markUserDecision(entity.approval, false) } : {}),
        updatedAt: nowIso()
      });
      this.push({ type: "tool_call", runId: this.options.runId, toolCall: rejected });
      return { block: true, reason: rejectedReason };
    }

    let args = entity.args;
    if (entity.name === "propose_plan") {
      args = decision.editedSteps ? { ...entity.args, steps: decision.editedSteps } : entity.args;
      const parsed = proposePlanArgsSchema.safeParse(args);
      if (!parsed.success) {
        console.warn("[pi-events] 用户确认后的计划参数非法，阻止执行", {
          toolCallId: entity.id,
          modelToolCallId: context.toolCall.id,
          error: parsed.error.message
        });
        const failed = await this.saveToolCall(context.toolCall.id, {
          ...entity,
          args,
          status: "failed",
          result: "计划参数非法，无法继续执行",
          updatedAt: nowIso()
        });
        this.push({ type: "tool_call", runId: this.options.runId, toolCall: failed });
        return { block: true, reason: "计划参数非法，无法继续执行。" };
      }
      this.options.planConfirmed = true;
      this.options.onPlanApproved?.(context.toolCall.id, parsed.data);
      console.info("[pi-events] 计划已确认", {
        toolCallId: entity.id,
        modelToolCallId: context.toolCall.id,
        chars: parsed.data.markdown.length
      });
    }

    if (entity.name === "ask_user" && decision.answer) {
      args = { ...entity.args, answer: decision.answer };
      this.options.onAskUserAnswered?.(context.toolCall.id, decision.answer);
      console.info("[pi-events] 用户已回答 ask_user", {
        toolCallId: entity.id,
        modelToolCallId: context.toolCall.id,
        answerCount: decision.answer.answers.length
      });
    }

    const running = await this.saveToolCall(context.toolCall.id, {
      ...entity,
      args,
      status: "running",
      ...(entity.approval ? { approval: markUserDecision(entity.approval, true) } : {}),
      startedAt: nowIso(),
      updatedAt: nowIso()
    });
    this.push({ type: "tool_call", runId: this.options.runId, toolCall: running });
    return undefined;
  };

  /** AgentLoopConfig.shouldStopAfterTurn: abort fast, cap runaway tool loops. */
  readonly shouldStopAfterTurn = (input: { message: unknown }): boolean => {
    if (this.options.signal.aborted) {
      return true;
    }
    const message = input.message as AssistantMessage;
    if (message.stopReason === "toolUse" && this.turnCount >= MAX_TOOL_ITERATIONS) {
      this.maxIterationsHit = true;
      return true;
    }
    return false;
  };

  private async onAssistantEnd(message: AssistantMessage): Promise<void> {
    const text = joinBlocks(message.content, "text");
    const reasoning = joinBlocks(message.content, "thinking");
    const hasToolCalls = message.content.some((block) => block.type === "toolCall");
    this.usage = message.usage;

    if (message.stopReason === "error") {
      this.errorMessage = message.errorMessage ?? "模型请求失败";
      return;
    }
    if (message.stopReason === "aborted") {
      this.aborted = true;
      if (!text.trim()) {
        return;
      }
    }
    if (!text.trim() && !hasToolCalls) {
      return;
    }

    const persisted = await this.options.store.addMessage({
      sessionId: this.options.sessionId,
      role: "assistant",
      content: text,
      ...(reasoning
        ? { reasoning, reasoningMs: this.reasoningMs ?? this.sinceReasoningStart() }
        : {}),
      ...(this.turnStartedAt !== undefined
        ? { durationMs: Date.now() - this.turnStartedAt }
        : {}),
      payload: JSON.stringify(message)
    });
    // Reasoning-only turns (think → straight to tools) are pushed too: the
    // message row anchors the reasoning panel at its true place in the
    // timeline, before the tool calls it preceded.
    if (text.trim() || reasoning) {
      this.push({ type: "message", runId: this.options.runId, message: stripPayload(persisted) });
    }
  }

  private async onToolResultMessage(message: ToolResultMessage): Promise<void> {
    await this.options.store.addMessage({
      sessionId: this.options.sessionId,
      role: "tool",
      content: joinBlocks(message.content, "text"),
      payload: JSON.stringify(message)
    });
  }

  private async onToolExecutionStart(
    toolCallId: string,
    toolName: string,
    args: unknown
  ): Promise<void> {
    const normalizedArgs = normalizeArgs(args);
    const risk = assessToolApprovalRisk(toolName, normalizedArgs);
    const requiresGate =
      risk.requiresGate || Boolean(this.options.strictApproval && requiresApproval(toolName));
    const needsManualApproval =
      toolName === "propose_plan" ||
      toolName === "ask_user" ||
      (requiresGate && this.options.accessMode === "approval");
    const needsSmartApproval =
      requiresGate && this.options.accessMode === "smart_approval";
    const pendingStatus = needsManualApproval
      ? "pending_approval"
      : needsSmartApproval
        ? "pending_smart_approval"
        : "running";
    // 只取一次时间，避免 createdAt / startedAt 跨毫秒后出现反序。
    const at = nowIso();
    const active = this.toolCalls.get(toolCallId);
    if (active && !isTerminalToolStatus(active.status)) {
      const reused = await this.saveToolCall(toolCallId, {
        ...active,
        name: toolName,
        args: normalizedArgs,
        status: pendingStatus === "running" ? "running" : active.status,
        ...(pendingStatus === "running" ? { startedAt: active.startedAt ?? at } : {}),
        updatedAt: at
      });
      console.warn("[pi-events] 收到重复的工具执行开始事件，复用当前工具调用", {
        runId: this.options.runId,
        modelToolCallId: toolCallId,
        toolCallId: reused.id,
        toolName,
        status: reused.status
      });
      this.push({ type: "tool_call", runId: this.options.runId, toolCall: reused });
      return;
    }
    const toolCall: ToolCall = {
      id: this.nextAppToolCallId(toolCallId),
      runId: this.options.runId,
      name: toolName,
      args: normalizedArgs,
      status: pendingStatus,
      ...(pendingStatus === "running" ? { startedAt: at } : {}),
      createdAt: at,
      updatedAt: at
    };
    this.toolCalls.set(toolCallId, toolCall);
    await this.options.store.insertToolCall(toolCall);
    console.info("[pi-events] 工具执行开始", {
      runId: this.options.runId,
      modelToolCallId: toolCallId,
      toolCallId: toolCall.id,
      toolName,
      status: toolCall.status,
      risk: risk.risk,
      requiresGate,
      reason: risk.reason
    });
    this.push({ type: "tool_call", runId: this.options.runId, toolCall });
  }

  private async resolveSmartApproval(
    modelToolCallId: string,
    entity: ToolCall
  ): Promise<ToolCallApproval> {
    const fallback: ToolCallApproval = {
      kind: "smart",
      source: "fallback",
      verdict: "ask_user",
      risk: "high",
      score: 0.85,
      reason: "智能审批未配置，已交给你确认。",
      decidedAt: nowIso()
    };
    let decision = fallback;
    if (this.options.smartApproval) {
      try {
        decision = await this.options.smartApproval(entity);
      } catch (error) {
        console.warn("[pi-events] 智能审批裁决异常，降级为人工审批", {
          runId: this.options.runId,
          modelToolCallId,
          toolCallId: entity.id,
          toolName: entity.name,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    console.info("[pi-events] 智能审批裁决", {
      runId: this.options.runId,
      modelToolCallId,
      toolCallId: entity.id,
      toolName: entity.name,
      verdict: decision.verdict,
      risk: decision.risk,
      score: decision.score
    });

    const status =
      decision.verdict === "allow"
        ? "running"
        : decision.verdict === "deny"
          ? "rejected"
          : "pending_approval";
    const updated = await this.saveToolCall(modelToolCallId, {
      ...entity,
      status,
      approval: decision,
      ...(status === "running" ? { startedAt: nowIso() } : {}),
      ...(status === "rejected" ? { result: "智能审批不同意执行该操作" } : {}),
      updatedAt: nowIso()
    });
    this.push({ type: "tool_call", runId: this.options.runId, toolCall: updated });
    return decision;
  }

  private onToolActivity(update: AssistantMessageEvent): void {
    if (
      update.type !== "toolcall_start" &&
      update.type !== "toolcall_delta" &&
      update.type !== "toolcall_end"
    ) {
      return;
    }
    const streamed =
      update.type === "toolcall_end"
        ? update.toolCall
        : update.partial.content[update.contentIndex];
    const toolCall = streamed?.type === "toolCall" ? streamed : undefined;
    const argsPreview = previewToolArgs(toolCall?.arguments);
    const appToolCallId = toolCall?.id ? this.previewAppToolCallId(toolCall.id) : undefined;
    const signature = JSON.stringify({
      toolCallId: appToolCallId,
      modelToolCallId: toolCall?.id,
      name: toolCall?.name,
      argsPreview
    });
    if (this.toolActivitySignatures.get(update.contentIndex) === signature) {
      return;
    }
    this.toolActivitySignatures.set(update.contentIndex, signature);
    console.debug("[pi-events] 工具参数活动更新", {
      runId: this.options.runId,
      contentIndex: update.contentIndex,
      modelToolCallId: toolCall?.id,
      toolCallId: appToolCallId,
      toolName: toolCall?.name,
      previewKeys: Object.keys(argsPreview)
    });
    this.push({
      type: "tool_activity",
      runId: this.options.runId,
      activity: {
        contentIndex: update.contentIndex,
        ...(appToolCallId ? { toolCallId: appToolCallId } : {}),
        ...(toolCall?.name ? { name: toolCall.name } : {}),
        argsPreview,
        updatedAt: nowIso()
      }
    });
  }

  private async onToolExecutionEnd(
    toolCallId: string,
    result: { content?: Array<{ type: string; text?: string }> },
    isError: boolean
  ): Promise<void> {
    const entity = this.toolCalls.get(toolCallId);
    if (!entity) {
      console.warn("[pi-events] 收到未知工具执行结束事件，已忽略", {
        runId: this.options.runId,
        modelToolCallId: toolCallId
      });
      return;
    }
    if (entity.status === "rejected") {
      // A blocked tool already emitted its rejected transition; pi's follow-up
      // error result must not clobber it.
      return;
    }
    const completed = await this.saveToolCall(toolCallId, {
      ...entity,
      status: isError ? "failed" : "completed",
      result: (result.content ?? [])
        .filter((block) => block.type === "text" && typeof block.text === "string")
        .map((block) => block.text)
        .join("\n"),
      updatedAt: nowIso()
    });
    this.push({ type: "tool_call", runId: this.options.runId, toolCall: completed });
  }

  private async onAgentEnd(): Promise<void> {
    if (this.aborted || this.options.signal.aborted) {
      await this.finish({ status: "aborted" });
      return;
    }
    if (this.errorMessage !== undefined) {
      await this.finish({ status: "failed", error: this.errorMessage });
      return;
    }
    if (this.maxIterationsHit) {
      await this.finish({
        status: "failed",
        error: `已达到最大工具调用轮数（${MAX_TOOL_ITERATIONS}），任务可能过于复杂，请拆分后重试。`
      });
      return;
    }
    await this.finish({ status: "completed" });
  }

  /** Persist the terminal run status and push the run_end event. */
  async finish(outcome: {
    status: "completed" | "failed" | "aborted";
    error?: string;
  }): Promise<void> {
    if (this.finished) {
      return;
    }
    this.finished = true;
    const usage =
      outcome.status === "completed"
        ? mergeTokenUsage(
            this.options.initialUsage,
            this.usage ? toTokenUsage(this.usage) : undefined
          )
        : undefined;
    await this.options.store.updateRunStatus(
      this.options.runId,
      outcome.status,
      usage,
      outcome.error
    );
    if (usage?.costUsd !== undefined) {
      console.info("[agent-runner] 已记录 run 用量费用", {
        runId: this.options.runId,
        sessionId: this.options.sessionId,
        costUsd: usage.costUsd
      });
    }
    this.options.queue.push({
      type: "run_end",
      runId: this.options.runId,
      status: outcome.status,
      ...(outcome.error !== undefined ? { error: outcome.error } : {}),
      ...(usage ? { usage } : {})
    });
  }

  private sinceReasoningStart(): number {
    return this.reasoningStartedAt !== undefined ? Date.now() - this.reasoningStartedAt : 0;
  }

  private async saveToolCall(modelToolCallId: string, toolCall: ToolCall): Promise<ToolCall> {
    this.toolCalls.set(modelToolCallId, toolCall);
    return this.options.store.updateToolCall(toolCall);
  }

  private push(event: StreamEvent): void {
    this.options.queue.push(event);
  }

  private nextAppToolCallId(modelToolCallId: string): string {
    const occurrence = this.toolCallOccurrences.get(modelToolCallId) ?? 0;
    this.toolCallOccurrences.set(modelToolCallId, occurrence + 1);
    return buildAppToolCallId(this.options.runId, modelToolCallId, occurrence);
  }

  private previewAppToolCallId(modelToolCallId: string): string {
    const active = this.toolCalls.get(modelToolCallId);
    if (active && !isTerminalToolStatus(active.status)) {
      return active.id;
    }
    return buildAppToolCallId(
      this.options.runId,
      modelToolCallId,
      this.toolCallOccurrences.get(modelToolCallId) ?? 0
    );
  }
}

function mergeTokenUsage(
  first: TokenUsage | undefined,
  second: TokenUsage | undefined
): TokenUsage | undefined {
  if (!first) {
    return second;
  }
  if (!second) {
    return first;
  }
  const cachedPromptTokens = (first.cachedPromptTokens ?? 0) + (second.cachedPromptTokens ?? 0);
  const costUsd = (first.costUsd ?? 0) + (second.costUsd ?? 0);
  return {
    promptTokens: first.promptTokens + second.promptTokens,
    completionTokens: first.completionTokens + second.completionTokens,
    totalTokens: first.totalTokens + second.totalTokens,
    ...(cachedPromptTokens > 0 ? { cachedPromptTokens } : {}),
    ...(first.costUsd !== undefined || second.costUsd !== undefined ? { costUsd } : {})
  };
}

function joinBlocks(
  content: AssistantMessage["content"] | ToolResultMessage["content"],
  type: "text" | "thinking"
): string {
  return content
    .map((block) => {
      if (type === "text" && block.type === "text") {
        return block.text;
      }
      if (type === "thinking" && block.type === "thinking") {
        return block.thinking;
      }
      return "";
    })
    .filter(Boolean)
    .join("");
}

function isTerminalToolStatus(status: ToolCall["status"]): boolean {
  return status === "completed" || status === "failed" || status === "rejected";
}

function markUserDecision(
  approval: ToolCallApproval,
  approved: boolean
): ToolCallApproval {
  return {
    ...approval,
    userDecision: {
      approved,
      decidedAt: nowIso()
    }
  };
}

function buildAppToolCallId(runId: string, modelToolCallId: string, occurrence: number): string {
  const encodedModelId = encodeToolCallIdPart(modelToolCallId) || "empty";
  return occurrence === 0
    ? `${runId}:tool_${encodedModelId}`
    : `${runId}:tool_${encodedModelId}:${occurrence}`;
}

function encodeToolCallIdPart(value: string): string {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function normalizeArgs(args: unknown): Record<string, unknown> {
  return typeof args === "object" && args !== null ? (args as Record<string, unknown>) : {};
}

function previewToolArgs(args: unknown): ToolActivityArgsPreview {
  const source = normalizeArgs(args);
  const preview: ToolActivityArgsPreview = {};
  for (const key of TOOL_ACTIVITY_PREVIEW_KEYS) {
    const value = source[key];
    if (typeof value !== "string" || value.length === 0) {
      continue;
    }
    preview[key] = truncatePreview(value);
  }
  return preview;
}

function truncatePreview(value: string): string {
  return value.length > TOOL_ACTIVITY_PREVIEW_MAX
    ? `${value.slice(0, TOOL_ACTIVITY_PREVIEW_MAX)}...`
    : value;
}

function stripPayload<T extends { payload?: string }>(message: T): Omit<T, "payload"> {
  const { payload: _payload, ...rest } = message;
  return rest;
}
