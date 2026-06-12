import { mkdir } from "node:fs/promises";
import { runAgentLoopContinue, type AgentTool, type StreamFn } from "@earendil-works/pi-agent-core";
import { formatSkillInvocation } from "@earendil-works/pi-agent-core/node";
import { streamSimple, type Message as PiMessage } from "@earendil-works/pi-ai";
import {
  createId,
  derivePlanState,
  nowIso,
  type AgentDebugTool,
  type AskUserAnswer,
  type Message,
  type ProposePlanArgs,
  type Project,
  type ProviderConfig,
  type RunRequest,
  type SessionDebugContext,
  type StreamEvent,
  type ToolCall
} from "@chengxiaobang/shared";
import type { StateStore } from "../repository/state-store";
import type { SecretStore } from "../secrets/secret-store";
import { buildModel, buildModelStreamOptions } from "../model/pi-model";
import {
  createAgentTools,
  findTool,
  requiresApproval,
  selectAgentTools,
  type PlanPhase
} from "../tools/registry";
import { parseToolRequest, type ToolRequest } from "../tools/direct-commands";
import { createPlanTools } from "../tools/plan-tools";
import { createScheduleTools } from "../tools/schedule-tools";
import { SlashCommandService } from "../tools/slash-command-service";
import { defaultSessionDir } from "../paths";
import { ApprovalQueue, normalizeDecision } from "./approval-queue";
import { AsyncEventQueue } from "./async-queue";
import { buildAgentMessages } from "./history";
import { RunEventTranslator } from "./pi-events";
import { buildSystemPrompt } from "./system-prompt";
import { runCompaction } from "./compaction";
import { generateSessionTitle, normalizeTitle } from "./session-title";

const MAX_SKILL_RESULT_CHARS = 32 * 1024;

/**
 * 会话标题尚未生成时的占位标题；标题模型失败时会落用户首句兜底标题，
 * 避免侧栏一直显示占位文案。
 */
export const DEFAULT_SESSION_TITLE = "新对话";

/** Upper bound on the title model call, so it can never hold the stream open. */
const TITLE_TIMEOUT_MS = 15_000;

export interface AgentRunnerOptions {
  /** Builds the tool set for a workspace; defaults to the builtin registry. */
  createTools?: (workspacePath: string) => AgentTool<any>[];
  /** Workspace dir for standalone (project-less) sessions. */
  sessionWorkspacePath?: (sessionId: string) => string;
  slashCommandService?: SlashCommandService;
  /** Model stream override — the test seam replacing live provider calls. */
  streamFn?: StreamFn;
  /**
   * Model stream for AI session-title generation. Defaults to the live
   * provider call; when streamFn (the test seam) is set without this, AI
   * titles are skipped so scripted runs stay deterministic.
   */
  titleStreamFn?: StreamFn;
}

export class AgentRunner {
  readonly approvals = new ApprovalQueue();
  /** 正在执行 run 的会话；调度器据此避让，免得与手动 run 在同一会话交错写入。 */
  readonly activeSessionIds = new Set<string>();
  private readonly abortControllers = new Map<string, AbortController>();
  private readonly createTools: (workspacePath: string) => AgentTool<any>[];
  private readonly sessionWorkspacePath: (sessionId: string) => string;
  private readonly slashCommandService: SlashCommandService;
  private readonly streamFn?: StreamFn;
  private readonly titleStreamFn?: StreamFn;

