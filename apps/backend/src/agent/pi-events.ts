import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
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
  isToolActivityPreviewToolName,
  normalizeErrorMessage,
  nowIso,
  proposePlanArgsSchema,
  type AccessMode,
  type AskUserAnswer,
  type FileChange,
  type ProposePlanArgs,
  type StreamEvent,
  type TokenUsage,
  type ToolActivityArgsPreview,
  type ToolCallApproval,
  type ToolCallPreview,
  type ToolCall
} from "@chengxiaobang/shared";
import type { StateStore } from "../repository/state-store";
import { errorToLogFields, getLogger } from "../logging/logger";
import { toTokenUsage } from "../model/pi-model";
import { assessToolApprovalRisk } from "../tools/approval-policy";
import {
  buildAggregatedFileChange,
  mergeFileChangeOperation,
  type ToolFileChangeDetails
} from "../tools/file-change";
import { requiresApproval } from "../tools/registry";
import { resolveToolPath } from "../tools/workspace";
import { normalizeDecision, type ApprovalQueue } from "./approval-queue";
import type { AsyncEventQueue } from "./async-queue";
import type { ProjectApprovalTrustService } from "./project-approval-trust";
import {
  TODO_IDLE_REMINDER,
  buildRepeatedToolReminder,
  buildToolOverloadReminder
} from "./system-reminders";

const REJECTED_RESULT = "用户拒绝执行该操作";
const REJECTED_MODEL_HINT = "用户拒绝执行该操作。请考虑其他方式或向用户说明。";
const TOOL_ACTIVITY_PREVIEW_MAX = 120;
const log = getLogger({ module: "pi-events" });
type ToolActivityUpdate = Extract<AssistantMessageEvent, { contentIndex: number }>;

