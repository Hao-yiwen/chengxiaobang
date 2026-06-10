import {
  createId,
  nowIso,
  toolNameSchema,
  type AssistantToolCall,
  type ProviderConfig,
  type RunRequest,
  type Session,
  type StreamEvent,
  type TokenUsage,
  type ToolCall,
  type ToolName
} from "@chengxiaobang/shared";
import { mkdir } from "node:fs/promises";
import type { StateStore } from "../repository/state-store";
import type { SecretStore } from "../secrets/secret-store";
import type { ModelClient, ModelMessage } from "../model/openai-compatible";
import { ApprovalQueue } from "./approval-queue";
import { parseToolRequest, requiresApproval, ToolExecutor } from "../tools/tool-executor";
import { TOOL_DEFINITIONS } from "../tools/tool-schemas";
import { SlashCommandService } from "../tools/slash-command-service";
import { buildCompactionRequest, buildHistory, buildSystemPrompt } from "./agent-context";
import { defaultSessionDir } from "../paths";

const MAX_TOOL_ITERATIONS = 25;
/** /compact keeps this many most-recent messages out of the summary. */
const COMPACT_KEEP_RECENT = 4;

export class AgentRunner {
  readonly approvals = new ApprovalQueue();
  private readonly abortControllers = new Map<string, AbortController>();

  constructor(
    private readonly store: StateStore,
    private readonly secrets: SecretStore,
    private readonly modelClient: ModelClient,
    private readonly toolExecutor = new ToolExecutor(),
    private readonly sessionWorkspacePath = defaultSessionDir,
    private readonly slashCommandService = new SlashCommandService()
  ) {}

  abort(runId: string): boolean {
    const controller = this.abortControllers.get(runId);
    if (!controller) {
      return false;
    }
    controller.abort();
    this.abortControllers.delete(runId);
    return true;
  }

  async *stream(input: RunRequest): AsyncGenerator<StreamEvent> {
    const controller = new AbortController();
    const selectedProvider = input.providerId
      ? await this.store.getProvider(input.providerId)
      : (await this.store.listProviders()).find((provider) => provider.apiKeyRef);
    if (!selectedProvider) {
      throw new Error("请先配置至少一个模型");
    }
    const selectedApiKey = selectedProvider.apiKeyRef
      ? await this.secrets.getSecret(selectedProvider.apiKeyRef)
      : undefined;
    if (!selectedApiKey) {
      throw new Error("请先配置至少一个带 API Key 的模型");
    }
    const session = input.sessionId
      ? await this.store.getSession(input.sessionId)
      : await this.store.createSession({
          projectId: input.projectId ?? null,
          title: createTitle(input.prompt),
          providerId: selectedProvider.id,
          accessMode: input.accessMode
        });
    if (!session) {
      throw new Error("会话不存在");
    }
    const activeSession = input.sessionId
      ? await this.store.updateSession(session.id, {
          providerId: selectedProvider.id,
          accessMode: input.accessMode
        })
      : session;
    const project = activeSession.projectId
      ? await this.store.getProject(activeSession.projectId)
      : undefined;
    const expandedPrompt = (await this.slashCommandService.expandPrompt(input.prompt, project))
      .prompt;
    const workspacePath = project?.path ?? this.sessionWorkspacePath(activeSession.id);

    // /compact is a meta command about the conversation itself: it never
    // persists a user message and runs its own summarize-only model call.
    if (expandedPrompt.trim() === "/compact") {
      yield* this.runCompaction(activeSession, selectedProvider, selectedApiKey, controller);
      return;
    }

    const runId = createId("run");
    this.abortControllers.set(runId, controller);
    await this.store.createRun({ id: runId, sessionId: activeSession.id, status: "running" });
    const userMessage = await this.store.addMessage({
      sessionId: activeSession.id,
      role: "user",
      content: expandedPrompt
    });
    yield { type: "run_started", runId, sessionId: activeSession.id };
    yield { type: "user_message", runId, message: userMessage };

    try {
      if (!project) {
        await mkdir(workspacePath, { recursive: true });
      }

      // Direct slash-command fast path: run exactly one builtin tool before the
      // model loop, preserving deterministic single-tool semantics.
      const directRequest = parseToolRequest(expandedPrompt);
      if (directRequest) {
        const outcome = yield* this.runDirectTool(
          runId,
          activeSession.id,
          directRequest,
          workspacePath,
          input.accessMode,
          controller
        );
        if (outcome === "aborted" || outcome === "failed") {
          await this.store.updateRunStatus(runId, outcome === "aborted" ? "aborted" : "failed");
          return;
        }
      }

      yield* this.runAgentLoop(
        runId,
        activeSession.id,
        {
          provider: selectedProvider,
          apiKey: selectedApiKey,
          workspacePath,
          accessMode: input.accessMode,
          projectName: project?.name,
          compactedUpToMessageId: activeSession.compactedUpToMessageId
        },
        controller
      );
    } catch (error) {
      await this.store.updateRunStatus(runId, "failed");
      yield {
        type: "run_error",
        runId,
        error: error instanceof Error ? error.message : String(error)
      };
    } finally {
      this.abortControllers.delete(runId);
    }
  }

