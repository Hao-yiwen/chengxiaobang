import { mkdir } from "node:fs/promises";
import { runAgentLoopContinue, type AgentTool, type StreamFn } from "@earendil-works/pi-agent-core";
import { formatSkillInvocation } from "@earendil-works/pi-agent-core/node";
import { streamSimple, type Message as PiMessage, type UserMessage } from "@earendil-works/pi-ai";
import {
  createId,
  derivePlanState,
  nowIso,
  resolveModelInputModalities,
  type ActiveRunSnapshot,
  type AgentDebugTool,
  type AskUserAnswer,
  type Message,
  type MessageAttachment,
  type ProposePlanArgs,
  type Project,
  type ProviderConfig,
  type ReasoningMode,
  type RunImageAttachment,
  type RunRequest,
  type Session,
  type SessionDebugContext,
  type SessionContextUsage,
  type StreamEvent,
  type TokenUsage,
  type ToolCallApproval,
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
import { assessToolApprovalRisk } from "../tools/approval-policy";
import { parseToolRequest, type ToolRequest } from "../tools/direct-commands";
import { renderMemoryListing } from "../tools/memory-tools";
import { createPlanTools } from "../tools/plan-tools";
import { createScheduleTools } from "../tools/schedule-tools";
import { SlashCommandService } from "../tools/slash-command-service";
import { createTodoTools } from "../tools/todo-tools";
import { defaultSessionDir } from "../paths";
import { ApprovalQueue, normalizeDecision } from "./approval-queue";
import { AsyncEventQueue } from "./async-queue";
import { buildAgentMessages } from "./history";
import { RunEventTranslator } from "./pi-events";
import { buildSystemPrompt } from "./system-prompt";
import {
  compactableMessages,
  compactSessionHistory,
  runCompaction
} from "./compaction";
import {
  buildSessionContextUsage as buildContextUsageReport,
  shouldAutoCompactContext
} from "./context-usage";
import { generateSessionTitle, normalizeTitle } from "./session-title";
import { protectAgentToolResult, protectToolResultForContext } from "./tool-result-spill";
import { createSmartApprovalJudge, type SmartApprovalJudge } from "./smart-approval";

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
  createTools?: (workspacePath: string) => AgentTool<any>[] | Promise<AgentTool<any>[]>;
  /** Workspace dir for standalone (project-less) sessions. */
  sessionWorkspacePath?: (sessionId: string) => string;
  /**
   * 长期记忆落盘目录。设置后系统提示注入记忆协议与目录快照；
   * 默认 createTools 同时注册 memory 工具（自定义 createTools 需自行包含）。
   */
  memoryDir?: string;
  slashCommandService?: SlashCommandService;
  /** Model stream override — the test seam replacing live provider calls. */
  streamFn?: StreamFn;
  /**
   * Model stream for AI session-title generation. Defaults to the live
   * provider call; when streamFn (the test seam) is set without this, AI
   * titles are skipped so scripted runs stay deterministic.
   */
  titleStreamFn?: StreamFn;
  /** 智能审批裁决注入点；测试可替换为固定裁决，生产默认调用当前模型。 */
  smartApprovalJudge?: SmartApprovalJudge;
}

export class AgentRunner {
  readonly approvals = new ApprovalQueue();
  /** 正在执行 run 的会话；调度器据此避让，免得与手动 run 在同一会话交错写入。 */
  readonly activeSessionIds = new Set<string>();
  /** 当前进程仍在推进的 run；用于刷新/重连后恢复审批等待态。 */
  private readonly activeRuns = new Map<string, { sessionId: string }>();
  private readonly abortControllers = new Map<string, AbortController>();
  private readonly createTools: (workspacePath: string) => AgentTool<any>[] | Promise<AgentTool<any>[]>;
  private readonly sessionWorkspacePath: (sessionId: string) => string;
  private readonly slashCommandService: SlashCommandService;
  private readonly streamFn?: StreamFn;
  private readonly titleStreamFn?: StreamFn;
  private readonly smartApprovalJudge: SmartApprovalJudge;
  private readonly memoryDir?: string;

