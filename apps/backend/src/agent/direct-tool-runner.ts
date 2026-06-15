import { type AgentTool } from "@earendil-works/pi-agent-core";
import {
  createId,
  nowIso,
  type ProviderConfig,
  type RunRequest,
  type StreamEvent,
  type ToolCall,
  type ToolCallApproval
} from "@chengxiaobang/shared";
import type { StateStore } from "../repository/state-store";
import { assessToolApprovalRisk } from "../tools/approval-policy";
import type { ToolRequest } from "../tools/direct-commands";
import { findTool, requiresApproval } from "../tools/registry";
import { ApprovalQueue, normalizeDecision } from "./approval-queue";
import {
  markSmartApprovalUserDecision,
  toolResultText
} from "./agent-runner-messages";
import type { ProjectApprovalTrustService } from "./project-approval-trust";
import { protectAgentToolResult } from "./tool-result-spill";

export interface DirectToolSmartApprovalInput {
  runId: string;
  toolCall: ToolCall;
  workspacePath: string;
  provider: ProviderConfig;
  apiKey: string;
  signal: AbortSignal;
}

interface RunDirectToolOptions {
  store: StateStore;
  approvals: ApprovalQueue;
  runId: string;
  sessionId: string;
  projectId: string | null;
  request: ToolRequest;
  tools: AgentTool<any>[];
  workspacePath: string;
  accessMode: RunRequest["accessMode"];
  projectApprovalTrustService?: ProjectApprovalTrustService;
  provider: ProviderConfig;
  apiKey: string;
  signal: AbortSignal;
  strictApproval?: boolean;
  decideSmartApproval(input: DirectToolSmartApprovalInput): Promise<ToolCallApproval>;
}

