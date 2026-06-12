import type {
  AgentEvent,
  BeforeToolCallContext,
  BeforeToolCallResult
} from "@earendil-works/pi-agent-core";
import type {
  AssistantMessage,
  ToolResultMessage,
  Usage
} from "@earendil-works/pi-ai";
import {
  nowIso,
  proposePlanArgsSchema,
  type AccessMode,
  type AskUserAnswer,
  type ProposePlanArgs,
  type StreamEvent,
  type ToolCall
} from "@chengxiaobang/shared";
import type { StateStore } from "../repository/state-store";
import { toTokenUsage } from "../model/pi-model";
import { requiresApproval } from "../tools/registry";
import { normalizeDecision, type ApprovalQueue } from "./approval-queue";
import type { AsyncEventQueue } from "./async-queue";

export const MAX_TOOL_ITERATIONS = 25;

const REJECTED_RESULT = "用户拒绝执行该操作";
const REJECTED_MODEL_HINT = "用户拒绝执行该操作。请考虑其他方式或向用户说明。";

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

  private readonly toolCalls = new Map<string, ToolCall>();
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
      signal: AbortSignal;
      planMode?: boolean;
      planConfirmed?: boolean;
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
    const entity = this.toolCalls.get(context.toolCall.id);
    if (!entity || entity.status !== "pending_approval") {
      return undefined;
    }
    const decision = normalizeDecision(
      entity.name,
      await this.options.approvals.wait(entity.id, this.options.signal)
    );
    if (!decision.approved) {
      const rejected = await this.saveToolCall({
        ...entity,
        status: "rejected",
        result: REJECTED_RESULT,
        updatedAt: nowIso()
      });
      this.push({ type: "tool_call", runId: this.options.runId, toolCall: rejected });
      return { block: true, reason: REJECTED_MODEL_HINT };
    }

    let args = entity.args;
    if (entity.name === "propose_plan") {
      args = decision.editedSteps ? { ...entity.args, steps: decision.editedSteps } : entity.args;
      const parsed = proposePlanArgsSchema.safeParse(args);
      if (!parsed.success) {
        console.warn("[pi-events] 用户确认后的计划参数非法，阻止执行", {
          toolCallId: entity.id,
          error: parsed.error.message
        });
        const failed = await this.saveToolCall({
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
      this.options.onPlanApproved?.(entity.id, parsed.data);
      console.info(`[pi-events] 计划已确认 toolCallId=${entity.id} steps=${parsed.data.steps.length}`);
    }

    if (entity.name === "ask_user" && decision.answer) {
      this.options.onAskUserAnswered?.(entity.id, decision.answer);
      console.info(`[pi-events] 用户已回答 ask_user toolCallId=${entity.id}`);
    }

    const running = await this.saveToolCall({
      ...entity,
      args,
      status: "running",
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
    const needsApproval =
      toolName === "propose_plan" ||
      toolName === "ask_user" ||
      (requiresApproval(toolName) && this.options.accessMode === "approval");
    // Single clock read: separate nowIso() calls can straddle a millisecond
    // tick and yield startedAt < createdAt.
    const at = nowIso();
    const toolCall: ToolCall = {
      id: toolCallId,
      runId: this.options.runId,
      name: toolName,
      args: normalizeArgs(args),
      status: needsApproval ? "pending_approval" : "running",
      // startedAt marks actual execution start, so approval wait is excluded.
      ...(needsApproval ? {} : { startedAt: at }),
      createdAt: at,
      updatedAt: at
    };
    this.toolCalls.set(toolCallId, toolCall);
    await this.options.store.insertToolCall(toolCall);
    this.push({ type: "tool_call", runId: this.options.runId, toolCall });
  }

  private async onToolExecutionEnd(
    toolCallId: string,
    result: { content?: Array<{ type: string; text?: string }> },
    isError: boolean
  ): Promise<void> {
    const entity = this.toolCalls.get(toolCallId);
    if (!entity || entity.status === "rejected") {
      // A blocked tool already emitted its rejected transition; pi's follow-up
      // error result must not clobber it.
      return;
    }
    const completed = await this.saveToolCall({
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
    await this.options.store.updateRunStatus(this.options.runId, outcome.status);
    this.options.queue.push({
      type: "run_end",
      runId: this.options.runId,
      status: outcome.status,
      ...(outcome.error !== undefined ? { error: outcome.error } : {}),
      ...(outcome.status === "completed" && this.usage
        ? { usage: toTokenUsage(this.usage) }
        : {})
    });
  }

  private sinceReasoningStart(): number {
    return this.reasoningStartedAt !== undefined ? Date.now() - this.reasoningStartedAt : 0;
  }

  private async saveToolCall(toolCall: ToolCall): Promise<ToolCall> {
    this.toolCalls.set(toolCall.id, toolCall);
    return this.options.store.updateToolCall(toolCall);
  }

  private push(event: StreamEvent): void {
    this.options.queue.push(event);
  }
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

function normalizeArgs(args: unknown): Record<string, unknown> {
  return typeof args === "object" && args !== null ? (args as Record<string, unknown>) : {};
}

function stripPayload<T extends { payload?: string }>(message: T): Omit<T, "payload"> {
  const { payload: _payload, ...rest } = message;
  return rest;
}