/** 连续以相同参数重复调用同一工具，达到此次数注入一次软提醒。 */
const REPEATED_TOOL_THRESHOLD = 3;
/** 单个 run 工具调用数达到 maxToolIterations 的此比例时，注入一次过载软提醒。 */
const TOOL_OVERLOAD_RATIO = 0.7;
/** todo 自上次 TodoWrite 起经过此轮数仍有未完成项，触发空闲提醒。 */
const TODO_REMINDER_AFTER_TURNS = 6;
/** 两次 todo 空闲提醒之间至少间隔此轮数，避免刷屏。 */
const TODO_REMINDER_GAP_TURNS = 6;

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
  private readonly fileChangeAggregates = new Map<string, RunFileChangeAggregate>();
  private readonly toolCallOccurrences = new Map<string, number>();
  private readonly toolActivitySignatures = new Map<number, string>();
  private readonly planDrafts = new Map<number, { markdown: string; toolCallId?: string }>();
  private aborted = false;
  private errorMessage?: string;
  private maxIterationsHit = false;
  private usage?: Usage;
  private turnCount = 0;
  private turnStartedAt?: number;
  private reasoningStartedAt?: number;
  private reasoningMs?: number;
  // 动态软提醒（todo 空闲 / 工具异常）状态。pendingReminders 由每轮的
  // collectReminders 取走并清空，合成不落库的 system-reminder 消息注入下一轮。
  private toolCallsInRun = 0;
  private lastToolSignature?: string;
  private repeatedToolCount = 0;
  private repeatToolReminded = false;
  private overloadReminded = false;
  private lastTodoWriteTurn = 0;
  private hasActiveTodos = false;
  private lastTodoReminderTurn = Number.NEGATIVE_INFINITY;
  private readonly pendingReminders: string[] = [];

  constructor(
    private readonly options: {
      store: StateStore;
      queue: AsyncEventQueue<StreamEvent>;
      approvals: ApprovalQueue;
      runId: string;
      sessionId: string;
      projectId: string | null;
      workspacePath: string;
      accessMode: AccessMode;
      projectApprovalTrustService: ProjectApprovalTrustService;
      strictApproval?: boolean;
      signal: AbortSignal;
      model: string;
      maxToolIterations: number;
      planMode?: boolean;
      planConfirmed?: boolean;
      initialUsage?: TokenUsage;
      smartApproval?: (toolCall: ToolCall) => Promise<ToolCallApproval>;
      onAssistantMessageEnd?: (message: AssistantMessage) => void | Promise<void>;
      onPlanApproved?: (toolCallId: string, args: ProposePlanArgs) => void;
      onAskUserAnswered?: (toolCallId: string, answer: AskUserAnswer) => void;
    }
  ) {}

  isPlanConfirmed(): boolean {
    return Boolean(this.options.planConfirmed);
  }

  /**
   * 取走本轮应注入的动态软提醒文案并清空待发队列；同时按轮次判断 todo 空闲提醒。
   * 由 agent-runner 在每轮 getSteeringMessages 调用，合成不落库的 SR 消息。
   */
  collectReminders(): string[] {
    const reminders = this.pendingReminders.splice(0);
    if (
      this.hasActiveTodos &&
      this.turnCount - this.lastTodoWriteTurn >= TODO_REMINDER_AFTER_TURNS &&
      this.turnCount - this.lastTodoReminderTurn >= TODO_REMINDER_GAP_TURNS
    ) {
      reminders.push(TODO_IDLE_REMINDER);
      this.lastTodoReminderTurn = this.turnCount;
      log.info("触发 todo 空闲软提醒", {
        action: "reminder.todo_idle",
        runId: this.options.runId,
        turnCount: this.turnCount,
        lastTodoWriteTurn: this.lastTodoWriteTurn
      });
    }
    return reminders;
  }

  /** 统计工具调用，识别重复调用 / 调用过载 / todo 更新，产出软提醒。 */
  private trackToolForReminders(toolName: string, args: Record<string, unknown>): void {
    this.toolCallsInRun += 1;
    const signature = `${toolName}:${JSON.stringify(args)}`;
    if (signature === this.lastToolSignature) {
      this.repeatedToolCount += 1;
    } else {
      this.lastToolSignature = signature;
      this.repeatedToolCount = 1;
      this.repeatToolReminded = false;
    }
    if (this.repeatedToolCount >= REPEATED_TOOL_THRESHOLD && !this.repeatToolReminded) {
      this.pendingReminders.push(buildRepeatedToolReminder(toolName, this.repeatedToolCount));
      this.repeatToolReminded = true;
      log.info("触发重复工具调用软提醒", {
        action: "reminder.repeated_tool",
        runId: this.options.runId,
        toolName,
        count: this.repeatedToolCount
      });
    }
    const overloadAt = Math.max(1, Math.round(this.options.maxToolIterations * TOOL_OVERLOAD_RATIO));
    if (this.toolCallsInRun >= overloadAt && !this.overloadReminded) {
      this.pendingReminders.push(buildToolOverloadReminder(this.toolCallsInRun));
      this.overloadReminded = true;
      log.info("触发工具调用过载软提醒", {
        action: "reminder.tool_overload",
        runId: this.options.runId,
        toolCalls: this.toolCallsInRun,
        overloadAt
      });
    }
    if (toolName === "TodoWrite") {
      this.lastTodoWriteTurn = this.turnCount;
      this.hasActiveTodos = hasUnfinishedTodos(args);
    }
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
          this.planDrafts.clear();
        }
        return;
      case "message_update": {
        const update = event.assistantMessageEvent;
        if (update.type === "text_delta") {
          this.closeReasoningTimer();
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
        } else if (update.type === "thinking_end") {
          this.closeReasoningTimer();
        } else if (
          update.type === "toolcall_start" ||
          update.type === "toolcall_delta" ||
          update.type === "toolcall_end"
        ) {
          this.closeReasoningTimer();
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
        entity.name === "ExitPlanMode" && decision.answer
          ? planAdjustmentResult(decision.answer)
          : REJECTED_RESULT;
      const rejectedReason =
        entity.name === "ExitPlanMode" && decision.answer
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
    if (entity.name === "ExitPlanMode") {
      args = decision.editedSteps ? { ...entity.args, steps: decision.editedSteps } : entity.args;
      const parsed = proposePlanArgsSchema.safeParse(args);
      if (!parsed.success) {
        log.warn("用户确认后的计划参数非法，阻止执行", {
          action: "plan.confirm_invalid_args",
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
      log.info("计划已确认", {
        action: "plan.confirmed",
        toolCallId: entity.id,
        modelToolCallId: context.toolCall.id,
        chars: parsed.data.markdown.length
      });
    }

    if (entity.name === "AskUserQuestion" && decision.answer) {
      args = { ...entity.args, answer: decision.answer };
      this.options.onAskUserAnswered?.(context.toolCall.id, decision.answer);
      log.info("用户已回答 AskUserQuestion", {
        action: "ask_user.answered",
        toolCallId: entity.id,
        modelToolCallId: context.toolCall.id,
        answerCount: decision.answer.answers.length
      });
    }

    if (decision.approvalScope === "project") {
      await this.options.projectApprovalTrustService.trust({
        projectId: this.options.projectId,
        toolName: entity.name,
        args
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

  /** AgentLoopConfig.shouldStopAfterTurn：快速响应中止，并限制异常工具循环。 */
  readonly shouldStopAfterTurn = (input: { message: unknown }): boolean => {
    if (this.options.signal.aborted) {
      return true;
    }
    const message = input.message as AssistantMessage;
    if (message.stopReason === "toolUse" && this.turnCount >= this.options.maxToolIterations) {
      this.maxIterationsHit = true;
      log.warn("已达到模型工具调用上限，停止本次 run", {
        action: "run.max_tool_iterations_hit",
        runId: this.options.runId,
        sessionId: this.options.sessionId,
        model: this.options.model,
        turnCount: this.turnCount,
        limit: this.options.maxToolIterations,
        stopReason: message.stopReason
      });
      return true;
    }
    return false;
  };

  private async onAssistantEnd(message: AssistantMessage): Promise<void> {
    const text = joinBlocks(message.content, "text");
    const reasoning = joinBlocks(message.content, "thinking");
    const hasToolCalls = message.content.some((block) => block.type === "toolCall");
    this.usage = message.usage;
    await this.options.onAssistantMessageEnd?.(message);

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
    const risk = assessToolApprovalRisk(toolName, normalizedArgs, {
      workspacePath: this.options.workspacePath
    });
    const requiresGate =
      risk.requiresGate || Boolean(this.options.strictApproval && requiresApproval(toolName));
    const projectTrusted =
      requiresGate &&
      this.options.accessMode === "approval" &&
      (await this.isProjectTrusted(toolName, normalizedArgs));
    const needsManualApproval =
      toolName === "ExitPlanMode" ||
      toolName === "AskUserQuestion" ||
      (requiresGate && this.options.accessMode === "approval" && !projectTrusted);
    const needsSmartApproval =
      requiresGate && this.options.accessMode === "smart_approval";
    const pendingStatus = needsManualApproval
      ? "pending_approval"
      : needsSmartApproval
        ? "pending_smart_approval"
        : "running";
    const preview = await buildToolCallPreview(
      this.options.workspacePath,
      toolName,
      normalizedArgs
    );
    // 只取一次时间，避免 createdAt / startedAt 跨毫秒后出现反序。
    const at = nowIso();
    const active = this.toolCalls.get(toolCallId);
    if (active && !isTerminalToolStatus(active.status)) {
      const reused = await this.saveToolCall(toolCallId, {
        ...active,
        name: toolName,
        args: normalizedArgs,
        ...(preview ?? active.preview ? { preview: preview ?? active.preview } : {}),
        status: pendingStatus === "running" ? "running" : active.status,
        ...(pendingStatus === "running" ? { startedAt: active.startedAt ?? at } : {}),
        updatedAt: at
      });
      log.warn("收到重复的工具执行开始事件，复用当前工具调用", {
        action: "tool.start_duplicate",
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
      ...(preview ? { preview } : {}),
      ...(pendingStatus === "running" ? { startedAt: at } : {}),
      createdAt: at,
      updatedAt: at
    };
    this.toolCalls.set(toolCallId, toolCall);
    await this.options.store.insertToolCall(toolCall);
    this.trackToolForReminders(toolName, normalizedArgs);
    log.info("工具执行开始", {
      action: "tool.start",
      runId: this.options.runId,
      sessionId: this.options.sessionId,
      modelToolCallId: toolCallId,
      toolCallId: toolCall.id,
      toolName,
      status: toolCall.status,
      risk: risk.risk,
      requiresGate,
      projectTrusted,
      hasPreview: Boolean(preview),
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
        log.warn("智能审批裁决异常，降级为人工审批", {
          action: "smart_approval.fallback",
          runId: this.options.runId,
          modelToolCallId,
          toolCallId: entity.id,
          toolName: entity.name,
          ...errorToLogFields(error)
        });
      }
    }

    log.info("智能审批裁决", {
      action: "smart_approval.decided",
      runId: this.options.runId,
      modelToolCallId,
      toolCallId: entity.id,
      toolName: entity.name,
      verdict: decision.verdict,
      risk: decision.risk,
      score: decision.score
    });

    const trustedAfterSmart =
      decision.verdict === "ask_user" && (await this.isProjectTrusted(entity.name, entity.args));
    const effectiveDecision = trustedAfterSmart
      ? {
          ...decision,
          verdict: "allow" as const,
          reason: `${decision.reason} 项目级信任规则已允许。`
        }
      : decision;

    const status =
      effectiveDecision.verdict === "allow"
        ? "running"
        : effectiveDecision.verdict === "deny"
          ? "rejected"
          : "pending_approval";
    const updated = await this.saveToolCall(modelToolCallId, {
      ...entity,
      status,
      approval: effectiveDecision,
      ...(status === "running" ? { startedAt: nowIso() } : {}),
      ...(status === "rejected" ? { result: "智能审批不同意执行该操作" } : {}),
      updatedAt: nowIso()
    });
    this.push({ type: "tool_call", runId: this.options.runId, toolCall: updated });
    return effectiveDecision;
  }

  private async isProjectTrusted(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<boolean> {
    if (!isProjectTrustEligible(toolName)) {
      return false;
    }
    return this.options.projectApprovalTrustService.isTrusted({
      projectId: this.options.projectId,
      toolName,
      args
    });
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
    const appToolCallId = toolCall?.id ? this.previewAppToolCallId(toolCall.id) : undefined;
    if (!toolCall?.name) {
      this.logSkippedToolActivity(update, toolCall, appToolCallId, "missing_tool_name");
      return;
    }
    if (toolCall.name === "ExitPlanMode") {
      this.onPlanDraftActivity(update, toolCall.arguments, appToolCallId);
      return;
    }
    if (!isToolActivityPreviewToolName(toolCall.name)) {
      this.logSkippedToolActivity(update, toolCall, appToolCallId, "unsupported_tool");
      return;
    }
    const argsPreview = previewToolArgs(toolCall.arguments);
    if (!argsPreview.file_path) {
      this.logSkippedToolActivity(update, toolCall, appToolCallId, "missing_file_path");
      return;
    }
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
    log.debug("工具参数活动更新", {
      action: "tool.activity_update",
      runId: this.options.runId,
      contentIndex: update.contentIndex,
      modelToolCallId: toolCall?.id,
      toolCallId: appToolCallId,
      toolName: toolCall?.name,
      previewKeys: Object.keys(argsPreview),
      argsPreview
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

  private onPlanDraftActivity(
    update: ToolActivityUpdate,
    args: unknown,
    appToolCallId: string | undefined
  ): void {
    const markdown = previewPlanMarkdown(args);
    if (!markdown) {
      return;
    }
    const current = this.planDrafts.get(update.contentIndex);
    const toolCallId = appToolCallId ?? current?.toolCallId;
    if (current?.markdown === markdown && current.toolCallId === toolCallId) {
      return;
    }
    const delta = current?.markdown && markdown.startsWith(current.markdown)
      ? markdown.slice(current.markdown.length)
      : markdown;
    this.planDrafts.set(update.contentIndex, { markdown, ...(toolCallId ? { toolCallId } : {}) });
    log.debug("计划参数流更新", {
      action: "plan.delta",
      runId: this.options.runId,
      contentIndex: update.contentIndex,
      toolCallId,
      markdownChars: markdown.length,
      deltaChars: delta.length
    });
    this.push({
      type: "plan_delta",
      runId: this.options.runId,
      contentIndex: update.contentIndex,
      ...(toolCallId ? { toolCallId } : {}),
      markdown,
      delta,
      updatedAt: nowIso()
    });
  }

  private logSkippedToolActivity(
    update: ToolActivityUpdate,
    toolCall: { id?: string; name?: string } | undefined,
    appToolCallId: string | undefined,
    reason: "missing_tool_name" | "unsupported_tool" | "missing_file_path"
  ): void {
    const signature = JSON.stringify({
      reason,
      toolCallId: appToolCallId,
      modelToolCallId: toolCall?.id,
      name: toolCall?.name
    });
    if (this.toolActivitySignatures.get(update.contentIndex) === signature) {
      return;
    }
    this.toolActivitySignatures.set(update.contentIndex, signature);
    log.debug("跳过工具参数活动预览", {
      action: "tool.activity_skip",
      runId: this.options.runId,
      contentIndex: update.contentIndex,
      reason,
      modelToolCallId: toolCall?.id,
      toolCallId: appToolCallId,
      toolName: toolCall?.name
    });
  }

  private async onToolExecutionEnd(
    toolCallId: string,
    result: { content?: Array<{ type: string; text?: string }>; details?: unknown },
    isError: boolean
  ): Promise<void> {
    const entity = this.toolCalls.get(toolCallId);
    if (!entity) {
      log.warn("收到未知工具执行结束事件，已忽略", {
        action: "tool.end_unknown",
        runId: this.options.runId,
        modelToolCallId: toolCallId
      });
      return;
    }
    if (
      entity.status === "rejected" ||
      entity.status === "pending_approval" ||
      entity.status === "pending_smart_approval"
    ) {
      // 已拒绝:被拦截的工具已发出 rejected 迁移,pi 后续的 error result 不能覆盖它。
      // 仍处于待审批:执行结束事件不应把审批态直接写成 completed/failed 而丢掉审批记录
      //(正常顺序下不会发生,这里是对事件乱序的防御)。
      log.warn("工具执行结束事件命中非运行态，跳过覆盖", {
        action: "tool.end_non_running",
        runId: this.options.runId,
        toolCallId,
        status: entity.status
      });
      return;
    }
    const fileChange = !isError
      ? this.fileChangeFromToolResult(entity, result.details)
      : undefined;
    const completed = await this.saveToolCall(toolCallId, {
      ...entity,
      status: isError ? "failed" : "completed",
      result: (result.content ?? [])
        .filter((block) => block.type === "text" && typeof block.text === "string")
        .map((block) => block.text)
        .join("\n"),
      ...(fileChange ? { fileChange } : {}),
      updatedAt: nowIso()
    });
    this.push({ type: "tool_call", runId: this.options.runId, toolCall: completed });
  }

  private fileChangeFromToolResult(
    entity: ToolCall,
    details: unknown
  ): FileChange | undefined {
    if (!isToolFileChangeDetails(details)) {
      if (details !== undefined && (entity.name === "Write" || entity.name === "Edit")) {
        log.warn("文件工具结果缺少可用 diff details", {
          action: "tool.file_change_missing_details",
          runId: this.options.runId,
          toolCallId: entity.id,
          toolName: entity.name
        });
      }
      return undefined;
    }
    const fileChange: FileChange = {
      path: details.path,
      operation: details.operation,
      patch: details.patch,
      additions: details.additions,
      deletions: details.deletions,
      toolCallIds: [entity.id],
      ...(details.truncated ? { truncated: true } : {})
    };
    this.trackRunFileChange(entity.id, details);
    log.info("已记录工具文件 diff", {
      action: "tool.file_change_recorded",
      runId: this.options.runId,
      toolCallId: entity.id,
      toolName: entity.name,
      path: fileChange.path,
      operation: fileChange.operation,
      additions: fileChange.additions,
      deletions: fileChange.deletions,
      truncated: Boolean(fileChange.truncated)
    });
    return fileChange;
  }

  private trackRunFileChange(toolCallId: string, details: ToolFileChangeDetails): void {
    const existing = this.fileChangeAggregates.get(details.path);
    if (!existing) {
      this.fileChangeAggregates.set(details.path, {
        path: details.path,
        operation: details.operation,
        beforeText: details.beforeText,
        afterText: details.afterText,
        toolCallIds: [toolCallId]
      });
      return;
    }
    existing.operation = mergeFileChangeOperation(existing.operation, details.operation);
    existing.afterText = details.afterText;
    existing.toolCallIds.push(toolCallId);
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
        error: `已达到当前模型的工具调用上限（${this.options.maxToolIterations}），本次任务可能过长或陷入循环，请检查当前进展后重试。`
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
    // 失败时完整错误先写日志,持久化与推送给前端的 run_end 事件只保留归一化后的精简文案。
    if (outcome.status === "failed" && outcome.error !== undefined) {
      log.error("run 结束于失败状态", {
        action: "run.failed",
        runId: this.options.runId,
        sessionId: this.options.sessionId,
        errorMessage: outcome.error
      });
    }
    const normalizedError =
      outcome.error !== undefined ? normalizeErrorMessage(outcome.error) : undefined;
    const usage =
      outcome.status === "completed"
        ? mergeTokenUsage(
            this.options.initialUsage,
            this.usage ? toTokenUsage(this.usage) : undefined
          )
        : undefined;
    const fileChanges = this.finalizeFileChanges();
    await this.options.store.updateRunStatus(
      this.options.runId,
      outcome.status,
      usage,
      normalizedError,
      fileChanges.length > 0 ? fileChanges : undefined
    );
    if (usage?.costUsd !== undefined) {
      log.info("已记录 run 用量费用", {
        action: "run.usage_cost_recorded",
        runId: this.options.runId,
        sessionId: this.options.sessionId,
        costUsd: usage.costUsd
      });
    }
    this.options.queue.push({
      type: "run_end",
      runId: this.options.runId,
      status: outcome.status,
      ...(normalizedError !== undefined ? { error: normalizedError } : {}),
      ...(usage ? { usage } : {}),
      ...(fileChanges.length > 0 ? { fileChanges } : {})
    });
  }

  private finalizeFileChanges(): FileChange[] {
    const fileChanges = [...this.fileChangeAggregates.values()]
      .map((change) =>
        buildAggregatedFileChange({
          path: change.path,
          operation: change.operation,
          before: change.beforeText,
          after: change.afterText,
          toolCallIds: change.toolCallIds
        })
      )
      .filter((change): change is FileChange => Boolean(change));
    if (fileChanges.length > 0) {
      log.info("已聚合本轮文件 diff", {
        action: "run.file_changes_finalized",
        runId: this.options.runId,
        fileCount: fileChanges.length,
        paths: fileChanges.map((change) => change.path)
      });
    }
    return fileChanges;
  }

  private sinceReasoningStart(): number {
    return this.reasoningStartedAt !== undefined ? Date.now() - this.reasoningStartedAt : 0;
  }

  private closeReasoningTimer(): void {
    if (this.reasoningStartedAt === undefined) {
      return;
    }
    this.reasoningMs ??= Date.now() - this.reasoningStartedAt;
    this.reasoningStartedAt = undefined;
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

interface RunFileChangeAggregate {
  path: string;
  operation: FileChange["operation"];
  beforeText: string;
  afterText: string;
  toolCallIds: string[];
}

async function buildToolCallPreview(
  workspacePath: string,
  toolName: string,
  args: Record<string, unknown>
): Promise<ToolCallPreview | undefined> {
  if (toolName !== "Write" && toolName !== "Edit") {
    return undefined;
  }
  const path = stringArg(args.file_path);
  if (!path) {
    return undefined;
  }
  try {
    const target = resolveToolPath(workspacePath, path).target;
    const preview =
      toolName === "Write"
        ? await buildWritePreview(path, target, args)
        : await buildEditPreview(path, target, args);
    if (preview) {
      log.info("已生成工具审批预览 diff", {
        action: "tool.preview_built",
        toolName,
        path,
        target,
        oldLength: preview.oldText.length,
        newLength: preview.newText.length
      });
    }
    return preview;
  } catch (error) {
    log.warn("生成工具审批预览 diff 失败，降级为参数预览", {
      action: "tool.preview_failed",
      toolName,
      path,
      workspacePath,
      ...errorToLogFields(error)
    });
    return undefined;
  }
}

async function buildWritePreview(
  path: string,
  target: string,
  args: Record<string, unknown>
): Promise<ToolCallPreview | undefined> {
  const content = stringArg(args.content);
  if (content === undefined) {
    return undefined;
  }
  const oldText = await readTextOrEmpty(target);
  if (oldText === content) {
    return undefined;
  }
  return {
    kind: "text_diff",
    path,
    oldText,
    newText: content
  };
}

async function buildEditPreview(
  path: string,
  target: string,
  args: Record<string, unknown>
): Promise<ToolCallPreview | undefined> {
  const oldString = stringArg(args.old_string);
  const newString = stringArg(args.new_string);
  if (!oldString || newString === undefined) {
    return undefined;
  }
  const source = await readFile(target, "utf8");
  const occurrences = countStringOccurrences(source, oldString);
  const replaceAll = args.replace_all === true;
  if (occurrences === 0) {
    return undefined;
  }
  if (!replaceAll && occurrences > 1) {
    return undefined;
  }
  const next = replaceAll
    ? source.split(oldString).join(newString)
    : source.replace(oldString, newString);
  if (next === source) {
    return undefined;
  }
  return {
    kind: "text_diff",
    path,
    oldText: source,
    newText: next
  };
}

async function readTextOrEmpty(target: string): Promise<string> {
  try {
    return await readFile(target, "utf8");
  } catch (error) {
    if (isMissingPathError(error)) {
      return "";
    }
    throw error;
  }
}

function countStringOccurrences(source: string, needle: string): number {
  let count = 0;
  let index = 0;
  while (true) {
    const found = source.indexOf(needle, index);
    if (found === -1) {
      return count;
    }
    count += 1;
    index = found + needle.length;
  }
}

function stringArg(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isMissingPathError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "ENOENT"
  );
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

function isProjectTrustEligible(toolName: string): boolean {
  return toolName !== "AskUserQuestion" && toolName !== "ExitPlanMode";
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

function isToolFileChangeDetails(value: unknown): value is ToolFileChangeDetails {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const details = value as Partial<ToolFileChangeDetails>;
  return (
    typeof details.path === "string" &&
    (details.operation === "write" || details.operation === "edit") &&
    typeof details.patch === "string" &&
    typeof details.additions === "number" &&
    Number.isInteger(details.additions) &&
    details.additions >= 0 &&
    typeof details.deletions === "number" &&
    Number.isInteger(details.deletions) &&
    details.deletions >= 0 &&
    typeof details.beforeText === "string" &&
    typeof details.afterText === "string" &&
    (details.truncated === undefined || typeof details.truncated === "boolean")
  );
}

/** TodoWrite 的 args.todos 中是否还有未完成项，用于决定是否需要 todo 空闲提醒。 */
function hasUnfinishedTodos(args: Record<string, unknown>): boolean {
  const todos = (args as { todos?: unknown }).todos;
  if (!Array.isArray(todos)) {
    return false;
  }
  return todos.some((todo) => {
    const status = (todo as { status?: unknown })?.status;
    return typeof status === "string" && status !== "completed";
  });
}

function previewToolArgs(args: unknown): ToolActivityArgsPreview {
  const preview: ToolActivityArgsPreview = {};
  const source = normalizeArgs(args);
  const filePath =
    typeof args === "string" ? readJsonStringField(args, "file_path") : source.file_path;
  if (typeof filePath === "string" && filePath.length > 0) {
    preview.file_path = truncatePreview(filePath);
  }
  return preview;
}

function previewPlanMarkdown(args: unknown): string | undefined {
  const source = normalizeArgs(args);
  const plan = typeof args === "string" ? readPartialJsonStringField(args, "plan") : source.plan;
  return typeof plan === "string" && plan.length > 0 ? plan : undefined;
}

function readJsonStringField(source: string, key: string): string | undefined {
  return readJsonStringFieldInternal(source, key, false);
}

function readPartialJsonStringField(source: string, key: string): string | undefined {
  return readJsonStringFieldInternal(source, key, true);
}

function readJsonStringFieldInternal(
  source: string,
  key: string,
  allowPartial: boolean
): string | undefined {
  const encodedKey = JSON.stringify(key);
  let searchFrom = 0;
  while (searchFrom < source.length) {
    const keyIndex = source.indexOf(encodedKey, searchFrom);
    if (keyIndex === -1) {
      return undefined;
    }
    let cursor = keyIndex + encodedKey.length;
    cursor = skipJsonWhitespace(source, cursor);
    if (source[cursor] !== ":") {
      searchFrom = keyIndex + encodedKey.length;
      continue;
    }
    cursor = skipJsonWhitespace(source, cursor + 1);
    if (source[cursor] !== "\"") {
      searchFrom = keyIndex + encodedKey.length;
      continue;
    }
    return readJsonStringValue(source, cursor, allowPartial);
  }
  return undefined;
}

function skipJsonWhitespace(source: string, cursor: number): number {
  while (cursor < source.length && /\s/.test(source[cursor] ?? "")) {
    cursor += 1;
  }
  return cursor;
}

function readJsonStringValue(
  source: string,
  quoteIndex: number,
  allowPartial = false
): string | undefined {
  let escaped = false;
  for (let index = quoteIndex + 1; index < source.length; index += 1) {
    const char = source[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char !== "\"") {
      continue;
    }
    try {
      const value = JSON.parse(source.slice(quoteIndex, index + 1));
      return typeof value === "string" ? value : undefined;
    } catch {
      return undefined;
    }
  }
  return allowPartial ? decodePartialJsonStringContent(source.slice(quoteIndex + 1)) : undefined;
}

function decodePartialJsonStringContent(raw: string): string {
  let value = "";
  let escaped = false;
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index] ?? "";
    if (!escaped) {
      if (char === "\\") {
        escaped = true;
        continue;
      }
      value += char;
      continue;
    }
    switch (char) {
      case "\"":
      case "\\":
      case "/":
        value += char;
        break;
      case "b":
        value += "\b";
        break;
      case "f":
        value += "\f";
        break;
      case "n":
        value += "\n";
        break;
      case "r":
        value += "\r";
        break;
      case "t":
        value += "\t";
        break;
      case "u": {
        const hex = raw.slice(index + 1, index + 5);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
          return value;
        }
        value += String.fromCharCode(Number.parseInt(hex, 16));
        index += 4;
        break;
      }
      default:
        value += char;
        break;
    }
    escaped = false;
  }
  return value;
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