export async function* runDirectTool(
  options: RunDirectToolOptions
): AsyncGenerator<StreamEvent, "ok" | "aborted" | "failed"> {
  yield {
    type: "delta",
    runId: options.runId,
    channel: "thinking",
    delta: "正在准备本地工具调用...\n"
  };
  const tool = findTool(options.tools, options.request.name);
  const risk = assessToolApprovalRisk(options.request.name, options.request.args, {
    workspacePath: options.workspacePath
  });
  const strictApproval = options.strictApproval ?? false;
  const requiresGate =
    risk.requiresGate || (strictApproval && requiresApproval(options.request.name));
  const projectTrusted =
    requiresGate &&
    options.accessMode === "approval" &&
    (await isProjectTrusted(options, options.request.name, options.request.args));
  const needsManualApproval =
    requiresGate && options.accessMode === "approval" && !projectTrusted;
  const needsSmartApproval = requiresGate && options.accessMode === "smart_approval";
  const initialStatus = needsManualApproval
    ? "pending_approval"
    : needsSmartApproval
      ? "pending_smart_approval"
      : "running";
  const initial: ToolCall = {
    id: createId("tool"),
    runId: options.runId,
    name: options.request.name,
    args: options.request.args,
    status: initialStatus,
    ...(initialStatus === "running" ? { startedAt: nowIso() } : {}),
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  await options.store.insertToolCall(initial);
  console.info("[agent-runner] 直接工具审批策略", {
    runId: options.runId,
    toolCallId: initial.id,
    toolName: options.request.name,
    status: initial.status,
    accessMode: options.accessMode,
    risk: risk.risk,
    requiresGate,
    projectTrusted,
    reason: risk.reason
  });
  yield { type: "tool_call", runId: options.runId, toolCall: initial };

  let runnable = initial;
  if (initial.status === "pending_smart_approval") {
    const decision = await options.decideSmartApproval({
      runId: options.runId,
      toolCall: initial,
      workspacePath: options.workspacePath,
      provider: options.provider,
      apiKey: options.apiKey,
      signal: options.signal
    });
    if (decision.verdict === "deny") {
      const rejected = await options.store.updateToolCall({
        ...initial,
        status: "rejected",
        approval: decision,
        result: "智能审批不同意执行该操作",
        updatedAt: nowIso()
      });
      yield { type: "tool_call", runId: options.runId, toolCall: rejected };
      await options.store.updateRunStatus(options.runId, "aborted");
      yield { type: "run_end", runId: options.runId, status: "aborted" };
      return "aborted";
    }
    const trustedAfterSmart =
      decision.verdict === "ask_user" &&
      (await isProjectTrusted(options, options.request.name, options.request.args));
    const effectiveDecision = trustedAfterSmart
      ? {
          ...decision,
          verdict: "allow" as const,
          reason: `${decision.reason} 项目级信任规则已允许。`
        }
      : decision;
    runnable = await options.store.updateToolCall({
      ...initial,
      status: effectiveDecision.verdict === "allow" ? "running" : "pending_approval",
      approval: effectiveDecision,
      ...(effectiveDecision.verdict === "allow" ? { startedAt: nowIso() } : {}),
      updatedAt: nowIso()
    });
    yield { type: "tool_call", runId: options.runId, toolCall: runnable };
  }

  if (runnable.status === "pending_approval") {
    const decision = normalizeDecision(
      options.request.name,
      await options.approvals.wait(runnable.id, options.signal)
    );
    if (!decision.approved) {
      const rejected = await options.store.updateToolCall({
        ...runnable,
        status: "rejected",
        ...(runnable.approval
          ? { approval: markSmartApprovalUserDecision(runnable.approval, false) }
          : {}),
        result: "用户拒绝或运行已中止",
        updatedAt: nowIso()
      });
      yield { type: "tool_call", runId: options.runId, toolCall: rejected };
      await options.store.updateRunStatus(options.runId, "aborted");
      yield { type: "run_end", runId: options.runId, status: "aborted" };
      return "aborted";
    }
    if (decision.approvalScope === "project") {
      await options.projectApprovalTrustService?.trust({
        projectId: options.projectId,
        toolName: options.request.name,
        args: options.request.args
      });
    }
    runnable = await options.store.updateToolCall({
      ...runnable,
      status: "running",
      ...(runnable.approval
        ? { approval: markSmartApprovalUserDecision(runnable.approval, true) }
        : {}),
      startedAt: nowIso(),
      updatedAt: nowIso()
    });
    yield { type: "tool_call", runId: options.runId, toolCall: runnable };
  }

  let completed: ToolCall;
  try {
    if (!tool) {
      throw new Error(`未知工具: ${options.request.name}`);
    }
    const result = await protectAgentToolResult(
      await tool.execute(runnable.id, options.request.args, options.signal),
      {
        workspacePath: options.workspacePath,
        runId: options.runId,
        toolCallId: runnable.id,
        toolName: options.request.name,
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
        workspacePath: options.workspacePath,
        runId: options.runId,
        toolCallId: runnable.id,
        toolName: options.request.name,
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
  await options.store.updateToolCall(completed);
  yield { type: "tool_call", runId: options.runId, toolCall: completed };
  if (options.signal.aborted) {
    console.info("[agent-runner] 直接工具执行期间收到中止，run 以 aborted 结束", {
      runId: options.runId,
      toolCallId: runnable.id,
      toolName: options.request.name,
      toolStatus: completed.status
    });
    await options.store.updateRunStatus(options.runId, "aborted");
    yield { type: "run_end", runId: options.runId, status: "aborted" };
    return "aborted";
  }
  if (completed.status === "failed") {
    const errorText = completed.result ?? "工具调用失败";
    await options.store.updateRunStatus(options.runId, "failed", undefined, errorText);
    yield { type: "run_end", runId: options.runId, status: "failed", error: errorText };
    return "failed";
  }
  await options.store.addMessage({
    sessionId: options.sessionId,
    role: "tool",
    content: completed.result ?? ""
  });
  return "ok";
}

async function isProjectTrusted(
  options: RunDirectToolOptions,
  toolName: string,
  args: Record<string, unknown>
): Promise<boolean> {
  if (!options.projectApprovalTrustService || !isProjectTrustEligible(toolName)) {
    return false;
  }
  return options.projectApprovalTrustService.isTrusted({
    projectId: options.projectId,
    toolName,
    args
  });
}

function isProjectTrustEligible(toolName: string): boolean {
  return toolName !== "AskUserQuestion" && toolName !== "ExitPlanMode";
}
