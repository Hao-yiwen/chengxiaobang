import { mkdir } from "node:fs/promises";
import { runAgentLoopContinue, type AgentTool, type StreamFn } from "@earendil-works/pi-agent-core";
import type { Message as PiMessage } from "@earendil-works/pi-ai";
import {
  createId,
  nowIso,
  type RunRequest,
  type StreamEvent,
  type ToolCall
} from "@chengxiaobang/shared";
import type { StateStore } from "../repository/state-store";
import type { SecretStore } from "../secrets/secret-store";
import { buildModel } from "../model/pi-model";
import { createAgentTools, findTool, requiresApproval } from "../tools/registry";
import { parseToolRequest, type ToolRequest } from "../tools/direct-commands";
import { SlashCommandService } from "../tools/slash-command-service";
import { defaultSessionDir } from "../paths";
import { ApprovalQueue } from "./approval-queue";
import { AsyncEventQueue } from "./async-queue";
import { buildAgentMessages } from "./history";
import { RunEventTranslator } from "./pi-events";
import { buildSystemPrompt } from "./system-prompt";
import { runCompaction } from "./compaction";

export interface AgentRunnerOptions {
  /** Builds the tool set for a workspace; defaults to the builtin registry. */
  createTools?: (workspacePath: string) => AgentTool<any>[];
  /** Workspace dir for standalone (project-less) sessions. */
  sessionWorkspacePath?: (sessionId: string) => string;
  slashCommandService?: SlashCommandService;
  /** Model stream override — the test seam replacing live provider calls. */
  streamFn?: StreamFn;
}

export class AgentRunner {
  readonly approvals = new ApprovalQueue();
  private readonly abortControllers = new Map<string, AbortController>();
  private readonly createTools: (workspacePath: string) => AgentTool<any>[];
  private readonly sessionWorkspacePath: (sessionId: string) => string;
  private readonly slashCommandService: SlashCommandService;
  private readonly streamFn?: StreamFn;

  constructor(
    private readonly store: StateStore,
    private readonly secrets: SecretStore,
    options: AgentRunnerOptions = {}
  ) {
    this.createTools = options.createTools ?? ((workspacePath) => createAgentTools(workspacePath));
    this.sessionWorkspacePath = options.sessionWorkspacePath ?? defaultSessionDir;
    this.slashCommandService = options.slashCommandService ?? new SlashCommandService();
    this.streamFn = options.streamFn;
  }

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
    const provider = input.providerId
      ? await this.store.getProvider(input.providerId)
      : (await this.store.listProviders()).find((candidate) => candidate.apiKeyRef);
    if (!provider) {
      throw new Error("请先配置至少一个模型");
    }
    const apiKey = provider.apiKeyRef
      ? await this.secrets.getSecret(provider.apiKeyRef)
      : undefined;
    if (!apiKey) {
      throw new Error("请先配置至少一个带 API Key 的模型");
    }
    const session = input.sessionId
      ? await this.store.getSession(input.sessionId)
      : await this.store.createSession({
          projectId: input.projectId ?? null,
          title: createTitle(input.prompt),
          providerId: provider.id,
          accessMode: input.accessMode
        });
    if (!session) {
      throw new Error("会话不存在");
    }
    const activeSession = input.sessionId
      ? await this.store.updateSession(session.id, {
          providerId: provider.id,
          accessMode: input.accessMode
        })
      : session;
    const project = activeSession.projectId
      ? await this.store.getProject(activeSession.projectId)
      : undefined;
    const expandedPrompt = (await this.slashCommandService.expandPrompt(input.prompt, project))
      .prompt;
    const workspacePath = project?.path ?? this.sessionWorkspacePath(activeSession.id);