  constructor(
    private readonly store: StateStore,
    private readonly secrets: SecretStore,
    options: AgentRunnerOptions = {}
  ) {
    this.memoryDir = options.memoryDir;
    this.createTools =
      options.createTools ??
      ((workspacePath) =>
        createAgentTools(
          workspacePath,
          options.memoryDir ? { memoryDir: options.memoryDir } : {}
        ));
    this.sessionWorkspacePath = options.sessionWorkspacePath ?? defaultSessionDir;
    this.slashCommandService = options.slashCommandService ?? new SlashCommandService();
    this.streamFn = options.streamFn;
    this.titleStreamFn = options.titleStreamFn ?? (options.streamFn ? undefined : streamSimple);
    this.smartApprovalJudge = options.smartApprovalJudge ?? createSmartApprovalJudge();
  }

  abort(runId: string): boolean {
    const controller = this.abortControllers.get(runId);
    if (!controller) {
      console.warn("[agent-runner] 收到中止请求，但 run 不在当前进程执行中", { runId });
      return false;
    }
    console.info("[agent-runner] 收到中止请求，正在通知运行链路", { runId });
    controller.abort(new Error("用户中止运行"));
    this.abortControllers.delete(runId);
    return true;
  }

  async listActiveRunSnapshots(sessionId?: string): Promise<ActiveRunSnapshot[]> {
    const entries = [...this.activeRuns.entries()].filter(
      ([, active]) => !sessionId || active.sessionId === sessionId
    );
    const snapshots: ActiveRunSnapshot[] = [];

    for (const [runId, active] of entries) {
      const [runs, toolCalls] = await Promise.all([
        this.store.listRuns(active.sessionId),
        this.store.listToolCallsForSession(active.sessionId)
      ]);
      const run = runs.find((item) => item.id === runId);
      if (!run || run.status !== "running") {
        console.warn("[agent-runner] 活跃 run 快照跳过非运行中记录", {
          runId,
          sessionId: active.sessionId,
          status: run?.status
        });
        continue;
      }
      snapshots.push({
        run,
        toolCalls: toolCalls
          .filter((toolCall) => toolCall.runId === runId)
          .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      });
    }

    console.info("[agent-runner] 已查询活跃 run 快照", {
      sessionId,
      requestedCount: entries.length,
      returnedCount: snapshots.length
    });
    return snapshots.sort((left, right) => left.run.createdAt.localeCompare(right.run.createdAt));
  }

  private registerActiveRun(runId: string, sessionId: string): void {
    this.activeRuns.set(runId, { sessionId });
    console.info("[agent-runner] 登记活跃 run", {
      runId,
      sessionId,
      activeRunCount: this.activeRuns.size
    });
  }

