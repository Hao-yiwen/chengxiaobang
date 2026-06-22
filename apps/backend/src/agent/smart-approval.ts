import { completeSimple, type AssistantMessage } from "@earendil-works/pi-ai";
import { z } from "zod";
import {
  nowIso,
  getCatalogModelOptions,
  resolveProviderModelOption,
  type ProviderConfig,
  type ProviderModelOption,
  type ToolCallApproval
} from "@chengxiaobang/shared";
import { buildModel, buildModelStreamOptions } from "../model/pi-model";
import { assessToolApprovalRisk } from "../tools/approval-policy";

import { getLogger } from "../logging/logger";

const log = getLogger({ module: "agent/smart-approval" });

const SMART_APPROVAL_TIMEOUT_MS = 8_000;
const SMART_APPROVAL_MAX_TOKENS = 64;

const modelDecisionSchema = z.object({
  approved: z.boolean()
});

export interface SmartApprovalInput {
  runId: string;
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  workspacePath: string;
  provider: ProviderConfig;
  apiKey: string;
  signal: AbortSignal;
}

export type SmartApprovalJudge = (input: SmartApprovalInput) => Promise<ToolCallApproval>;

export function createSmartApprovalJudge(): SmartApprovalJudge {
  return decideSmartApproval;
}

export async function decideSmartApproval(input: SmartApprovalInput): Promise<ToolCallApproval> {
  const rule = ruleDecision(input.toolName, input.args, input.workspacePath);
  if (rule) {
    log.info("[smart-approval] 规则裁决完成", {
      runId: input.runId,
      toolCallId: input.toolCallId,
      toolName: input.toolName,
      verdict: rule.verdict,
      risk: rule.risk,
      score: rule.score,
      reason: rule.reason
    });
    return rule;
  }

  const timeout = withTimeout(input.signal, SMART_APPROVAL_TIMEOUT_MS);
  try {
    const approvalProvider = buildSmartApprovalProvider(input.provider);
    log.info("[smart-approval] 开始模型裁决", {
      runId: input.runId,
      toolCallId: input.toolCallId,
      toolName: input.toolName,
      providerId: input.provider.id,
      sourceModel: input.provider.model,
      sourceReasoningMode: input.provider.reasoningMode ?? "default",
      approvalModel: approvalProvider.model,
      approvalReasoningMode: approvalProvider.reasoningMode ?? "none"
    });
    const message = await completeSimple(
      buildModel(approvalProvider),
      {
        systemPrompt: SMART_APPROVAL_SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: JSON.stringify({
              workspacePath: input.workspacePath,
              toolName: input.toolName,
              args: input.args
            }),
            timestamp: Date.now()
          }
        ],
        tools: []
      },
      {
        ...buildModelStreamOptions(approvalProvider),
        apiKey: input.apiKey,
        temperature: 0,
        maxTokens: SMART_APPROVAL_MAX_TOKENS,
        timeoutMs: SMART_APPROVAL_TIMEOUT_MS,
        signal: timeout.signal
      }
    );
    const decision = normalizeModelDecision(parseModelDecision(message));
    log.info("[smart-approval] 模型裁决完成", {
      runId: input.runId,
      toolCallId: input.toolCallId,
      toolName: input.toolName,
      verdict: decision.verdict
    });
    return decision;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.warn("[smart-approval] 模型裁决失败，升级人工审批", {
      runId: input.runId,
      toolCallId: input.toolCallId,
      toolName: input.toolName,
      error: message
    });
    return approval("fallback", "ask_user", "high", 0.85, `智能审批失败，已交给你确认：${message}`);
  } finally {
    timeout.dispose();
  }
}

export function buildSmartApprovalProvider(provider: ProviderConfig): ProviderConfig {
  const candidates = smartApprovalModelCandidates(provider);
  const selected = candidates[0] ?? resolveProviderModelOption(provider.kind, provider.model);
  const next: ProviderConfig = {
    ...provider,
    model: selected.id
  };
  if (selected.reasoningModes.includes("off")) {
    next.reasoningMode = "off";
  } else {
    delete next.reasoningMode;
  }
  return next;
}

function smartApprovalModelCandidates(provider: ProviderConfig): ProviderModelOption[] {
  const ids = new Set<string>();
  if (provider.models && provider.models.length > 0) {
    for (const id of provider.models) {
      ids.add(id);
    }
  } else {
    for (const option of getCatalogModelOptions(provider.kind)) {
      ids.add(option.id);
    }
    ids.add(provider.model);
  }

  const options = [...ids]
    .map((id) => resolveProviderModelOption(provider.kind, id))
    .filter((option) => option.inputModalities.includes("text"));
  const controllable = options.filter(
    (option) =>
      option.reasoningAlwaysOn !== true &&
      (option.reasoningModes.length === 0 || option.reasoningModes.includes("off"))
  );
  const pool = controllable.length > 0 ? controllable : options;
  return pool.sort(compareSmartApprovalModels);
}