    const runId = createId("run");
    this.abortControllers.set(runId, controller);
    try {
      // /compact is a meta command about the conversation itself: it never
      // persists a user message and runs its own summarize-only model call.
      if (expandedPrompt.trim() === "/compact") {
        await this.store.createRun({ id: runId, sessionId: activeSession.id, status: "running" });
        yield* runCompaction({
          store: this.store,
          session: activeSession,
          provider,
          apiKey,
          runId,
          signal: controller.signal,
          streamFn: this.streamFn
        });
        return;
      }

      await this.store.createRun({ id: runId, sessionId: activeSession.id, status: "running" });
      const userMessage = await this.store.addMessage({
        sessionId: activeSession.id,
        role: "user",
        content: expandedPrompt
      });
      yield { type: "run_started", runId, sessionId: activeSession.id };
      yield { type: "message", runId, message: userMessage };

      if (!project) {
        await mkdir(workspacePath, { recursive: true });
      }
      const tools = this.createTools(workspacePath);

      // Direct slash-command fast path: run exactly one builtin tool before the
      // model loop, preserving deterministic single-tool semantics.
      const directRequest = parseToolRequest(expandedPrompt);
      if (directRequest) {
        const outcome = yield* this.runDirectTool(
          runId,
          activeSession.id,
          directRequest,
          tools,
          input.accessMode,
          controller
        );
        if (outcome !== "ok") {
          return;
        }
      }

      yield* this.runPiLoop({
        runId,
        sessionId: activeSession.id,
        tools,
        provider,
        apiKey,
        accessMode: input.accessMode,
        systemPrompt: buildSystemPrompt({
          workspacePath,
          accessMode: input.accessMode,
          projectName: project?.name,
          viaFeishu: Boolean(activeSession.feishuChatId)
        }),
        compactedUpToMessageId: activeSession.compactedUpToMessageId,
        controller
      });
    } finally {
      this.abortControllers.delete(runId);
    }
  }

  /** Drive the pi agent loop, yielding translated StreamEvents as they arrive. */
  private async *runPiLoop(options: {
    runId: string;
    sessionId: string;
    tools: AgentTool<any>[];
    provider: Parameters<typeof buildModel>[0];
    apiKey: string;
    accessMode: RunRequest["accessMode"];
    systemPrompt: string;
    compactedUpToMessageId?: string;
    controller: AbortController;
  }): AsyncGenerator<StreamEvent> {
    const queue = new AsyncEventQueue<StreamEvent>();
    const translator = new RunEventTranslator({
      store: this.store,
      queue,
      approvals: this.approvals,
      runId: options.runId,
      sessionId: options.sessionId,
      accessMode: options.accessMode,
      signal: options.controller.signal
    });

    const rows = await this.store.listMessages(options.sessionId);
    const context = {
      systemPrompt: options.systemPrompt,
      messages: buildAgentMessages(rows, options.compactedUpToMessageId),
      tools: options.tools
    };

    void runAgentLoopContinue(
      context,
      {
        model: buildModel(options.provider),
        apiKey: options.apiKey,
        // History rows already round-trip as real pi messages (see history.ts),
        // so the LLM conversion is the identity.
        convertToLlm: (messages) => messages as PiMessage[],
        toolExecution: "sequential",
        beforeToolCall: translator.beforeToolCall,
        shouldStopAfterTurn: translator.shouldStopAfterTurn
      },
      translator.emit,
      options.controller.signal,
      this.streamFn
    )
      .then(() => queue.end())
      .catch(async (error) => {
        // pi reports model errors via stopReason, so a rejection here is an
        // infrastructure failure (persistence, contract misuse) — close the
        // run instead of leaving it hanging as "running".
        if (!translator.finished) {
          try {
            await translator.finish(
              options.controller.signal.aborted
                ? { status: "aborted" }
                : {
                    status: "failed",
                    error: error instanceof Error ? error.message : String(error)
                  }
            );
          } catch {
            queue.fail(error);
            return;
          }
        }
        console.error("[agent-runner] 运行失败:", error);
        queue.end();
      });

    yield* queue;
  }

  /** Execute a single builtin tool parsed directly from a slash command. */
  private async *runDirectTool(
    runId: string,
    sessionId: string,
    request: ToolRequest,
    tools: AgentTool<any>[],
    accessMode: RunRequest["accessMode"],
    controller: AbortController
  ): AsyncGenerator<StreamEvent, "ok" | "aborted" | "failed"> {
    yield { type: "delta", runId, channel: "thinking", delta: "正在准备本地工具调用...\n" };
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
    yield { type: "tool_call", runId, toolCall: initial };

    let runnable = initial;
    if (initial.status === "pending_approval") {
      const approved = await this.approvals.wait(initial.id, controller.signal);
      if (!approved) {
        const rejected = await this.store.updateToolCall({
          ...initial,
          status: "rejected",
          result: "用户拒绝或运行已中止",
          updatedAt: nowIso()
        });
        yield { type: "tool_call", runId, toolCall: rejected };
        await this.store.updateRunStatus(runId, "aborted");
        yield { type: "run_end", runId, status: "aborted" };
        return "aborted";
      }
      runnable = await this.store.updateToolCall({
        ...initial,
        status: "running",
        startedAt: nowIso(),
        updatedAt: nowIso()
      });
      yield { type: "tool_call", runId, toolCall: runnable };
    }

    const tool = findTool(tools, request.name);
    let completed: ToolCall;
    try {
      if (!tool) {
        throw new Error(`未知工具: ${request.name}`);
      }
      const result = await tool.execute(runnable.id, request.args, controller.signal);
      completed = {
        ...runnable,
        status: "completed",
        result: result.content
          .filter((block): block is { type: "text"; text: string } => block.type === "text")
          .map((block) => block.text)
          .join("\n"),
        updatedAt: nowIso()
      };
    } catch (error) {
      completed = {
        ...runnable,
        status: "failed",
        result: error instanceof Error ? error.message : String(error),
        updatedAt: nowIso()
      };
    }
    await this.store.updateToolCall(completed);
    yield { type: "tool_call", runId, toolCall: completed };
    if (completed.status === "failed") {
      await this.store.updateRunStatus(runId, "failed");
      yield { type: "run_end", runId, status: "failed", error: completed.result ?? "工具调用失败" };
      return "failed";
    }
    // Persisted payload-less on purpose: an orphan toolResult with no paired
    // assistant toolCall would be rejected by providers, so history replays
    // direct results as plain user context.
    await this.store.addMessage({
      sessionId,
      role: "tool",
      content: completed.result ?? ""
    });
    return "ok";
  }
}

function createTitle(prompt: string): string {
  const compact = prompt.trim().replace(/\s+/g, " ");
  return compact.length > 24 ? `${compact.slice(0, 24)}...` : compact || "新对话";
}