  private forgetActiveRun(runId: string): void {
    const active = this.activeRuns.get(runId);
    if (!active) {
      return;
    }
    this.activeRuns.delete(runId);
    console.info("[agent-runner] 移除活跃 run", {
      runId,
      sessionId: active.sessionId,
      activeRunCount: this.activeRuns.size
    });
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
      ...(await this.createTools(workspacePath)),
      ...createTodoTools(),
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
      skills,
      ...(await this.memoryPromptInput())
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

  /** 构造会话当前会发送给模型的上下文用量估算，不写入会话。 */
  async buildSessionContextUsage(
    sessionId: string,
    options: { providerId?: string; model?: string; reasoningMode?: ReasoningMode; planMode?: boolean } = {}
  ): Promise<SessionContextUsage | undefined> {
    const session = await this.store.getSession(sessionId);
    if (!session) {
      console.warn(`[agent-runner] 上下文用量请求的会话不存在 sessionId=${sessionId}`);
      return undefined;
    }
    const providerBase = await this.resolveProviderForSession(session, options.providerId);
    if (!providerBase) {
      console.warn(`[agent-runner] 上下文用量请求缺少可用模型 sessionId=${sessionId}`);
      throw new Error("请先配置至少一个模型");
    }
    const effectiveReasoningMode =
      options.reasoningMode ?? session.reasoningMode ?? providerBase.reasoningMode;
    const provider: ProviderConfig = {
      ...providerBase,
      model: options.model ?? session.model ?? providerBase.model,
      ...(effectiveReasoningMode ? { reasoningMode: effectiveReasoningMode } : {})
    };
    const project = session.projectId ? await this.store.getProject(session.projectId) : undefined;
    const workspacePath = project?.path ?? this.sessionWorkspacePath(session.id);
    const [rows, toolCalls, runs, skills] = await Promise.all([
      this.store.listMessages(session.id),
      this.store.listToolCallsForSession(session.id),
      this.store.listRuns(session.id),
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
      ...(await this.createTools(workspacePath)),
      ...createTodoTools(),
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
    const usage = buildContextUsageReport({
      sessionId: session.id,
      provider,
      systemPrompt: buildSystemPrompt({
        workspacePath,
        accessMode: session.accessMode,
        projectName: project?.name,
        viaFeishu,
        headless: false,
        planMode,
        planSnapshot,
        skills,
        ...(await this.memoryPromptInput())
      }),
      messages: buildAgentMessages(rows, session.compactedUpToMessageId),
      tools: selectAgentTools(tools, { planPhase, viaFeishu, headless: false }),
      runs,
      compactedUpToMessageId: session.compactedUpToMessageId
    });
    console.info("[agent-runner] 已估算会话上下文用量", {
      sessionId: session.id,
      providerId: provider.id,
      model: provider.model,
      estimatedTokens: usage.estimatedTokens,
      contextWindowTokens: usage.contextWindowTokens,
      autoCompactThresholdTokens: usage.autoCompactThresholdTokens,
      sessionCostCny: usage.sessionCostCny,
      status: usage.status
    });
    return usage;
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
    const modelInputModalities = resolveModelInputModalities(provider.kind, provider.model);
    const nativeImageAttachments = input.attachments ?? [];
    const displayAttachments = input.displayAttachments ?? [];
    const displayContentForLog = input.displayContent ?? input.prompt;
    if (nativeImageAttachments.length > 0 && !modelInputModalities.includes("image")) {
      console.warn("[agent-runner] 文本模型收到原生图片附件，已拒绝本次运行", {
        providerId: selectedProvider.id,
        model: effectiveModel,
        attachmentCount: nativeImageAttachments.length,
        modelInputModalities
      });
      throw new Error("当前模型不支持图片原生输入，附件需要先经过 OCR");
    }
    console.info(
      `[agent-runner] 使用模型 providerId=${selectedProvider.id} model=${effectiveModel} modelSource=${
        input.model ? "run" : session.model ? "session" : "provider"
      } reasoningMode=${effectiveReasoningMode ?? "default"} reasoningSource=${
        input.reasoningMode ? "run" : session.reasoningMode ? "session" : selectedProvider.reasoningMode ? "provider" : "default"
      } inputModalities=${modelInputModalities.join(",")} nativeImageAttachments=${
        nativeImageAttachments.length
      } displayAttachments=${displayAttachments.length} promptChars=${input.prompt.length} displayChars=${
        displayContentForLog.length
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
    const displayContent = input.displayContent ?? expandedPrompt;
    const titleDisplayPrompt = displayPromptForTitle(displayContent, displayAttachments);
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
        ? ((await this.firstUserMessageContent(activeSession.id)) ?? titleDisplayPrompt)
        : titleDisplayPrompt;
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
    const runModelSnapshot = {
      providerId: selectedProvider.id,
      providerKind: provider.kind,
      model: provider.model
    };
    try {
      // /compact is a meta command about the conversation itself: it never
      // persists a user message and runs its own summarize-only model call.
      if (expandedPrompt.trim() === "/compact") {
        await this.store.createRun({
          id: runId,
          sessionId: activeSession.id,
          status: "running",
          ...runModelSnapshot
        });
        this.registerActiveRun(runId, activeSession.id);
        yield* runCompaction({
          store: this.store,
          session: activeSession,
          provider,
          apiKey,
          runId,
          clientRequestId: input.clientRequestId,
          signal: controller.signal,
          streamFn: this.streamFn
        });
        return;
      }

      await this.store.createRun({
        id: runId,
        sessionId: activeSession.id,
        status: "running",
        ...runModelSnapshot
      });
      this.registerActiveRun(runId, activeSession.id);
      const userMessage = await this.store.addMessage({
        sessionId: activeSession.id,
        role: "user",
        content: displayContent,
        attachments: displayAttachments,
        payload: JSON.stringify(buildUserPiMessage(expandedPrompt, nativeImageAttachments))
      });
      yield {
        type: "run_started",
        runId,
        sessionId: activeSession.id,
        ...(input.clientRequestId ? { clientRequestId: input.clientRequestId } : {}),
        providerId: selectedProvider.id,
        model: effectiveModel,
        ...(effectiveReasoningMode ? { reasoningMode: effectiveReasoningMode } : {})
      };
      yield { type: "message", runId, message: toClientMessage(userMessage) };

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
        ...(await this.createTools(workspacePath)),
        ...createTodoTools(),
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
      const viaFeishu = Boolean(activeSession.feishuChatId);
      const initialPlanPhase: PlanPhase = planMode
        ? initialPlanConfirmed
          ? "execute"
          : "draft"
        : "none";
      const systemPrompt = buildSystemPrompt({
        workspacePath,
        accessMode: input.accessMode,
        projectName: project?.name,
        viaFeishu,
        headless,
        planMode,
        planSnapshot,
        skills,
        ...(await this.memoryPromptInput())
      });

      // Direct slash-command fast path: run exactly one builtin tool before the
      // model loop, preserving deterministic single-tool semantics.
      const directRequest = parseToolRequest(expandedPrompt);
      if (directRequest) {
        const outcome = yield* this.runDirectTool(
          runId,
          activeSession.id,
          directRequest,
          tools,
          workspacePath,
          input.accessMode,
          provider,
          apiKey,
          controller,
          headless || viaFeishu
        );
        if (outcome !== "ok") {
          return;
        }
      }

      const autoCompact = yield* this.autoCompactIfNeeded({
        runId,
        session: activeSession,
        provider,
        apiKey,
        systemPrompt,
        tools,
        planPhase: initialPlanPhase,
        viaFeishu,
        headless,
        signal: controller.signal
      });
      if (autoCompact.aborted) {
        await this.store.updateRunStatus(runId, "aborted");
        yield { type: "run_end", runId, status: "aborted" };
        return;
      }

      yield* this.runPiLoop({
        runId,
        sessionId: activeSession.id,
        workspacePath,
        queue,
        tools,
        approvedPlans,
        askUserAnswers,
        provider,
        apiKey,
        accessMode: input.accessMode,
        planMode,
        initialPlanConfirmed,
        viaFeishu,
        headless,
        systemPrompt,
        initialUsage: autoCompact.usage,
        compactedUpToMessageId:
          autoCompact.compactedUpToMessageId ?? activeSession.compactedUpToMessageId,
        controller
      });
    } finally {
      this.abortControllers.delete(runId);
      this.forgetActiveRun(runId);
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

  private async resolveProviderForSession(
    session: Session,
    providerId?: string
  ): Promise<ProviderConfig | undefined> {
    if (providerId) {
      return this.store.getProvider(providerId);
    }
    if (session.providerId) {
      const provider = await this.store.getProvider(session.providerId);
      if (provider) {
        return provider;
      }
    }
    return (await this.store.listProviders()).find((candidate) => candidate.apiKeyRef);
  }

  /**
   * 系统提示的长期记忆段输入：未配置 memoryDir 时为空；
   * 快照读取失败只降级为空目录提示，绝不让记忆问题中断 run。
   */
  private async memoryPromptInput(): Promise<{ memory?: { listing?: string } }> {
    if (!this.memoryDir) {
      return {};
    }
    try {
      const listing = await renderMemoryListing(this.memoryDir);
      return { memory: listing ? { listing } : {} };
    } catch (error) {
      console.warn(`[agent-runner] 读取记忆目录快照失败 dir=${this.memoryDir}:`, error);
      return { memory: {} };
    }
  }

  /** First user message of a session — the title source when retrying. */
  private async firstUserMessageContent(sessionId: string): Promise<string | undefined> {
    const rows = await this.store.listMessages(sessionId);
    return rows.find((row) => row.role === "user")?.content;
  }

  private async *autoCompactIfNeeded(options: {
    runId: string;
    session: Session;
    provider: ProviderConfig;
    apiKey: string;
    systemPrompt: string;
    tools: AgentTool<any>[];
    planPhase: PlanPhase;
    viaFeishu: boolean;
    headless: boolean;
    signal: AbortSignal;
  }): AsyncGenerator<
    StreamEvent,
    { aborted: boolean; compactedUpToMessageId?: string; usage?: TokenUsage }
  > {
    const rows = await this.store.listMessages(options.session.id);
    const selectedTools = selectAgentTools(options.tools, {
      planPhase: options.planPhase,
      viaFeishu: options.viaFeishu,
      headless: options.headless
    });
    const usage = buildContextUsageReport({
      sessionId: options.session.id,
      provider: options.provider,
      systemPrompt: options.systemPrompt,
      messages: buildAgentMessages(rows, options.session.compactedUpToMessageId),
      tools: selectedTools,
      sessionCostCny: 0,
      compactedUpToMessageId: options.session.compactedUpToMessageId
    });
    if (!shouldAutoCompactContext(usage)) {
      console.debug("[agent-runner] 上下文未达到自动压缩阈值", {
        sessionId: options.session.id,
        model: options.provider.model,
        estimatedTokens: usage.estimatedTokens,
        autoCompactThresholdTokens: usage.autoCompactThresholdTokens,
        status: usage.status
      });
      return {
        aborted: false,
        compactedUpToMessageId: options.session.compactedUpToMessageId
      };
    }

    const candidates = compactableMessages(rows, options.session.compactedUpToMessageId);
    if (candidates.length === 0) {
      console.warn("[agent-runner] 上下文超过阈值但没有可压缩历史", {
        sessionId: options.session.id,
        model: options.provider.model,
        estimatedTokens: usage.estimatedTokens,
        autoCompactThresholdTokens: usage.autoCompactThresholdTokens,
        messageCount: rows.length
      });
      return {
        aborted: false,
        compactedUpToMessageId: options.session.compactedUpToMessageId
      };
    }

    console.info("[agent-runner] 触发自动上下文压缩", {
      sessionId: options.session.id,
      model: options.provider.model,
      estimatedTokens: usage.estimatedTokens,
      contextWindowTokens: usage.contextWindowTokens,
      autoCompactThresholdTokens: usage.autoCompactThresholdTokens,
      candidates: candidates.length
    });
    const result = yield* compactSessionHistory({
      store: this.store,
      session: options.session,
      provider: options.provider,
      apiKey: options.apiKey,
      runId: options.runId,
      signal: options.signal,
      streamFn: this.streamFn,
      introDelta: "当前上下文已接近模型上限，正在自动压缩较早对话...\n"
    });
    if (result.status === "aborted") {
      console.warn("[agent-runner] 自动上下文压缩被中止", {
        sessionId: options.session.id,
        runId: options.runId
      });
      return { aborted: true };
    }
    console.info("[agent-runner] 自动上下文压缩完成", {
      sessionId: options.session.id,
      runId: options.runId,
      compacted: result.compacted,
      compactedUpToMessageId: result.compactedUpToMessageId
    });
    return {
      aborted: false,
      usage: result.usage,
      compactedUpToMessageId:
        result.compactedUpToMessageId ?? options.session.compactedUpToMessageId
    };
  }

  /** Drive the pi agent loop, yielding translated StreamEvents as they arrive. */
  private async *runPiLoop(options: {
    runId: string;
    sessionId: string;
    workspacePath: string;
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
    initialUsage?: TokenUsage;
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
      strictApproval: options.headless || options.viaFeishu,
      signal: options.controller.signal,
      planMode: options.planMode,
      planConfirmed: options.initialPlanConfirmed,
      initialUsage: options.initialUsage,
      smartApproval: (toolCall) =>
        this.decideSmartApproval({
          runId: options.runId,
          toolCall,
          workspacePath: options.workspacePath,
          provider: options.provider,
          apiKey: options.apiKey,
          signal: options.controller.signal
        }),
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
        afterToolCall: (context) =>
          protectToolResultForContext(context, {
            workspacePath: options.workspacePath,
            runId: options.runId
          }),
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
    workspacePath: string,
    accessMode: RunRequest["accessMode"],
    provider: ProviderConfig,
    apiKey: string,
    controller: AbortController,
    strictApproval = false
  ): AsyncGenerator<StreamEvent, "ok" | "aborted" | "failed"> {
    yield { type: "delta", runId, channel: "thinking", delta: "正在准备本地工具调用...\n" };
    const tool = findTool(tools, request.name);
    const risk = assessToolApprovalRisk(request.name, request.args);
    const requiresGate = risk.requiresGate || (strictApproval && requiresApproval(request.name));
    const needsManualApproval = requiresGate && accessMode === "approval";
    const needsSmartApproval = requiresGate && accessMode === "smart_approval";
    const initialStatus = needsManualApproval
      ? "pending_approval"
      : needsSmartApproval
        ? "pending_smart_approval"
        : "running";
    const initial: ToolCall = {
      id: createId("tool"),
      runId,
      name: request.name,
      args: request.args,
      status: initialStatus,
      // startedAt marks actual execution start, so approval wait is excluded.
      ...(initialStatus === "running" ? { startedAt: nowIso() } : {}),
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    await this.store.insertToolCall(initial);
    console.info("[agent-runner] 直接工具审批策略", {
      runId,
      toolCallId: initial.id,
      toolName: request.name,
      status: initial.status,
      accessMode,
      risk: risk.risk,
      requiresGate,
      reason: risk.reason
    });
    yield { type: "tool_call", runId, toolCall: initial };

    let runnable = initial;
    if (initial.status === "pending_smart_approval") {
      const decision = await this.decideSmartApproval({
        runId,
        toolCall: initial,
        workspacePath,
        provider,
        apiKey,
        signal: controller.signal
      });
      if (decision.verdict === "deny") {
        const rejected = await this.store.updateToolCall({
          ...initial,
          status: "rejected",
          approval: decision,
          result: "智能审批不同意执行该操作",
          updatedAt: nowIso()
        });
        yield { type: "tool_call", runId, toolCall: rejected };
        await this.store.updateRunStatus(runId, "aborted");
        yield { type: "run_end", runId, status: "aborted" };
        return "aborted";
      }
      runnable = await this.store.updateToolCall({
        ...initial,
        status: decision.verdict === "allow" ? "running" : "pending_approval",
        approval: decision,
        ...(decision.verdict === "allow" ? { startedAt: nowIso() } : {}),
        updatedAt: nowIso()
      });
      yield { type: "tool_call", runId, toolCall: runnable };
    }

    if (runnable.status === "pending_approval") {
      const decision = normalizeDecision(
        request.name,
        await this.approvals.wait(runnable.id, controller.signal)
      );
      if (!decision.approved) {
        const rejected = await this.store.updateToolCall({
          ...runnable,
          status: "rejected",
          ...(runnable.approval
            ? { approval: markSmartApprovalUserDecision(runnable.approval, false) }
            : {}),
          result: "用户拒绝或运行已中止",
          updatedAt: nowIso()
        });
        yield { type: "tool_call", runId, toolCall: rejected };
        await this.store.updateRunStatus(runId, "aborted");
        yield { type: "run_end", runId, status: "aborted" };
        return "aborted";
      }
      runnable = await this.store.updateToolCall({
        ...runnable,
        status: "running",
        ...(runnable.approval
          ? { approval: markSmartApprovalUserDecision(runnable.approval, true) }
          : {}),
        startedAt: nowIso(),
        updatedAt: nowIso()
      });
      yield { type: "tool_call", runId, toolCall: runnable };
    }

    let completed: ToolCall;
    try {
      if (!tool) {
        throw new Error(`未知工具: ${request.name}`);
      }
      const result = await protectAgentToolResult(
        await tool.execute(runnable.id, request.args, controller.signal),
        {
          workspacePath,
          runId,
          toolCallId: runnable.id,
          toolName: request.name,
          isError: false
        }
      );
      completed = {
        ...runnable,
        status: "completed",
        result: toolResultText(result.result),
        updatedAt: nowIso()
      };
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error);
      const result = await protectAgentToolResult(
        { content: [{ type: "text", text: errorText }], details: undefined },
        {
          workspacePath,
          runId,
          toolCallId: runnable.id,
          toolName: request.name,
          isError: true
        }
      );
      completed = {
        ...runnable,
        status: "failed",
        result: toolResultText(result.result),
        updatedAt: nowIso()
      };
    }
    await this.store.updateToolCall(completed);
    yield { type: "tool_call", runId, toolCall: completed };
    if (controller.signal.aborted) {
      console.info("[agent-runner] 直接工具执行期间收到中止，run 以 aborted 结束", {
        runId,
        toolCallId: runnable.id,
        toolName: request.name,
        toolStatus: completed.status
      });
      await this.store.updateRunStatus(runId, "aborted");
      yield { type: "run_end", runId, status: "aborted" };
      return "aborted";
    }
    if (completed.status === "failed") {
      const errorText = completed.result ?? "工具调用失败";
      await this.store.updateRunStatus(runId, "failed", undefined, errorText);
      yield { type: "run_end", runId, status: "failed", error: errorText };
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

  private async decideSmartApproval(options: {
    runId: string;
    toolCall: ToolCall;
    workspacePath: string;
    provider: ProviderConfig;
    apiKey: string;
    signal: AbortSignal;
  }): Promise<ToolCallApproval> {
    try {
      return await this.smartApprovalJudge({
        runId: options.runId,
        toolCallId: options.toolCall.id,
        toolName: options.toolCall.name,
        args: options.toolCall.args,
        workspacePath: options.workspacePath,
        provider: options.provider,
        apiKey: options.apiKey,
        signal: options.signal
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn("[agent-runner] 智能审批裁决异常，降级为人工审批", {
        runId: options.runId,
        toolCallId: options.toolCall.id,
        toolName: options.toolCall.name,
        error: message
      });
      return {
        kind: "smart",
        source: "fallback",
        verdict: "ask_user",
        risk: "high",
        score: 0.85,
        reason: `智能审批异常，已交给你确认：${message}`,
        decidedAt: nowIso()
      };
    }
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

function toolResultText(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

function markSmartApprovalUserDecision(
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

function displayPromptForTitle(content: string, attachments: MessageAttachment[]): string {
  const trimmed = content.trim();
  if (trimmed) {
    return trimmed;
  }
  if (attachments.length === 0) {
    return "新对话";
  }
  return `附件：${attachments.map((attachment) => attachment.name).join("、")}`;
}

function buildUserPiMessage(content: string, attachments: RunImageAttachment[]): UserMessage {
  if (attachments.length === 0) {
    return { role: "user", content, timestamp: Date.now() };
  }
  return {
    role: "user",
    content: [
      { type: "text", text: content },
      ...attachments.map((attachment) => ({
        type: "image" as const,
        data: attachment.dataBase64,
        mimeType: attachment.mimeType
      }))
    ],
    timestamp: Date.now()
  };
}

function toClientMessage(
  { payload: _payload, ...message }: { payload?: string } & Message
): Message & { attachments: MessageAttachment[] } {
  return {
    ...message,
    attachments: message.attachments ?? []
  };
}