function compareSmartApprovalModels(
  left: ProviderModelOption,
  right: ProviderModelOption
): number {
  return smartApprovalModelScore(left) - smartApprovalModelScore(right);
}

function smartApprovalModelScore(option: ProviderModelOption): number {
  const price =
    option.pricing?.inputCostPerMillion !== undefined ||
    option.pricing?.outputCostPerMillion !== undefined
      ? (option.pricing.inputCostPerMillion ?? 0) + (option.pricing.outputCostPerMillion ?? 0)
      : 1_000;
  const normalized = `${option.id} ${option.label ?? ""}`.toLowerCase();
  const fastNameBonus = /\b(flash|turbo|mini|lite)\b/.test(normalized) ? -10 : 0;
  const heavyNamePenalty = /\b(pro|max|code)\b/.test(normalized) ? 10 : 0;
  const reasoningPenalty = option.reasoningAlwaysOn ? 100 : 0;
  return price + fastNameBonus + heavyNamePenalty + reasoningPenalty;
}

function ruleDecision(
  toolName: string,
  args: Record<string, unknown>,
  workspacePath: string
): ToolCallApproval | undefined {
  const assessment = assessToolApprovalRisk(toolName, args, { workspacePath });
  if (!assessment.requiresGate) {
    return approval("rule", "allow", assessment.risk, 0.1, assessment.reason);
  }
  if (assessment.smartVerdict) {
    return approval(
      "rule",
      assessment.smartVerdict,
      assessment.risk,
      assessment.smartVerdict === "deny" ? 0.95 : 0.8,
      assessment.reason
    );
  }
  return undefined;
}

function parseModelDecision(message: AssistantMessage): z.infer<typeof modelDecisionSchema> {
  if (message.stopReason !== "stop") {
    throw new Error(message.errorMessage ?? `模型裁决未正常结束：${message.stopReason}`);
  }
  const text = message.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("")
    .trim();
  const json = extractJsonObject(text);
  return modelDecisionSchema.parse(JSON.parse(json));
}

function normalizeModelDecision(
  decision: z.infer<typeof modelDecisionSchema>
): ToolCallApproval {
  return decision.approved
    ? approval("model", "allow", "low", 0.1, "智能审批同意执行。")
    : approval("model", "deny", "high", 0.9, "智能审批不同意执行。");
}

function extractJsonObject(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("模型未返回 JSON 对象");
  }
  return text.slice(start, end + 1);
}

function approval(
  source: ToolCallApproval["source"],
  verdict: ToolCallApproval["verdict"],
  risk: ToolCallApproval["risk"],
  score: number,
  reason: string
): ToolCallApproval {
  return {
    kind: "smart",
    source,
    verdict,
    risk,
    score,
    reason: truncateReason(reason),
    decidedAt: nowIso()
  };
}

function truncateReason(reason: string): string {
  const normalized = reason.trim().replace(/\s+/g, " ");
  return normalized.length > 240 ? `${normalized.slice(0, 240)}...` : normalized;
}

function withTimeout(parent: AbortSignal, ms: number): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const abort = () => controller.abort(parent.reason);
  if (parent.aborted) {
    abort();
  } else {
    parent.addEventListener("abort", abort, { once: true });
  }
  const timer = setTimeout(() => controller.abort(new Error("智能审批超时")), ms);
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      parent.removeEventListener("abort", abort);
    }
  };
}

const SMART_APPROVAL_SYSTEM_PROMPT = [
  "你是程小帮的工具智能审批裁决器，只评估一次本地工具调用是否可以自动执行。",
  "必须只输出 JSON 对象，不要 Markdown，不要解释额外文字。",
  'JSON 形状只能是：{"approved":true} 或 {"approved":false}。',
  "true 用于普通开发操作、局部可恢复的工作区内操作、创建普通项目文件、精确小范围编辑、运行开发/测试/构建/查看类命令。",
  "false 只用于明显破坏性、不可恢复、越权、泄露密钥、外部副作用、安装发布、批量删除或系统级操作。",
  "不要输出风险分、理由或审批意见；没有明确命中 false 条件时输出 true。"
].join("\n");