  constructor(
    private readonly store: StateStore,
    private readonly secrets: SecretStore,
    options: AgentRunnerOptions = {}
  ) {
    this.createTools = options.createTools ?? ((workspacePath) => createAgentTools(workspacePath));
    this.sessionWorkspacePath = options.sessionWorkspacePath ?? defaultSessionDir;
    this.slashCommandService = options.slashCommandService ?? new SlashCommandService();
    this.streamFn = options.streamFn;
    this.titleStreamFn = options.titleStreamFn ?? (options.streamFn ? undefined : streamSimple);
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

  /** 构造调试面板使用的只读上下文快照，不启动模型、不写入会话。 */
  async buildSessionDebugContext(
    sessionId: string,
    options: { planMode?: boolean } = {}
  ): Promise<SessionDebugContext | undefined> {
    const session = await this.store.getSession(sessionId);
    if (!session) {
      console.warn(`[agent-runner] Debug 上下文请求的会话不存在 sessionId=${sessionId}`);
      return undefined;
    }
    const project = session.projectId ? await this.store.getProject(session.projectId) : undefined;
    const workspacePath = project?.path ?? this.sessionWorkspacePath(session.id);
    const [rows, runs, toolCalls, skills] = await Promise.all([
      this.store.listMessages(session.id),
      this.store.listRuns(session.id),
      this.store.listToolCallsForSession(session.id),
      this.slashCommandService.listSkills(project)
    ]);
    const planMode = options.planMode ?? false;
    const planSnapshot = derivePlanState(toolCalls);
    const viaFeishu = Boolean(session.feishuChatId);
    const planPhase: PlanPhase = planMode
      ? planSnapshot?.confirmed && !planSnapshot.finished
        ? "execute"
        : "draft"
      : "none";
    const tools = [
      ...this.createTools(workspacePath),
      ...createPlanTools({
        getApprovedPlanArgs: () => undefined,
        getAskUserAnswer: () => undefined,
        loadSkill: async (name) => this.loadSkillContent(name, project)
      }),
      ...createScheduleTools({
        store: this.store,
        sessionId: session.id,
        ...(session.feishuChatId ? { feishuChatId: session.feishuChatId } : {})
      })
    ];
    const availableTools = selectAgentTools(tools, {
      planPhase,
      viaFeishu,
      headless: false
    }).map(toAgentDebugTool);
    const systemPrompt = buildSystemPrompt({
      workspacePath,
      accessMode: session.accessMode,
      projectName: project?.name,
      viaFeishu,
      headless: false,
      planMode,
      ...(planMode && planSnapshot ? { planSnapshot } : {}),
      skills
    });

    console.info(
      `[agent-runner] 已构造 Debug 上下文 sessionId=${session.id} messages=${rows.length} tools=${availableTools.length} planMode=${planMode}`
    );
    return {
      session,
      project: project ?? null,
      workspacePath,
      accessMode: session.accessMode,
      planMode,
      viaFeishu,
      ...(session.compactedUpToMessageId
        ? { compactedUpToMessageId: session.compactedUpToMessageId }
        : {}),
      systemPrompt,
      modelMessages: buildAgentMessages(rows, session.compactedUpToMessageId),
      messages: rows.map(toClientMessage),
      runs,
      toolCalls,
      ...(planSnapshot ? { planSnapshot } : {}),
      skills,
      availableTools,
      generatedAt: nowIso()
    };
  }

  async *stream(
    input: RunRequest,
    // 进程内专用（调度器等），刻意不进 shared 的 runRequestSchema 暴露到 API 面。
    internal: { headless?: boolean } = {}
  ): AsyncGenerator<StreamEvent> {
    const controller = new AbortController();
    const planMode = input.planMode ?? false;
    const headless = internal.headless ?? false;
    const selectedProvider = input.providerId
      ? await this.store.getProvider(input.providerId)
      : (await this.store.listProviders()).find((candidate) => candidate.apiKeyRef);
    if (!selectedProvider) {
      throw new Error("请先配置至少一个模型");
    }
    const apiKey = selectedProvider.apiKeyRef
      ? await this.secrets.getSecret(selectedProvider.apiKeyRef)
      : undefined;
    if (!apiKey) {
      throw new Error("请先配置至少一个带 API Key 的模型");
    }
    const session = input.sessionId
      ? await this.store.getSession(input.sessionId)
      : await this.store.createSession({
          projectId: input.projectId ?? null,
          title: DEFAULT_SESSION_TITLE,
          providerId: selectedProvider.id,
          accessMode: input.accessMode,
          ...(input.model ? { model: input.model } : {}),
          ...(input.reasoningMode ? { reasoningMode: input.reasoningMode } : {})
        });
    if (!session) {
      throw new Error("会话不存在");
    }
    const effectiveModel = input.model ?? session.model ?? selectedProvider.model;
    const effectiveReasoningMode =
      input.reasoningMode ?? session.reasoningMode ?? selectedProvider.reasoningMode;
    const provider: ProviderConfig = {
      ...selectedProvider,
      model: effectiveModel,
      ...(effectiveReasoningMode ? { reasoningMode: effectiveReasoningMode } : {})
    };
    console.info(
      `[agent-runner] 使用模型 providerId=${selectedProvider.id} model=${effectiveModel} modelSource=${
        input.model ? "run" : session.model ? "session" : "provider"
      } reasoningMode=${effectiveReasoningMode ?? "default"} reasoningSource=${
        input.reasoningMode ? "run" : session.reasoningMode ? "session" : selectedProvider.reasoningMode ? "provider" : "default"
      }`
    );
    // headless（定时任务）执行不得污染会话设置：providerId/accessMode 等
    // 只属于这一次 run，不写回会话。
    const activeSession =
      input.sessionId && !headless
        ? await this.store.updateSession(session.id, {
            providerId: selectedProvider.id,
            accessMode: input.accessMode,
            ...(input.model !== undefined ? { model: input.model } : {}),
            ...(input.reasoningMode !== undefined ? { reasoningMode: input.reasoningMode } : {})
          })
        : session;
    const project = activeSession.projectId
      ? await this.store.getProject(activeSession.projectId)
      : undefined;
    const expandedPrompt = (await this.slashCommandService.expandPrompt(input.prompt, project))
      .prompt;
    const workspacePath = project?.path ?? this.sessionWorkspacePath(activeSession.id);

    const runId = createId("run");
    // Created here (not in runPiLoop) so the concurrent title task can push
    // its session_updated event into the same stream mid-run.
    const queue = new AsyncEventQueue<StreamEvent>();

    // AI title for sessions still on the placeholder: runs concurrently with
    // the agent loop, pushes session_updated as soon as the title is saved,
    // and is also awaited before the stream closes so the renderer's post-run
    // session refresh is guaranteed to see it.
    let titleTask: Promise<void> | undefined;
    if (this.titleStreamFn && activeSession.title === DEFAULT_SESSION_TITLE) {
      const titlePrompt = input.sessionId
        ? ((await this.firstUserMessageContent(activeSession.id)) ?? expandedPrompt)
        : expandedPrompt;
      titleTask = this.generateAndSaveTitle({
        runId,
        sessionId: activeSession.id,
        prompt: titlePrompt,
        provider,
        apiKey,
        streamFn: this.titleStreamFn,
        emit: (event) => queue.push(event)
      });
    }

    this.abortControllers.set(runId, controller);
    this.activeSessionIds.add(activeSession.id);
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
      yield {
        type: "run_started",
        runId,
        sessionId: activeSession.id,
        providerId: selectedProvider.id,
        model: effectiveModel,
        ...(effectiveReasoningMode ? { reasoningMode: effectiveReasoningMode } : {})
      };
      yield { type: "message", runId, message: userMessage };

      if (!project) {
        console.info(
          `[agent-runner] 为独立会话准备工作目录 sessionId=${activeSession.id} path=${workspacePath}`
        );
        await mkdir(workspacePath, { recursive: true });
      }
      const approvedPlans = new Map<string, ProposePlanArgs>();
      const askUserAnswers = new Map<string, AskUserAnswer>();
      const skills = await this.slashCommandService.listSkills(project);
      const tools = [
        ...this.createTools(workspacePath),
        ...createPlanTools({
          getApprovedPlanArgs: (toolCallId) => approvedPlans.get(toolCallId),
          getAskUserAnswer: (toolCallId) => askUserAnswers.get(toolCallId),
          loadSkill: async (name) => this.loadSkillContent(name, project)
        }),
        ...createScheduleTools({
          store: this.store,
          sessionId: activeSession.id,
          ...(activeSession.feishuChatId ? { feishuChatId: activeSession.feishuChatId } : {})
        })
      ];
      const planSnapshot = planMode
        ? derivePlanState(await this.store.listToolCallsForSession(activeSession.id))
        : undefined;
      const initialPlanConfirmed = Boolean(planSnapshot?.confirmed && !planSnapshot.finished);

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
        queue,
        tools,
        approvedPlans,
        askUserAnswers,
        provider,
        apiKey,
        accessMode: input.accessMode,
        planMode,
        initialPlanConfirmed,
        viaFeishu: Boolean(activeSession.feishuChatId),
        headless,
        systemPrompt: buildSystemPrompt({
          workspacePath,
          accessMode: input.accessMode,
          projectName: project?.name,
          viaFeishu: Boolean(activeSession.feishuChatId),
          headless,
          planMode,
          planSnapshot,
          skills
        }),
        compactedUpToMessageId: activeSession.compactedUpToMessageId,
        controller
      });
    } finally {
      this.abortControllers.delete(runId);
      this.activeSessionIds.delete(activeSession.id);
      // On abort the stream must close promptly — the title task keeps
      // running in the background and saves straight to the store.
      if (titleTask && !controller.signal.aborted) {
        await titleTask;
      }
    }
  }

  /**
   * 生成并保存 AI 会话标题，然后向当前 run 事件流推送 session_updated。
   * 不向外抛错：失败时会改用用户首句归一化后的兜底标题。
   */
  private async generateAndSaveTitle(options: {
    runId: string;
    sessionId: string;
    prompt: string;
    provider: ProviderConfig;
    apiKey: string;
    streamFn: StreamFn;
    emit: (event: StreamEvent) => void;
  }): Promise<void> {
    try {
      const title = await generateSessionTitle({
        prompt: options.prompt,
        provider: options.provider,
        apiKey: options.apiKey,
        streamFn: options.streamFn,
        // Deliberately independent of the run's abort signal: an aborted run
        // should still end up titled. The timeout bounds the finally-await.
        signal: AbortSignal.timeout(TITLE_TIMEOUT_MS)
      });
      if (!title) {
        console.warn(
          `[agent-runner] 会话标题生成结果为空，尝试使用兜底标题 sessionId=${options.sessionId}`
        );
        await this.saveFallbackTitle(options);
        return;
      }
      const session = await this.store.updateSession(options.sessionId, { title });
      options.emit({ type: "session_updated", runId: options.runId, session });
      console.info(
        `[agent-runner] 已生成会话标题 sessionId=${options.sessionId} title=${title}`
      );
    } catch (error) {
      console.warn(
        `[agent-runner] 会话标题生成失败，尝试使用兜底标题 sessionId=${options.sessionId}:`,
        error
      );
      await this.saveFallbackTitle(options);
    }
  }

  private async saveFallbackTitle(options: {
    runId: string;
    sessionId: string;
    prompt: string;
    emit: (event: StreamEvent) => void;
  }): Promise<void> {
    const fallbackTitle = normalizeTitle(options.prompt);
    if (!fallbackTitle) {
      console.warn(`[agent-runner] 无法从用户首句生成兜底标题 sessionId=${options.sessionId}`);
      return;
    }
    // Called from generateAndSaveTitle's catch path — must never reject, or
    // the finally-await on the title task would fail the whole stream.
    try {
      const session = await this.store.updateSession(options.sessionId, { title: fallbackTitle });
      options.emit({ type: "session_updated", runId: options.runId, session });
      console.info(
        `[agent-runner] 已使用用户首句作为兜底标题 sessionId=${options.sessionId} title=${fallbackTitle}`
      );
    } catch (error) {
      console.warn(
        `[agent-runner] 兜底标题写入失败，保留占位标题 sessionId=${options.sessionId}:`,
        error
      );
    }
  }

  /** First user message of a session — the title source when retrying. */
  private async firstUserMessageContent(sessionId: string): Promise<string | undefined> {
    const rows = await this.store.listMessages(sessionId);
    return rows.find((row) => row.role === "user")?.content;
  }

  /** Drive the pi agent loop, yielding translated StreamEvents as they arrive. */
  private async *runPiLoop(options: {
    runId: string;
    sessionId: string;
    queue: AsyncEventQueue<StreamEvent>;
    tools: AgentTool<any>[];
    approvedPlans: Map<string, ProposePlanArgs>;
    askUserAnswers: Map<string, AskUserAnswer>;
    provider: Parameters<typeof buildModel>[0];
    apiKey: string;
    accessMode: RunRequest["accessMode"];
    planMode: boolean;
    initialPlanConfirmed: boolean;
    viaFeishu: boolean;
    headless: boolean;
    systemPrompt: string;
    compactedUpToMessageId?: string;
    controller: AbortController;
  }): AsyncGenerator<StreamEvent> {
    const queue = options.queue;
    const translator = new RunEventTranslator({
      store: this.store,
      queue,
      approvals: this.approvals,
      runId: options.runId,
      sessionId: options.sessionId,
      accessMode: options.accessMode,
      signal: options.controller.signal,
      planMode: options.planMode,
      planConfirmed: options.initialPlanConfirmed,
      onPlanApproved: (toolCallId, args) => options.approvedPlans.set(toolCallId, args),
      onAskUserAnswered: (toolCallId, answer) => options.askUserAnswers.set(toolCallId, answer)
    });

    const rows = await this.store.listMessages(options.sessionId);
    const planPhase = (): PlanPhase => {
      if (!options.planMode) return "none";
      return translator.isPlanConfirmed() ? "execute" : "draft";
    };
    const context = {
      systemPrompt: options.systemPrompt,
      messages: buildAgentMessages(rows, options.compactedUpToMessageId),
      tools: selectAgentTools(options.tools, {
        planPhase: planPhase(),
        viaFeishu: options.viaFeishu,
        headless: options.headless
      })
    };

    void runAgentLoopContinue(
      context,
      {
        model: buildModel(options.provider),
        ...buildModelStreamOptions(options.provider),
        apiKey: options.apiKey,
        // History rows already round-trip as real pi messages (see history.ts),
        // so the LLM conversion is the identity.
        convertToLlm: (messages) => messages as PiMessage[],
        toolExecution: "sequential",
        beforeToolCall: translator.beforeToolCall,
        shouldStopAfterTurn: translator.shouldStopAfterTurn,
        prepareNextTurn: ({ context: currentContext }) => ({
          context: {
            ...currentContext,
            tools: selectAgentTools(options.tools, {
              planPhase: planPhase(),
              viaFeishu: options.viaFeishu,
              headless: options.headless
            })
          }
        })
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
      const decision = normalizeDecision(
        request.name,
        await this.approvals.wait(initial.id, controller.signal)
      );
      if (!decision.approved) {
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

  private async loadSkillContent(name: string, project?: Project): Promise<string | undefined> {
    const skill = await this.slashCommandService.findSkill(name, project);
    if (!skill) {
      return undefined;
    }
    let content = formatSkillInvocation(skill);
    if (content.length > MAX_SKILL_RESULT_CHARS) {
      console.warn(
        `[agent-runner] 技能内容过长，已截断 name=${name} chars=${content.length}`
      );
      content = `${content.slice(0, MAX_SKILL_RESULT_CHARS)}\n\n（技能说明已截断）`;
    }
    return content;
  }
}

function toAgentDebugTool(tool: AgentTool<any>): AgentDebugTool {
  return {
    name: tool.name,
    ...(tool.label ? { label: tool.label } : {}),
    ...(tool.description ? { description: tool.description } : {}),
    requiresApproval: requiresApproval(tool.name)
  };
}

function toClientMessage({ payload: _payload, ...message }: { payload?: string } & Message): Message {
  return message;
}
