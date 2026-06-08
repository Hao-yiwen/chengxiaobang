import {
  createId,
  nowIso,
  type Message,
  type RunRequest,
  type StreamEvent,
  type ToolCall
} from "@chengxiaobang/shared";
import { mkdir } from "node:fs/promises";
import type { StateStore } from "../repository/state-store";
import type { SecretStore } from "../secrets/secret-store";
import type { ModelClient } from "../model/openai-compatible";
import { ApprovalQueue } from "./approval-queue";
import {
  parseToolRequest,
  requiresApproval,
  ToolExecutor
} from "../tools/tool-executor";
import { SlashCommandService } from "../tools/slash-command-service";
import { defaultSessionDir } from "../paths";

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
    const projectForPrompt = activeSession.projectId
      ? await this.store.getProject(activeSession.projectId)
      : undefined;
    const expandedPrompt = (await this.slashCommandService.expandPrompt(input.prompt, projectForPrompt))
      .prompt;

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

    let assistantText = "";
    try {
      const project = activeSession.projectId
        ? await this.store.getProject(activeSession.projectId)
        : undefined;
      const workspacePath = project?.path ?? this.sessionWorkspacePath(activeSession.id);
      const toolRequest = parseToolRequest(expandedPrompt);
      if (toolRequest) {
        if (!project) {
          await mkdir(workspacePath, { recursive: true });
        }
        yield { type: "thinking_delta", runId, delta: "正在准备本地工具调用...\n" };
        const initialToolCall: ToolCall = {
          id: createId("tool"),
          runId,
          name: toolRequest.name,
          args: toolRequest.args,
          status: requiresApproval(toolRequest.name) && input.accessMode === "approval"
            ? "pending_approval"
            : "running",
          createdAt: nowIso(),
          updatedAt: nowIso()
        };
        await this.store.insertToolCall(initialToolCall);

        let runnableToolCall = initialToolCall;
        if (initialToolCall.status === "pending_approval") {
          yield { type: "tool_call_pending", runId, toolCall: initialToolCall };
          const approved = await this.approvals.wait(initialToolCall.id, controller.signal);
          if (!approved) {
            const rejected = await this.store.updateToolCall({
              ...initialToolCall,
              status: "rejected",
              result: "用户拒绝或运行已中止",
              updatedAt: nowIso()
            });
            yield { type: "tool_result", runId, toolCall: rejected };
            yield { type: "run_aborted", runId };
            await this.store.updateRunStatus(runId, "aborted");
            return;
          }
          runnableToolCall = await this.store.updateToolCall({
            ...initialToolCall,
            status: "running",
            updatedAt: nowIso()
          });
        }

        yield { type: "tool_call_started", runId, toolCall: runnableToolCall };
        let completed: ToolCall;
        try {
          completed = await this.toolExecutor.execute(runnableToolCall, workspacePath);
        } catch (error) {
          completed = {
            ...runnableToolCall,
            status: "failed",
            result: error instanceof Error ? error.message : String(error),
            updatedAt: nowIso()
          };
        }
        await this.store.updateToolCall(completed);
        yield { type: "tool_result", runId, toolCall: completed };
        if (completed.status === "failed") {
          throw new Error(completed.result ?? "工具调用失败");
        }
        await this.store.addMessage({
          sessionId: activeSession.id,
          role: "tool",
          content: completed.result ?? ""
        });
      }

      const messages = await this.store.listMessages(activeSession.id);
      for await (const delta of this.modelClient.streamCompletion({
        provider: selectedProvider,
        apiKey: selectedApiKey,
        messages,
        signal: controller.signal
      })) {
        if (controller.signal.aborted) {
          yield { type: "run_aborted", runId };
          await this.store.updateRunStatus(runId, "aborted");
          return;
        }
        if (delta.type === "thinking") {
          yield { type: "thinking_delta", runId, delta: delta.delta };
        } else {
          assistantText += delta.delta;
          yield { type: "assistant_delta", runId, delta: delta.delta };
        }
      }

      const message: Message = await this.store.addMessage({
        sessionId: activeSession.id,
        role: "assistant",
        content: assistantText
      });
      yield { type: "assistant_done", runId, message };
      await this.store.updateRunStatus(runId, "completed");
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
}

function createTitle(prompt: string): string {
  const compact = prompt.trim().replace(/\s+/g, " ");
  return compact.length > 24 ? `${compact.slice(0, 24)}...` : compact || "新对话";
}