  /**
   * Summarize older history into a compaction summary message and move the
   * session's compaction pointer, so future runs send [summary + recent
   * messages] instead of the full history.
   */
  private async *runCompaction(
    session: Session,
    provider: ProviderConfig,
    apiKey: string,
    controller: AbortController
  ): AsyncGenerator<StreamEvent> {
    const runId = createId("run");
    this.abortControllers.set(runId, controller);
    await this.store.createRun({ id: runId, sessionId: session.id, status: "running" });
    yield { type: "run_started", runId, sessionId: session.id };
    try {
      const messages = await this.store.listMessages(session.id);
      const cutoffIndex = session.compactedUpToMessageId
        ? messages.findIndex((message) => message.id === session.compactedUpToMessageId)
        : -1;
      const visible = messages.filter(
        (message, index) => index > cutoffIndex && message.kind !== "compaction_summary"
      );
      const toSummarize = visible.slice(0, Math.max(0, visible.length - COMPACT_KEEP_RECENT));

      if (toSummarize.length === 0) {
        const notice = await this.store.addMessage({
          sessionId: session.id,
          role: "assistant",
          content: "当前对话内容较少，无需压缩。"
        });
        yield { type: "assistant_done", runId, message: notice };
        await this.store.updateRunStatus(runId, "completed");
        yield { type: "run_completed", runId };
        return;
      }

      // Fold the previous summary (if any) into the new one so repeated
      // /compact never loses earlier context.
      const summaryRows = messages.filter(
        (message) => message.kind === "compaction_summary"
      );
      const foldHistory = buildHistory([...summaryRows, ...toSummarize]);

      let summaryText = "";
      let usage: TokenUsage | undefined;
      for await (const delta of this.modelClient.streamCompletion({
        provider,
        apiKey,
        messages: buildCompactionRequest(foldHistory),
        signal: controller.signal
      })) {
        if (controller.signal.aborted) {
          break;
        }
        if (delta.type === "text" || delta.type === "thinking") {
          if (delta.type === "text") {
            summaryText += delta.delta;
          }
          // Streamed as thinking so the renderer shows live progress in the
          // reasoning panel without treating it as a chat answer.
          yield { type: "thinking_delta", runId, delta: delta.delta };
        } else if (delta.type === "usage") {
          usage = delta.usage;
        }
      }

      if (controller.signal.aborted || summaryText.trim().length === 0) {
        await this.store.updateRunStatus(runId, "aborted");
        yield { type: "run_aborted", runId };
        return;
      }

      const summaryMessage = await this.store.addMessage({
        sessionId: session.id,
        role: "assistant",
        kind: "compaction_summary",
        content: summaryText.trim()
      });
      await this.store.updateSession(session.id, {
        compactedUpToMessageId: toSummarize[toSummarize.length - 1].id
      });
      yield { type: "assistant_done", runId, message: summaryMessage };
      await this.store.updateRunStatus(runId, "completed");
      yield { type: "run_completed", runId, usage };
    } catch (error) {
      await this.store.updateRunStatus(runId, "failed");
      yield {
        type: "run_error",
        runId,
        error: error instanceof Error ? error.message : String(error)
      };
    } finally {
      this.abortControllers.delete(runId);
    }
  }

