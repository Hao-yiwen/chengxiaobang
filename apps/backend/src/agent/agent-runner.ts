import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  runAgentLoopContinue,
  type AgentContext,
  type AgentMessage,
  type AgentTool,
  type StreamFn
} from "@earendil-works/pi-agent-core";
import { formatSkillInvocation } from "@earendil-works/pi-agent-core/node";
import {
  streamSimple,
  type Api,
  type Message as PiMessage,
  type Model,
  type ProviderResponse
} from "@earendil-works/pi-ai";
import {
  createId,
  derivePlanState,
  nowIso,
  resolveProviderConfigModelInputModalities,
  resolveProviderConfigModelMaxToolIterations,
  type ActiveRunSnapshot,
  type AskUserAnswer,
  type MessageAttachment,
  type ModelVisibleSkill,
  type ModelInputModality,
  type ProposePlanArgs,
  type Project,
  type ProviderConfig,
  type ReasoningMode,
  type RunImageAttachment,
  type RunRequest,
  type RunSteeringRequest,
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
import type { ProviderRepository } from "../model/provider-service";
import { bindLogContext, errorToLogFields, getLogger } from "../logging/logger";
import { buildModel, buildModelStreamOptions, toTokenUsage } from "../model/pi-model";
import {
  createAgentTools,
  selectAgentTools,
  type PlanPhase
} from "../tools/registry";
import { renderMemoryListing } from "../tools/memory-tools";
import { createPlanTools } from "../tools/plan-tools";
import { createScheduleTools } from "../tools/schedule-tools";
import { SlashCommandService } from "../tools/slash-command-service";
import { createToolSearchTool } from "../tools/tool-search-tool";
import { createTodoTools } from "../tools/todo-tools";
import { defaultDataDir, defaultSessionDir } from "../paths";
import { SHELL_GLOBAL_OUTPUT_DIR } from "../tools/shell";
import { ActiveRunRegistry } from "./active-runs";
import { ApprovalQueue } from "./approval-queue";
import {
  buildUserPiMessage,
  displayPromptForTitle,
  toAgentDebugTool,
  toClientMessage
} from "./agent-runner-messages";
import { AsyncEventQueue } from "./async-queue";
import { buildAgentMessages, buildUncompactedAgentMessages } from "./history";
import { RunEventTranslator } from "./pi-events";
import { ProjectApprovalTrustService } from "./project-approval-trust";
import { buildSystemPrompt } from "./system-prompt";
import { collectEnvironmentContext } from "./environment-context";
import { buildProjectInstructionMessage, findInstructionFile } from "./project-instructions";
import { buildContextReminderMessage, buildReminderMessage } from "./system-reminders";
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
import { protectToolResultForContext, TOOL_RESULT_SPILL_DIR } from "./tool-result-spill";
import { createSmartApprovalJudge, type SmartApprovalJudge } from "./smart-approval";
import {
  UsageCostLedgerService,
  type UsageCostAttempt
} from "../usage/usage-cost-ledger";

const MAX_SKILL_RESULT_CHARS = 32 * 1024;

/**
 * 会话标题尚未生成时的占位标题；标题模型失败时会落用户首句兜底标题，
 * 避免侧栏一直显示占位文案。
 */
export const DEFAULT_SESSION_TITLE = "新对话";

/** 标题模型调用上限，避免标题任务无限拖住事件流收尾。 */
const TITLE_TIMEOUT_MS = 15_000;
const log = getLogger({ module: "agent-runner" });

export interface AgentRunnerOptions {
  /** 为工作区构造工具集合，默认使用内置工具注册表。 */
  createTools?: (
    workspacePath: string,
    runtime?: AgentToolRuntimeContext
  ) => AgentTool<any>[] | Promise<AgentTool<any>[]>;
  /** 独立会话（无项目绑定）的默认工作目录。 */
  sessionWorkspacePath?: (sessionId: string) => string;
  /**
   * 长期记忆落盘目录。设置后系统提示注入记忆协议与目录快照；
   * 默认 createTools 同时注册 memory 工具（自定义 createTools 需自行包含）。
   */
  memoryDir?: string;
  slashCommandService?: SlashCommandService;
  /** 模型流覆盖入口；测试用它替换真实供应商调用。 */
  streamFn?: StreamFn;
  /**
   * AI 会话标题生成使用的模型流。默认走真实供应商调用；
   * 如果只设置 streamFn（测试缝），则跳过 AI 标题以保持脚本运行确定性。
   */
  titleStreamFn?: StreamFn;
  /** 智能审批裁决注入点；测试可替换为固定裁决，生产默认调用当前模型。 */
  smartApprovalJudge?: SmartApprovalJudge;
  /** 模型请求费用账本；默认按当前 StateStore 创建。 */
  usageCostLedgerService?: UsageCostLedgerService;
  /** 供应商配置仓库；生产环境使用 ~/.chengxiaobang/config.yaml。 */
  providerRepository?: ProviderRepository;
  /** 项目级工具审批信任服务；默认使用 StateStore settings KV。 */
  projectApprovalTrustService?: ProjectApprovalTrustService;
  /** 长工具结果的全局落盘目录，默认位于 data-dir/tool-results。 */
  toolResultSpillDir?: string;
  /** 后台 shell 输出的全局落盘目录，默认位于 data-dir/shell-outputs。 */
  shellOutputDir?: string;
}

export interface ResolvedSessionWorkspace {
  workspacePath: string;
  project?: Project;
  projectBound: boolean;
}

export interface AgentToolRuntimeContext {
  provider?: ProviderConfig;
  apiKey?: string;
  signal?: AbortSignal;
  runId?: string;
  sessionId?: string;
  modelInputModalities?: readonly ModelInputModality[];
}

export class AgentRunner {
  readonly approvals = new ApprovalQueue();
  /** 正在执行 run 的会话；调度器据此避让，免得与手动 run 在同一会话交错写入。 */
  readonly activeSessionIds = new Set<string>();
  /** 当前进程仍在推进的 run；用于刷新/重连后恢复审批等待态。 */
  private readonly activeRunRegistry = new ActiveRunRegistry();
  private readonly abortControllers = new Map<string, AbortController>();
  private readonly createTools: (
    workspacePath: string,
    runtime?: AgentToolRuntimeContext
  ) => AgentTool<any>[] | Promise<AgentTool<any>[]>;
  private readonly sessionWorkspacePath: (sessionId: string) => string;
  private readonly slashCommandService: SlashCommandService;
  private readonly streamFn?: StreamFn;
  private readonly titleStreamFn?: StreamFn;
  private readonly smartApprovalJudge: SmartApprovalJudge;
  private readonly usageCostLedgerService: UsageCostLedgerService;
  private readonly providerRepository: ProviderRepository;
  private readonly projectApprovalTrustService: ProjectApprovalTrustService;
  private readonly memoryDir?: string;
  private readonly toolResultSpillDir: string;
  private readonly shellOutputDir: string;

  constructor(
    private readonly store: StateStore,
    private readonly secrets: SecretStore,
    options: AgentRunnerOptions = {}
  ) {
    this.memoryDir = options.memoryDir;
    this.toolResultSpillDir =
      options.toolResultSpillDir ?? join(defaultDataDir(), TOOL_RESULT_SPILL_DIR);
    this.shellOutputDir = options.shellOutputDir ?? join(defaultDataDir(), SHELL_GLOBAL_OUTPUT_DIR);
    this.createTools =
      options.createTools ??
      ((workspacePath, runtime) =>
        createAgentTools(
          workspacePath,
          {
            ...(options.memoryDir ? { memoryDir: options.memoryDir } : {}),
            ...(runtime?.modelInputModalities
              ? { modelInputModalities: runtime.modelInputModalities }
              : {}),
            shellOutputDir: this.shellOutputDir,
            ...(runtime?.runId ? { runId: runtime.runId } : {}),
            ...(runtime?.provider && runtime.apiKey
              ? {
                  webFetch: {
                    provider: runtime.provider,
                    apiKey: runtime.apiKey,
                    signal: runtime.signal
                  }
                }
              : {})
          }
        ));
    this.sessionWorkspacePath = options.sessionWorkspacePath ?? defaultSessionDir;
    this.slashCommandService = options.slashCommandService ?? new SlashCommandService();
    this.streamFn = options.streamFn;
    this.titleStreamFn = options.titleStreamFn ?? (options.streamFn ? undefined : streamSimple);
    this.smartApprovalJudge = options.smartApprovalJudge ?? createSmartApprovalJudge();
    this.usageCostLedgerService =
      options.usageCostLedgerService ?? new UsageCostLedgerService(store);
    this.providerRepository = options.providerRepository ?? store;
    this.projectApprovalTrustService =
      options.projectApprovalTrustService ?? new ProjectApprovalTrustService(store);
  }

  abort(runId: string): boolean {
    const controller = this.abortControllers.get(runId);
    if (!controller) {
      log.warn("收到中止请求，但 run 不在当前进程执行中", {
        action: "run.abort_missing",
        runId
      });
      return false;
    }
    log.info("收到中止请求，正在通知运行链路", {
      action: "run.abort",
      runId
    });
    controller.abort(new Error("用户中止运行"));
    this.abortControllers.delete(runId);
    return true;
  }

  enqueueSteering(runId: string, input: RunSteeringRequest): boolean {
    return this.activeRunRegistry.enqueueSteering(runId, input);
  }

  async resolveSessionWorkspace(session: Session): Promise<ResolvedSessionWorkspace> {
    const project = session.projectId ? await this.store.getProject(session.projectId) : undefined;
    return {
      workspacePath: project?.path ?? this.sessionWorkspacePath(session.id),
      ...(project ? { project } : {}),
      projectBound: Boolean(project)
    };
  }

  async listActiveRunSnapshots(sessionId?: string): Promise<ActiveRunSnapshot[]> {
    const entries = this.activeRunRegistry.entries(sessionId);
    const snapshots: ActiveRunSnapshot[] = [];

    for (const [runId, active] of entries) {
      const [runs, toolCalls] = await Promise.all([
        this.store.listRuns(active.sessionId),
        this.store.listToolCallsForSession(active.sessionId)
      ]);
      const run = runs.find((item) => item.id === runId);
      if (!run || run.status !== "running") {
        log.warn("活跃 run 快照跳过非运行中记录", {
          action: "active_run.snapshot_skip",
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

    log.info("已查询活跃 run 快照", {
      action: "active_run.snapshot_list",
      sessionId,
      requestedCount: entries.length,
      returnedCount: snapshots.length
    });
    return snapshots.sort((left, right) => left.run.createdAt.localeCompare(right.run.createdAt));
  }

  private async drainSteeringMessages(options: {
    runId: string;
    sessionId: string;
    queue: AsyncEventQueue<StreamEvent>;
    modelInputModalities: ModelInputModality[];
  }): Promise<{ messages: AgentMessage[]; enableOcrTool: boolean }> {
    const queued = this.activeRunRegistry.drainSteering(options.runId);
    if (queued.length === 0) {
      return { messages: [], enableOcrTool: false };
    }
    log.info("开始注入运行中引导", {
      action: "steering.inject_start",
      runId: options.runId,
      sessionId: options.sessionId,
      count: queued.length
    });

    const messages: AgentMessage[] = [];
    let enableOcrTool = false;
    for (const item of queued) {
      const displayContent = item.displayContent ?? item.prompt;
      try {
        const piMessage = buildUserPiMessage(item.prompt, item.attachments ?? []);
        if (
          shouldEnableOcrTool(
            item.displayAttachments ?? [],
            options.modelInputModalities,
            item.attachments ?? []
          )
        ) {
          enableOcrTool = true;
        }
        const persisted = await this.store.addMessage({
          sessionId: options.sessionId,
          role: "user",
          content: displayContent,
          attachments: item.displayAttachments ?? [],
          payload: JSON.stringify(piMessage)
        });
        options.queue.push({
          type: "message",
          runId: options.runId,
          message: toClientMessage(persisted)
        });
        messages.push(piMessage);
        log.info("已注入运行中引导", {
          action: "steering.injected",
          runId: options.runId,
          sessionId: options.sessionId,
          clientRequestId: item.clientRequestId,
          messageId: persisted.id,
          promptChars: item.prompt.length,
          displayChars: displayContent.length,
          displayAttachmentCount: item.displayAttachments?.length ?? 0,
          nativeAttachmentCount: item.attachments?.length ?? 0
        });
      } catch (error) {
        log.error("运行中引导持久化失败，已跳过该条", {
          action: "steering.persist_failed",
          runId: options.runId,
          sessionId: options.sessionId,
          clientRequestId: item.clientRequestId,
          ...errorToLogFields(error)
        });
      }
    }
    return { messages, enableOcrTool };
  }

  /** 构造调试面板使用的只读上下文快照，不启动模型、不写入会话。 */
  async buildSessionDebugContext(
    sessionId: string,
    options: { planMode?: boolean } = {}
  ): Promise<SessionDebugContext | undefined> {
    const session = await this.store.getSession(sessionId);
    if (!session) {
      log.warn("Debug 上下文请求的会话不存在", {
        action: "debug_context.session_missing",
        sessionId
      });
      return undefined;
    }
    const { project, workspacePath } = await this.resolveSessionWorkspace(session);
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
    const enabledDeferredToolNames = new Set<string>();
    const tools = attachToolSearchTool(
      [
        ...(await this.createTools(workspacePath)),
        ...createTodoTools({
          listToolCalls: () => this.store.listToolCallsForSession(session.id)
        }),
        ...createPlanTools({
          getApprovedPlanArgs: () => undefined,
          getAskUserAnswer: () => undefined,
          loadSkill: async (skill) => this.loadSkillContent(skill, project),
          recordSkillUsage: async (skill) => this.slashCommandService.recordSkillUsage(skill)
        }),
        ...createScheduleTools({
          store: this.store,
          sessionId: session.id,
          ...(session.feishuChatId ? { feishuChatId: session.feishuChatId } : {}),
          ...(session.wechatChatId ? { wechatChatId: session.wechatChatId } : {})
        })
      ],
      enabledDeferredToolNames
    );
    const availableTools = selectAgentTools(tools, {
      planPhase,
      viaFeishu,
      headless: false,
      enabledDeferredToolNames
    }).map(toAgentDebugTool);
    const environment = await collectEnvironmentContext({
      workspacePath,
      ...(session.model ? { model: session.model } : {})
    });
    const leadingMessages = await this.buildLeadingMessages({ workspacePath, skills });
    const systemPrompt = buildSystemPrompt({
      workspacePath,
      accessMode: session.accessMode,
      projectName: project?.name,
      viaFeishu,
      headless: false,
      planMode,
      ...(planMode && planSnapshot ? { planSnapshot } : {}),
      environment,
      ...(await this.memoryPromptInput())
    });

    log.info("已构造 Debug 上下文", {
      action: "debug_context.built",
      sessionId: session.id,
      messages: rows.length,
      tools: availableTools.length,
      planMode
    });
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
      modelMessages: [
        ...leadingMessages,
        ...buildAgentMessages(rows, session.compactedUpToMessageId)
      ],
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
      log.warn("上下文用量请求的会话不存在", {
        action: "context_usage.session_missing",
        sessionId
      });
      return undefined;
    }
    const providerBase = await this.resolveProviderForSession(session, options.providerId);
    if (!providerBase) {
      log.warn("上下文用量请求缺少可用模型", {
        action: "context_usage.provider_missing",
        sessionId
      });
      throw new Error("请先配置至少一个模型");
    }
    const effectiveReasoningMode =
      options.reasoningMode ?? session.reasoningMode ?? providerBase.reasoningMode;
    const provider: ProviderConfig = {
      ...providerBase,
      model: options.model ?? session.model ?? providerBase.model,
      ...(effectiveReasoningMode ? { reasoningMode: effectiveReasoningMode } : {})
    };
    const modelInputModalities = resolveProviderConfigModelInputModalities(provider, provider.model);
    const { project, workspacePath } = await this.resolveSessionWorkspace(session);
    const [rows, toolCalls, sessionCostCny, skills] = await Promise.all([
      this.store.listMessages(session.id),
      this.store.listToolCallsForSession(session.id),
      this.usageCostLedgerService.getSessionCostCny(session.id),
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
    const enabledDeferredToolNames = new Set<string>();
    const tools = attachToolSearchTool(
      [
        ...(await this.createTools(workspacePath, { modelInputModalities })),
        ...createTodoTools({
          listToolCalls: () => this.store.listToolCallsForSession(session.id)
        }),
        ...createPlanTools({
          getApprovedPlanArgs: () => undefined,
          getAskUserAnswer: () => undefined,
          loadSkill: async (skill) => this.loadSkillContent(skill, project),
          recordSkillUsage: async (skill) => this.slashCommandService.recordSkillUsage(skill)
        }),
        ...createScheduleTools({
          store: this.store,
          sessionId: session.id,
          ...(session.feishuChatId ? { feishuChatId: session.feishuChatId } : {}),
          ...(session.wechatChatId ? { wechatChatId: session.wechatChatId } : {})
        })
      ],
      enabledDeferredToolNames
    );
    const environment = await collectEnvironmentContext({
      workspacePath,
      model: provider.model,
      inputModalities: modelInputModalities,
      includeGitStatus: false
    });
    const leadingMessages = await this.buildLeadingMessages({ workspacePath, skills });
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
        environment,
        ...(await this.memoryPromptInput())
      }),
      messages: [
        ...leadingMessages,
        ...buildAgentMessages(rows, session.compactedUpToMessageId)
      ],
      tools: selectAgentTools(tools, {
        planPhase,
        viaFeishu,
        headless: false,
        enabledDeferredToolNames
      }),
      sessionCostCny,
      compactedUpToMessageId: session.compactedUpToMessageId
    });
    log.info("已估算会话上下文用量", {
      action: "context_usage.estimated",
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
    internal: { headless?: boolean; signal?: AbortSignal } = {}
  ): AsyncGenerator<StreamEvent> {
    const controller = new AbortController();
    // 外部信号(如定时任务总时限)可在尚未拿到 runId 时就中止本 run:run 会在下一个
    // signal 检查点自行收尾(run_end aborted),不会成为无人跟踪的孤儿。
    if (internal.signal) {
      if (internal.signal.aborted) {
        controller.abort(internal.signal.reason);
      } else {
        internal.signal.addEventListener("abort", () => controller.abort(internal.signal?.reason), {
          once: true
        });
      }
    }
    const planMode = input.planMode ?? false;
    const headless = internal.headless ?? false;
    const selectedProvider = input.providerId
      ? await this.providerRepository.getProvider(input.providerId)
      : (await this.providerRepository.listProviders()).find((candidate) => candidate.apiKeyRef);
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
    bindLogContext({
      sessionId: session.id,
      clientRequestId: input.clientRequestId
    });
    const effectiveModel = input.model ?? session.model ?? selectedProvider.model;
    const effectiveReasoningMode =
      input.reasoningMode ?? session.reasoningMode ?? selectedProvider.reasoningMode;
    const provider: ProviderConfig = {
      ...selectedProvider,
      model: effectiveModel,
      ...(effectiveReasoningMode ? { reasoningMode: effectiveReasoningMode } : {})
    };
    const maxToolIterations = resolveProviderConfigModelMaxToolIterations(provider, effectiveModel);
    const modelInputModalities = resolveProviderConfigModelInputModalities(provider, provider.model);
    const nativeImageAttachments = input.attachments ?? [];
    const displayAttachments = input.displayAttachments ?? [];
    const enableOcrTool = shouldEnableOcrTool(
      displayAttachments,
      modelInputModalities,
      nativeImageAttachments
    );
    const displayContentForLog = input.displayContent ?? input.prompt;
    if (nativeImageAttachments.length > 0 && !modelInputModalities.includes("image")) {
      log.warn("文本模型收到原生图片附件，已拒绝本次运行", {
        action: "run.reject_native_image",
        providerId: selectedProvider.id,
        model: effectiveModel,
        attachmentCount: nativeImageAttachments.length,
        modelInputModalities
      });
      throw new Error("当前模型不支持图片原生输入，附件需要先经过 OCR");
    }
    log.info("使用模型", {
      action: "run.model_selected",
      providerId: selectedProvider.id,
      model: effectiveModel,
      modelSource: input.model ? "run" : session.model ? "session" : "provider",
      reasoningMode: effectiveReasoningMode ?? "default",
      reasoningSource: input.reasoningMode
        ? "run"
        : session.reasoningMode
          ? "session"
          : selectedProvider.reasoningMode
            ? "provider"
            : "default",
      maxToolIterations,
      inputModalities: modelInputModalities,
      nativeImageAttachments: nativeImageAttachments.length,
      displayAttachments: displayAttachments.length,
      enableOcrTool,
      promptChars: input.prompt.length,
      displayChars: displayContentForLog.length
    });
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
    const { project, workspacePath } = await this.resolveSessionWorkspace(activeSession);
    const expandedPrompt = (await this.slashCommandService.expandPrompt(input.prompt, project))
      .prompt;
    const displayContent = input.displayContent ?? expandedPrompt;
    const titleDisplayPrompt = displayPromptForTitle(displayContent, displayAttachments);
    const shouldTitleSession = activeSession.title === DEFAULT_SESSION_TITLE;
    let immediateTitleSession: Session | undefined;
    // 占位标题(系统可覆盖的临时标题):AI/兜底标题写回时据此判断标题是否被用户改动过,
    // 避免临时标题或后到的自动标题覆盖用户手改的标题。
    let placeholderTitle = activeSession.title;
    if (shouldTitleSession) {
      const immediateTitle = normalizeTitle(titleDisplayPrompt);
      if (immediateTitle && immediateTitle !== activeSession.title) {
        try {
          immediateTitleSession = await this.store.updateSession(activeSession.id, {
            title: immediateTitle
          });
          placeholderTitle = immediateTitle;
          log.info("已写入临时会话标题", {
            action: "session_title.placeholder_written",
            sessionId: activeSession.id,
            title: immediateTitle,
            promptChars: titleDisplayPrompt.length
          });
        } catch (error) {
          log.warn("临时会话标题写入失败，继续运行", {
            action: "session_title.placeholder_failed",
            sessionId: activeSession.id,
            title: immediateTitle,
            ...errorToLogFields(error)
          });
        }
      }
    }

    const runId = createId("run");
    bindLogContext({
      runId,
      sessionId: activeSession.id,
      clientRequestId: input.clientRequestId,
      providerId: selectedProvider.id,
      model: effectiveModel
    });
    // 在这里创建而不是放进 runPiLoop，便于并发标题任务把 session_updated 推入同一条事件流。
    const queue = new AsyncEventQueue<StreamEvent>();

    // 占位标题会话的 AI 标题任务与 agent loop 并发运行,但要等用户消息落库后再启动(见下文),
    // 以便已有会话重试时 firstUserMessageContent 读到本轮消息;标题保存后推送 session_updated,
    // 事件流结束前会等待它,确保渲染层 run 后刷新能读到标题。
    let titleTask: Promise<void> | undefined;

    this.abortControllers.set(runId, controller);
    this.activeSessionIds.add(activeSession.id);
    const runModelSnapshot = {
      providerId: selectedProvider.id,
      providerKind: provider.kind,
      model: provider.model
    };
    try {
      // /compact 是针对会话自身的元命令：不持久化用户消息，只执行总结模型调用。
      if (expandedPrompt.trim() === "/compact") {
        await this.store.createRun({
          id: runId,
          sessionId: activeSession.id,
          status: "running",
          ...runModelSnapshot
        });
        this.activeRunRegistry.register(runId, {
          sessionId: activeSession.id,
          providerId: selectedProvider.id,
          model: provider.model,
          ...(effectiveReasoningMode ? { reasoningMode: effectiveReasoningMode } : {})
        });
        yield* runCompaction({
          store: this.store,
          session: activeSession,
          provider,
          apiKey,
          runId,
          clientRequestId: input.clientRequestId,
          signal: controller.signal,
          streamFn: this.streamFn,
          usageCostLedgerService: this.usageCostLedgerService
        });
        return;
      }

      await this.store.createRun({
        id: runId,
        sessionId: activeSession.id,
        status: "running",
        ...runModelSnapshot
      });
      this.activeRunRegistry.register(runId, {
        sessionId: activeSession.id,
        providerId: selectedProvider.id,
        model: provider.model,
        ...(effectiveReasoningMode ? { reasoningMode: effectiveReasoningMode } : {})
      });
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
      if (immediateTitleSession) {
        yield { type: "session_updated", runId, session: immediateTitleSession };
      }
      yield { type: "message", runId, message: toClientMessage(userMessage) };

      // 用户消息已落库,此时再启动标题任务:已有会话重试时 firstUserMessageContent 能读到本轮消息,
      // 标题取材稳定(配合 listMessages 的 rowid 排序),不再依赖落库前的不确定读。
      if (this.titleStreamFn && shouldTitleSession) {
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
          placeholderTitle,
          emit: (event) => queue.push(event)
        });
      }

      if (!project) {
        log.info("为独立会话准备工作目录", {
          action: "workspace.prepare_session_dir",
          sessionId: activeSession.id,
          path: workspacePath
        });
        await mkdir(workspacePath, { recursive: true });
      }
      const approvedPlans = new Map<string, ProposePlanArgs>();
      const askUserAnswers = new Map<string, AskUserAnswer>();
      const skills = await this.slashCommandService.listSkills(project);
      const enabledDeferredToolNames = new Set<string>();
      const tools = attachToolSearchTool(
        [
          ...(await this.createTools(workspacePath, {
            provider,
            apiKey,
            signal: controller.signal,
            runId,
            sessionId: activeSession.id,
            modelInputModalities
          })),
          ...createTodoTools({
            listToolCalls: () => this.store.listToolCallsForSession(activeSession.id),
            runId
          }),
          ...createPlanTools({
            getApprovedPlanArgs: (toolCallId) => approvedPlans.get(toolCallId),
            getAskUserAnswer: (toolCallId) => askUserAnswers.get(toolCallId),
            loadSkill: async (skill) => this.loadSkillContent(skill, project),
            recordSkillUsage: async (skill) => this.slashCommandService.recordSkillUsage(skill)
          }),
          ...createScheduleTools({
            store: this.store,
            sessionId: activeSession.id,
            ...(activeSession.feishuChatId ? { feishuChatId: activeSession.feishuChatId } : {}),
            ...(activeSession.wechatChatId ? { wechatChatId: activeSession.wechatChatId } : {})
          })
        ],
        enabledDeferredToolNames
      );
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
      const environment = await collectEnvironmentContext({
        workspacePath,
        model: provider.model,
        inputModalities: modelInputModalities
      });
      const leadingMessages = await this.buildLeadingMessages({ workspacePath, skills });
      const systemPrompt = buildSystemPrompt({
        workspacePath,
        accessMode: input.accessMode,
        projectName: project?.name,
        viaFeishu,
        headless,
        planMode,
        planSnapshot,
        environment,
        ...(await this.memoryPromptInput())
      });

      // 在 try 外声明,供后续 runPiLoop 读取 usage / compactedUpToMessageId;
      // catch 分支总是 return,故执行到下方时一定已赋值。
      let autoCompact!: {
        aborted: boolean;
        compactedUpToMessageId?: string;
        usage?: TokenUsage;
      };
      try {
        autoCompact = yield* this.autoCompactIfNeeded({
          runId,
          session: activeSession,
          provider,
          apiKey,
          systemPrompt,
          tools,
          planPhase: initialPlanPhase,
          viaFeishu,
          headless,
          enableOcrTool,
          enabledDeferredToolNames,
          signal: controller.signal
        });
      } catch (error) {
        // 自动压缩(上下文超阈值时触发)若模型请求失败会向外抛;此时 run 已是
        // running,必须显式收尾为 failed/aborted 并发 run_end,否则前端永久卡运行态。
        const message = error instanceof Error ? error.message : String(error);
        const aborted = controller.signal.aborted;
        log.error("自动压缩失败，收尾 run", {
          action: "auto_compact.failed_finish_run",
          runId,
          sessionId: activeSession.id,
          aborted,
          errorMessage: message,
          ...errorToLogFields(error)
        });
        if (aborted) {
          await this.store.updateRunStatus(runId, "aborted");
          yield { type: "run_end", runId, status: "aborted" };
        } else {
          await this.store.updateRunStatus(runId, "failed");
          yield { type: "run_end", runId, status: "failed", error: message };
        }
        return;
      }
      if (autoCompact.aborted) {
        await this.store.updateRunStatus(runId, "aborted");
        yield { type: "run_end", runId, status: "aborted" };
        return;
      }

      yield* this.runPiLoop({
        runId,
        sessionId: activeSession.id,
        projectId: activeSession.projectId,
        workspacePath,
        queue,
        tools,
        approvedPlans,
        askUserAnswers,
        provider,
        maxToolIterations,
        apiKey,
        accessMode: input.accessMode,
        planMode,
        initialPlanConfirmed,
        viaFeishu,
        headless,
        enableOcrTool,
        enabledDeferredToolNames,
        modelInputModalities,
        systemPrompt,
        leadingMessages,
        sideChatParentSessionId:
          input.sideChatParentSessionId ?? activeSession.sideChatParentSessionId,
        initialUsage: autoCompact.usage,
        compactedUpToMessageId:
          autoCompact.compactedUpToMessageId ?? activeSession.compactedUpToMessageId,
        controller
      });
    } finally {
      this.abortControllers.delete(runId);
      this.activeRunRegistry.forget(runId);
      this.activeSessionIds.delete(activeSession.id);
      // 中止时事件流必须尽快关闭；标题任务继续在后台写入 store。
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
    placeholderTitle: string;
    emit: (event: StreamEvent) => void;
  }): Promise<void> {
    try {
      const title = await generateSessionTitle({
        prompt: options.prompt,
        provider: options.provider,
        apiKey: options.apiKey,
        streamFn: options.streamFn,
        // 标题任务刻意不跟随 run 中止信号：被中止的 run 也应该尽量生成标题，
        // 超时负责限制 finally 中等待的最长时间。
        signal: AbortSignal.timeout(TITLE_TIMEOUT_MS)
      });
      if (!title) {
        log.warn("会话标题生成结果为空，尝试使用兜底标题", {
          action: "session_title.empty",
          runId: options.runId,
          sessionId: options.sessionId
        });
        await this.saveFallbackTitle(options);
        return;
      }
      await this.writeTitleIfPlaceholder({
        sessionId: options.sessionId,
        title,
        placeholderTitle: options.placeholderTitle,
        runId: options.runId,
        emit: options.emit,
        source: "ai"
      });
    } catch (error) {
      log.warn("会话标题生成失败，尝试使用兜底标题", {
        action: "session_title.generate_failed",
        runId: options.runId,
        sessionId: options.sessionId,
        ...errorToLogFields(error)
      });
      await this.saveFallbackTitle(options);
    }
  }

  private async saveFallbackTitle(options: {
    runId: string;
    sessionId: string;
    prompt: string;
    placeholderTitle: string;
    emit: (event: StreamEvent) => void;
  }): Promise<void> {
    const fallbackTitle = normalizeTitle(options.prompt);
    if (!fallbackTitle) {
      log.warn("无法从用户首句生成兜底标题", {
        action: "session_title.fallback_empty",
        runId: options.runId,
        sessionId: options.sessionId
      });
      return;
    }
    // 从 generateAndSaveTitle 的 catch 路径调用，不能再向外 reject，
    // 否则 finally 里等待标题任务会把整条事件流标成失败。
    try {
      await this.writeTitleIfPlaceholder({
        sessionId: options.sessionId,
        title: fallbackTitle,
        placeholderTitle: options.placeholderTitle,
        runId: options.runId,
        emit: options.emit,
        source: "fallback"
      });
    } catch (error) {
      log.warn("兜底标题写入失败，保留占位标题", {
        action: "session_title.fallback_write_failed",
        runId: options.runId,
        sessionId: options.sessionId,
        ...errorToLogFields(error)
      });
    }
  }

  /**
   * 仅当会话标题仍是占位/临时标题(未被用户改动)时才写入,避免 AI/兜底标题或后到的
   * 自动标题覆盖用户在 run 期间手动改过的标题。
   */
  private async writeTitleIfPlaceholder(options: {
    sessionId: string;
    title: string;
    placeholderTitle: string;
    runId: string;
    emit: (event: StreamEvent) => void;
    source: "ai" | "fallback";
  }): Promise<void> {
    const current = await this.store.getSession(options.sessionId);
    if (
      current &&
      current.title !== options.placeholderTitle &&
      current.title !== DEFAULT_SESSION_TITLE
    ) {
      log.info("会话标题已被改动，跳过自动标题覆盖", {
        action: "session_title.skip_changed",
        runId: options.runId,
        sessionId: options.sessionId,
        currentTitle: current.title,
        candidate: options.title,
        source: options.source
      });
      return;
    }
    const session = await this.store.updateSession(options.sessionId, { title: options.title });
    options.emit({ type: "session_updated", runId: options.runId, session });
    log.info("已写入会话标题", {
      action: "session_title.written",
      runId: options.runId,
      sessionId: options.sessionId,
      title: options.title,
      source: options.source
    });
  }

  private async resolveProviderForSession(
    session: Session,
    providerId?: string
  ): Promise<ProviderConfig | undefined> {
    if (providerId) {
      return this.providerRepository.getProvider(providerId);
    }
    if (session.providerId) {
      const provider = await this.providerRepository.getProvider(session.providerId);
      if (provider) {
        return provider;
      }
    }
    return (await this.providerRepository.listProviders()).find((candidate) => candidate.apiKeyRef);
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
      log.warn("读取记忆目录快照失败", {
        action: "memory_snapshot.read_failed",
        dir: this.memoryDir,
        ...errorToLogFields(error)
      });
      return { memory: {} };
    }
  }

  /**
   * 读取项目级指令（AGENTS.md 优先，缺失再用 CLAUDE.md），构造一条不落库的
   * user system-reminder 消息注入对话最前；读取失败只降级为不注入，绝不中断 run。
   */
  private async loadProjectInstructionMessage(
    workspacePath: string
  ): Promise<PiMessage | undefined> {
    try {
      const file = await findInstructionFile(workspacePath);
      if (!file) {
        return undefined;
      }
      log.info("注入项目指令到对话最前", {
        action: "project_instruction.inject",
        filePath: file.filePath,
        truncated: file.truncated
      });
      return buildProjectInstructionMessage(file);
    } catch (error) {
      log.warn("读取项目指令失败，已跳过", {
        action: "project_instruction.read_failed",
        workspacePath,
        ...errorToLogFields(error)
      });
      return undefined;
    }
  }

  /**
   * 构造注入对话最前的「开场 SR 消息」：项目指令（AGENTS.md/CLAUDE.md，最高优先）
   * 在前，可用技能清单的背景上下文在后。均为不落库消息，每个 run 重建。
   */
  private async buildLeadingMessages(input: {
    workspacePath: string;
    skills: ModelVisibleSkill[];
  }): Promise<PiMessage[]> {
    const messages: PiMessage[] = [];
    const projectInstruction = await this.loadProjectInstructionMessage(input.workspacePath);
    if (projectInstruction) {
      messages.push(projectInstruction);
    }
    const contextReminder = buildContextReminderMessage({ skills: input.skills });
    if (contextReminder) {
      messages.push(contextReminder);
    }
    return messages;
  }

  /** 会话第一条用户消息，重试时作为标题来源。 */
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
    enableOcrTool: boolean;
    enabledDeferredToolNames: ReadonlySet<string>;
    signal: AbortSignal;
  }): AsyncGenerator<
    StreamEvent,
    { aborted: boolean; compactedUpToMessageId?: string; usage?: TokenUsage }
  > {
    const rows = await this.store.listMessages(options.session.id);
    const selectedTools = selectAgentTools(options.tools, {
      planPhase: options.planPhase,
      viaFeishu: options.viaFeishu,
      headless: options.headless,
      enableOcr: options.enableOcrTool,
      enabledDeferredToolNames: options.enabledDeferredToolNames
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
      log.debug("上下文未达到自动压缩阈值", {
        action: "auto_compact.skip_under_threshold",
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
      log.warn("上下文超过阈值但没有可压缩历史", {
        action: "auto_compact.no_candidates",
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

    log.info("触发自动上下文压缩", {
      action: "auto_compact.start",
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
      usageCostLedgerService: this.usageCostLedgerService,
      introDelta: "当前上下文已接近模型上限，正在自动压缩较早对话...\n"
    });
    if (result.status === "aborted") {
      log.warn("自动上下文压缩被中止", {
        action: "auto_compact.aborted",
        sessionId: options.session.id,
        runId: options.runId
      });
      return { aborted: true };
    }
    log.info("自动上下文压缩完成", {
      action: "auto_compact.completed",
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

  /** 驱动 pi agent loop，并持续产出翻译后的 StreamEvent。 */
  private async *runPiLoop(options: {
    runId: string;
    sessionId: string;
    projectId: string | null;
    workspacePath: string;
    queue: AsyncEventQueue<StreamEvent>;
    tools: AgentTool<any>[];
    approvedPlans: Map<string, ProposePlanArgs>;
    askUserAnswers: Map<string, AskUserAnswer>;
    provider: Parameters<typeof buildModel>[0];
    maxToolIterations: number;
    apiKey: string;
    accessMode: RunRequest["accessMode"];
    planMode: boolean;
    initialPlanConfirmed: boolean;
    viaFeishu: boolean;
    headless: boolean;
    enableOcrTool: boolean;
    enabledDeferredToolNames: ReadonlySet<string>;
    modelInputModalities: ModelInputModality[];
    systemPrompt: string;
    initialUsage?: TokenUsage;
    compactedUpToMessageId?: string;
    leadingMessages?: PiMessage[];
    sideChatParentSessionId?: string;
    controller: AbortController;
  }): AsyncGenerator<StreamEvent> {
    const queue = options.queue;
    let nextAttemptIndex = options.initialUsage ? 1 : 0;
    let latestAttempt: UsageCostAttempt | undefined;
    const finalizedAttemptIndexes = new Set<number>();
    const finishCurrentAttemptWithError = async (input: {
      stopReason: "error" | "aborted";
      errorMessage?: string;
    }): Promise<void> => {
      if (!latestAttempt || finalizedAttemptIndexes.has(latestAttempt.attemptIndex)) {
        return;
      }
      try {
        await this.usageCostLedgerService.finishAttemptWithError({
          attempt: latestAttempt,
          stopReason: input.stopReason,
          errorMessage: input.errorMessage,
          signalAborted: options.controller.signal.aborted
        });
        finalizedAttemptIndexes.add(latestAttempt.attemptIndex);
      } catch (error) {
        log.error("费用账本错误收口失败", {
          action: "usage_cost.finish_error_failed",
          runId: options.runId,
          sessionId: options.sessionId,
          attemptIndex: latestAttempt.attemptIndex,
          ...errorToLogFields(error)
        });
      }
    };
    const translator = new RunEventTranslator({
      store: this.store,
      queue,
      approvals: this.approvals,
      runId: options.runId,
      sessionId: options.sessionId,
      projectId: options.projectId,
      workspacePath: options.workspacePath,
      accessMode: options.accessMode,
      projectApprovalTrustService: this.projectApprovalTrustService,
      strictApproval: options.headless || options.viaFeishu,
      signal: options.controller.signal,
      model: options.provider.model,
      maxToolIterations: options.maxToolIterations,
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
      onAssistantMessageEnd: async (message) => {
        const attempt = latestAttempt;
        if (!attempt) {
          log.warn("assistant 结束时没有可用费用 attempt，已跳过账本收口", {
            action: "usage_cost.missing_attempt",
            runId: options.runId,
            sessionId: options.sessionId,
            stopReason: message.stopReason
          });
          return;
        }
        if (finalizedAttemptIndexes.has(attempt.attemptIndex)) {
          return;
        }
        try {
          if (message.usage) {
            await this.usageCostLedgerService.finishAttemptWithUsage({
              attempt,
              usage: toTokenUsage(message.usage)
            });
            finalizedAttemptIndexes.add(attempt.attemptIndex);
            return;
          }
          if (message.stopReason === "error" || message.stopReason === "aborted") {
            await this.usageCostLedgerService.finishAttemptWithError({
              attempt,
              stopReason: message.stopReason,
              errorMessage: message.errorMessage,
              signalAborted: options.controller.signal.aborted
            });
            finalizedAttemptIndexes.add(attempt.attemptIndex);
            return;
          }
          log.warn("模型响应缺少 usage，暂保留 pending 费用账本", {
            action: "usage_cost.missing_usage",
            runId: options.runId,
            sessionId: options.sessionId,
            attemptIndex: attempt.attemptIndex,
            stopReason: message.stopReason
          });
        } catch (error) {
          log.error("费用账本 usage 收口失败", {
            action: "usage_cost.finish_usage_failed",
            runId: options.runId,
            sessionId: options.sessionId,
            attemptIndex: attempt.attemptIndex,
            stopReason: message.stopReason,
            ...errorToLogFields(error)
          });
        }
      },
      onPlanApproved: (toolCallId, args) => options.approvedPlans.set(toolCallId, args),
      onAskUserAnswered: (toolCallId, answer) => options.askUserAnswers.set(toolCallId, answer)
    });

    const rows = await this.store.listMessages(options.sessionId);
    const parentRows =
      options.sideChatParentSessionId && options.sideChatParentSessionId !== options.sessionId
        ? await this.store.listMessages(options.sideChatParentSessionId)
        : [];
    if (options.sideChatParentSessionId && options.sideChatParentSessionId !== options.sessionId) {
      log.info("侧边会话运行注入主会话完整历史", {
        action: "side_chat.inject_parent_history",
        runId: options.runId,
        sideSessionId: options.sessionId,
        parentSessionId: options.sideChatParentSessionId,
        parentMessageCount: parentRows.length,
        sideMessageCount: rows.length
      });
    }
    let enableOcrTool = options.enableOcrTool;
    const planPhase = (): PlanPhase => {
      if (!options.planMode) return "none";
      return translator.isPlanConfirmed() ? "execute" : "draft";
    };
    let currentAgentContext: AgentContext = {
      systemPrompt: options.systemPrompt,
      messages: [
        ...(options.leadingMessages ?? []),
        ...buildUncompactedAgentMessages(parentRows),
        ...buildAgentMessages(rows, options.compactedUpToMessageId)
      ],
      tools: selectAgentTools(options.tools, {
        planPhase: planPhase(),
        viaFeishu: options.viaFeishu,
        headless: options.headless,
        enableOcr: enableOcrTool,
        enabledDeferredToolNames: options.enabledDeferredToolNames
      })
    };
    const sequentialToolCount =
      currentAgentContext.tools?.filter((tool) => tool.executionMode === "sequential").length ?? 0;
    log.info("已配置本轮工具并发执行策略", {
      action: "agent.tool_execution_mode",
      runId: options.runId,
      sessionId: options.sessionId,
      toolExecution: "parallel",
      tools: currentAgentContext.tools?.length ?? 0,
      sequentialTools: sequentialToolCount
    });
    const modelStreamOptions = buildModelStreamOptions(options.provider);

    void runAgentLoopContinue(
      currentAgentContext,
      {
        model: buildModel(options.provider),
        ...modelStreamOptions,
        apiKey: options.apiKey,
        onResponse: async (response: ProviderResponse, model: Model<Api>) => {
          if (latestAttempt) {
            this.usageCostLedgerService.recordResponse(latestAttempt, {
              statusCode: response.status,
              receivedResponse: true
            });
            log.debug("已记录模型 HTTP 响应状态", {
              action: "model_response.record_status",
              runId: options.runId,
              sessionId: options.sessionId,
              attemptIndex: latestAttempt.attemptIndex,
              statusCode: response.status,
              model: model.id
            });
          }
          await modelStreamOptions.onResponse?.(response, model);
        },
        // 历史行已经能往返为真实 pi message（见 history.ts），因此 LLM 转换保持原样。
        convertToLlm: async (messages) => {
          const llmMessages = messages as PiMessage[];
          const attemptIndex = nextAttemptIndex++;
          try {
            latestAttempt = await this.usageCostLedgerService.startAttempt({
              runId: options.runId,
              sessionId: options.sessionId,
              attemptIndex,
              provider: options.provider,
              inputSnapshot: {
                systemPrompt: currentAgentContext.systemPrompt,
                messages: llmMessages,
                tools: currentAgentContext.tools ?? []
              }
            });
          } catch (error) {
            log.error("创建模型请求费用 attempt 失败，继续模型调用", {
              action: "usage_cost.start_attempt_failed",
              runId: options.runId,
              sessionId: options.sessionId,
              attemptIndex,
              ...errorToLogFields(error)
            });
          }
          return llmMessages;
        },
        toolExecution: "parallel",
        beforeToolCall: translator.beforeToolCall,
        afterToolCall: (context) =>
          protectToolResultForContext(context, {
            toolResultSpillDir: this.toolResultSpillDir,
            runId: options.runId
          }),
        shouldStopAfterTurn: translator.shouldStopAfterTurn,
        prepareNextTurn: ({ context: currentContext }) => {
          currentAgentContext = {
            ...currentContext,
            tools: selectAgentTools(options.tools, {
              planPhase: planPhase(),
              viaFeishu: options.viaFeishu,
              headless: options.headless,
              enableOcr: enableOcrTool,
              enabledDeferredToolNames: options.enabledDeferredToolNames
            })
          };
          return { context: currentAgentContext };
        },
        getSteeringMessages: async () => {
          const drained = await this.drainSteeringMessages({
            runId: options.runId,
            sessionId: options.sessionId,
            queue,
            modelInputModalities: options.modelInputModalities
          });
          if (drained.enableOcrTool && !enableOcrTool) {
            enableOcrTool = true;
            log.info("运行中引导附件触发 OCR 工具可见", {
              action: "steering.enable_ocr",
              runId: options.runId,
              sessionId: options.sessionId
            });
          }
          // 把本轮累积的动态软提醒(todo 空闲 / 工具异常)作为不落库的 SR 消息注入。
          const reminderMessage = buildReminderMessage(translator.collectReminders());
          if (!reminderMessage) {
            return drained.messages;
          }
          return [...drained.messages, reminderMessage];
        }
      },
      translator.emit,
      options.controller.signal,
      this.streamFn
    )
      .then(async () => {
        if (!translator.finished) {
          const error = "模型循环已结束，但未返回终态事件。";
          log.error("运行缺少终态事件，执行兜底收尾", {
            action: "run.missing_terminal_event",
            runId: options.runId,
            sessionId: options.sessionId,
            aborted: options.controller.signal.aborted,
            errorMessage: error
          });
          try {
            await finishCurrentAttemptWithError({
              stopReason: options.controller.signal.aborted ? "aborted" : "error",
              errorMessage: error
            });
            await translator.finish(
              options.controller.signal.aborted
                ? { status: "aborted" }
                : { status: "failed", error }
            );
          } catch (finishError) {
            queue.fail(finishError);
            return;
          }
        }
        queue.end();
      })
      .catch(async (error) => {
        // pi 会通过 stopReason 报告模型错误；这里的 rejection 属于基础设施失败
        //（持久化或契约误用），要收尾 run，不能让它一直停在 running。
        if (!translator.finished) {
          try {
            await finishCurrentAttemptWithError({
              stopReason: options.controller.signal.aborted ? "aborted" : "error",
              errorMessage: error instanceof Error ? error.message : String(error)
            });
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
        log.error("运行失败", {
          action: "run.infrastructure_failed",
          runId: options.runId,
          sessionId: options.sessionId,
          ...errorToLogFields(error)
        });
        queue.end();
      });

    yield* queue;
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
      log.warn("智能审批裁决异常，降级为人工审批", {
        action: "smart_approval.fallback",
        runId: options.runId,
        toolCallId: options.toolCall.id,
        toolName: options.toolCall.name,
        errorMessage: message,
        ...errorToLogFields(error)
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
      log.warn("技能内容过长，已截断", {
        action: "skill_content.truncated",
        name,
        chars: content.length
      });
      content = `${content.slice(0, MAX_SKILL_RESULT_CHARS)}\n\n（技能说明已截断）`;
    }
    return content;
  }
}

function attachToolSearchTool(
  tools: AgentTool<any>[],
  enabledDeferredToolNames: Set<string>
): AgentTool<any>[] {
  let allTools: AgentTool<any>[] = [];
  allTools = [
    ...tools,
    createToolSearchTool({
      tools: () => allTools,
      enabledDeferredToolNames
    })
  ];
  return allTools;
}

function shouldEnableOcrTool(
  displayAttachments: MessageAttachment[],
  modelInputModalities: ModelInputModality[],
  nativeImageAttachments: RunImageAttachment[]
): boolean {
  const supportsImage = modelInputModalities.includes("image");
  const hasNativeImageInput = nativeImageAttachments.length > 0;
  return displayAttachments.some((attachment) => {
    const kind = attachment.kind.toLowerCase();
    if (kind === "pdf") {
      return true;
    }
    if (kind === "image") {
      return !supportsImage || !hasNativeImageInput;
    }
    return false;
  });
}