  /** Execute a single builtin tool parsed directly from a slash command. */
  private async *runDirectTool(
    runId: string,
    sessionId: string,
    request: { name: ToolName; args: Record<string, unknown> },
    workspacePath: string,
    accessMode: RunRequest["accessMode"],
    controller: AbortController
  ): AsyncGenerator<StreamEvent, "ok" | "aborted" | "failed"> {
    yield { type: "thinking_delta", runId, delta: "正在准备本地工具调用...\n" };
    const needsApproval = requiresApproval(request.name) && accessMode === "approval";
    const initial: ToolCall = {
      id: createId("tool"),
      runId,
      name: request.name,
      args: request.args,
      status: needsApproval ? "pending_approval" : "running",
      // startedAt marks actual execution start, so approval wait is excluded.
      ...(needsApproval ? {} : { startedAt: nowIso() }),
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    await this.store.insertToolCall(initial);

    let runnable = initial;
    if (initial.status === "pending_approval") {
      yield { type: "tool_call_pending", runId, toolCall: initial };
      const approved = await this.approvals.wait(initial.id, controller.signal);
      if (!approved) {
        const rejected = await this.store.updateToolCall({
          ...initial,
          status: "rejected",
          result: "用户拒绝或运行已中止",
          updatedAt: nowIso()
        });
        yield { type: "tool_result", runId, toolCall: rejected };
        yield { type: "run_aborted", runId };
        return "aborted";
      }
      runnable = await this.store.updateToolCall({
        ...initial,
        status: "running",
        startedAt: nowIso(),
        updatedAt: nowIso()
      });
    }

    yield { type: "tool_call_started", runId, toolCall: runnable };
    let completed: ToolCall;
    try {
      completed = await this.toolExecutor.execute(runnable, workspacePath);
    } catch (error) {
      completed = {
        ...runnable,
        status: "failed",
        result: error instanceof Error ? error.message : String(error),
        updatedAt: nowIso()
      };
    }
    await this.store.updateToolCall(completed);
    yield { type: "tool_result", runId, toolCall: completed };
    if (completed.status === "failed") {
      yield { type: "run_error", runId, error: completed.result ?? "工具调用失败" };
      return "failed";
    }
    await this.store.addMessage({
      sessionId,
      role: "tool",
      content: completed.result ?? ""
    });
    return "ok";
  }

  /** The core multi-turn agentic loop: model → tools → model → ... → answer. */
  private async *runAgentLoop(
    runId: string,
    sessionId: string,
    context: {
      provider: ProviderConfig;
      apiKey: string;
      workspacePath: string;
      accessMode: RunRequest["accessMode"];
      projectName?: string;
      compactedUpToMessageId?: string;
    },
    controller: AbortController
  ): AsyncGenerator<StreamEvent> {
    const persisted = await this.store.listMessages(sessionId);
    const modelMessages: ModelMessage[] = [
      {
        role: "system",
        content: buildSystemPrompt({
          workspacePath: context.workspacePath,
          accessMode: context.accessMode,
          projectName: context.projectName
        })
      },
      ...buildHistory(persisted, context.compactedUpToMessageId)
    ];

    let usage: TokenUsage | undefined;
    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration += 1) {
      if (controller.signal.aborted) {
        yield { type: "run_aborted", runId };
        await this.store.updateRunStatus(runId, "aborted");
        return;
      }

      const turnStartedAt = Date.now();
      let assistantText = "";
      let reasoningText = "";
      let reasoningStartedAt: number | undefined;
      let toolCalls: AssistantToolCall[] = [];
      for await (const delta of this.modelClient.streamCompletion({
        provider: context.provider,
        apiKey: context.apiKey,
        messages: modelMessages,
        tools: TOOL_DEFINITIONS,
        signal: controller.signal
      })) {
        if (controller.signal.aborted) {
          yield { type: "run_aborted", runId };
          await this.store.updateRunStatus(runId, "aborted");
          return;
        }
        if (delta.type === "thinking") {
          if (reasoningStartedAt === undefined) {
            reasoningStartedAt = Date.now();
          }
          reasoningText += delta.delta;
          yield { type: "thinking_delta", runId, delta: delta.delta };
        } else if (delta.type === "text") {
          assistantText += delta.delta;
          yield { type: "assistant_delta", runId, delta: delta.delta };
        } else if (delta.type === "tool_calls") {
          toolCalls = delta.toolCalls;
        } else if (delta.type === "usage") {
          usage = delta.usage;
        }
      }

      // Reasoning the model streamed this turn, to persist alongside its message.
      const reasoningPayload = reasoningText
        ? {
            reasoning: reasoningText,
            reasoningMs: reasoningStartedAt !== undefined ? Date.now() - reasoningStartedAt : 0
          }
        : undefined;

      if (toolCalls.length === 0) {
        const message = await this.store.addMessage({
          sessionId,
          role: "assistant",
          content: assistantText,
          durationMs: Date.now() - turnStartedAt,
          ...(reasoningPayload ?? {})
        });
        yield { type: "assistant_done", runId, message };
        await this.store.updateRunStatus(runId, "completed");
        yield { type: "run_completed", runId, usage };
        return;
      }

      // Surface any interim reasoning text the model produced alongside its tools.
      if (assistantText.trim().length > 0) {
        const message = await this.store.addMessage({
          sessionId,
          role: "assistant",
          content: assistantText,
          durationMs: Date.now() - turnStartedAt,
          ...(reasoningPayload ?? {})
        });
        yield { type: "assistant_done", runId, message };
      }
      modelMessages.push({ role: "assistant", content: assistantText, toolCalls });

      for (const call of toolCalls) {
        const toolResult = yield* this.runModelTool(
          runId,
          sessionId,
          call,
          context.workspacePath,
          context.accessMode,
          controller
        );
        modelMessages.push({
          role: "tool",
          content: toolResult,
          toolCallId: call.id
        });
      }
    }

    await this.store.updateRunStatus(runId, "failed");
    yield {
      type: "run_error",
      runId,
      error: `已达到最大工具调用轮数（${MAX_TOOL_ITERATIONS}），任务可能过于复杂，请拆分后重试。`
    };
  }

  /**
   * Execute one model-requested tool. Failures and rejections are fed back to the
   * model as the tool result so the agent can recover, rather than aborting the run.
   */
  private async *runModelTool(
    runId: string,
    sessionId: string,
    call: AssistantToolCall,
    workspacePath: string,
    accessMode: RunRequest["accessMode"],
    controller: AbortController
  ): AsyncGenerator<StreamEvent, string> {
    const parsedName = toolNameSchema.safeParse(call.name);
    const args = parseToolArgs(call.arguments);
    const baseToolCall: ToolCall = {
      id: call.id,
      runId,
      name: parsedName.success ? parsedName.data : "shell",
      args,
      status: "running",
      createdAt: nowIso(),
      updatedAt: nowIso()
    };

    if (!parsedName.success) {
      const failed: ToolCall = {
        ...baseToolCall,
        status: "failed",
        result: `未知工具: ${call.name}`,
        updatedAt: nowIso()
      };
      await this.store.insertToolCall(failed);
      yield { type: "tool_result", runId, toolCall: failed };
      await this.store.addMessage({ sessionId, role: "tool", content: failed.result ?? "" });
      return failed.result ?? "未知工具";
    }

    const needsApproval = requiresApproval(baseToolCall.name) && accessMode === "approval";
    const initial: ToolCall = {
      ...baseToolCall,
      status: needsApproval ? "pending_approval" : "running",
      // startedAt marks actual execution start, so approval wait is excluded.
      ...(needsApproval ? {} : { startedAt: nowIso() })
    };
    await this.store.insertToolCall(initial);

    let runnable = initial;
    if (initial.status === "pending_approval") {
      yield { type: "tool_call_pending", runId, toolCall: initial };
      const approved = await this.approvals.wait(initial.id, controller.signal);
      if (!approved) {
        const rejected = await this.store.updateToolCall({
          ...initial,
          status: "rejected",
          result: "用户拒绝执行该操作",
          updatedAt: nowIso()
        });
        yield { type: "tool_result", runId, toolCall: rejected };
        await this.store.addMessage({ sessionId, role: "tool", content: rejected.result ?? "" });
        return "用户拒绝执行该操作。请考虑其他方式或向用户说明。";
      }
      runnable = await this.store.updateToolCall({
        ...initial,
        status: "running",
        startedAt: nowIso(),
        updatedAt: nowIso()
      });
    }

    yield { type: "tool_call_started", runId, toolCall: runnable };
    let completed: ToolCall;
    try {
      completed = await this.toolExecutor.execute(runnable, workspacePath);
    } catch (error) {
      completed = {
        ...runnable,
        status: "failed",
        result: error instanceof Error ? error.message : String(error),
        updatedAt: nowIso()
      };
    }
    await this.store.updateToolCall(completed);
    yield { type: "tool_result", runId, toolCall: completed };
    const resultText = completed.result ?? "";
    await this.store.addMessage({
      sessionId,
      role: "tool",
      content: resultText
    });
    return completed.status === "failed" ? `工具执行失败: ${resultText}` : resultText;
  }
}

function parseToolArgs(raw: string): Record<string, unknown> {
  if (!raw.trim()) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function createTitle(prompt: string): string {
  const compact = prompt.trim().replace(/\s+/g, " ");
  return compact.length > 24 ? `${compact.slice(0, 24)}...` : compact || "新对话";
}
