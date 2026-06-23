import {
  messageAttachmentSchema,
  fileChangeSchema,
  providerModelOverridesSchema,
  tokenUsageSchema,
  toolCallApprovalSchema,
  toolCallPreviewSchema,
  type FileChange,
  type Message,
  type MessageAttachment,
  type Project,
  type ProviderConfig,
  type RunRecord,
  type ScheduledTask,
  type Session,
  type SessionSearchResult,
  type TokenUsage,
  type ToolCall
} from "@chengxiaobang/shared";
import type {
  StoredMessage,
  UsageCostEntry,
  UsageStatsSourceRun
} from "./state-store";
import type { Row } from "./sqlite-types";

import { getLogger } from "../logging/logger";

const log = getLogger({ module: "repository/sqlite-mappers" });

export function mapProject(row: Row): Project {
  return {
    id: String(row.id),
    name: String(row.name),
    path: String(row.path),
    ...(row.pinned_at === null || row.pinned_at === undefined
      ? {}
      : { pinnedAt: String(row.pinned_at) }),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

export function mapSession(row: Row): Session {
  const notice = mapSessionNotice(row);
  const pendingAction = mapSessionPendingAction(row);
  return {
    id: String(row.id),
    projectId: row.project_id === null ? null : String(row.project_id),
    title: String(row.title),
    providerId: row.provider_id === null ? undefined : String(row.provider_id),
    accessMode:
      row.access_mode === "full_access"
        ? "full_access"
        : row.access_mode === "smart_approval"
          ? "smart_approval"
          : "approval",
    ...(row.model === null || row.model === undefined ? {} : { model: String(row.model) }),
    ...(row.reasoning_mode === null || row.reasoning_mode === undefined
      ? {}
      : { reasoningMode: row.reasoning_mode as Session["reasoningMode"] }),
    ...(row.compacted_up_to_message_id === null || row.compacted_up_to_message_id === undefined
      ? {}
      : { compactedUpToMessageId: String(row.compacted_up_to_message_id) }),
    ...(row.parent_session_id === null || row.parent_session_id === undefined
      ? {}
      : { parentSessionId: String(row.parent_session_id) }),
    ...(row.fork_message_id === null || row.fork_message_id === undefined
      ? {}
      : { forkMessageId: String(row.fork_message_id) }),
    ...(row.fork_point_message_id === null || row.fork_point_message_id === undefined
      ? {}
      : { forkPointMessageId: String(row.fork_point_message_id) }),
    ...(row.feishu_chat_id === null || row.feishu_chat_id === undefined
      ? {}
      : { feishuChatId: String(row.feishu_chat_id) }),
    ...(row.wechat_chat_id === null || row.wechat_chat_id === undefined
      ? {}
      : { wechatChatId: String(row.wechat_chat_id) }),
    ...(row.side_chat_anchor_message_id === null || row.side_chat_anchor_message_id === undefined
      ? {}
      : { sideChatAnchorMessageId: String(row.side_chat_anchor_message_id) }),
    ...(row.side_chat_parent_session_id === null || row.side_chat_parent_session_id === undefined
      ? {}
      : { sideChatParentSessionId: String(row.side_chat_parent_session_id) }),
    ...(row.pinned_at === null || row.pinned_at === undefined
      ? {}
      : { pinnedAt: String(row.pinned_at) }),
    ...(row.last_viewed_at === null || row.last_viewed_at === undefined
      ? {}
      : { lastViewedAt: String(row.last_viewed_at) }),
    ...(notice ? { notice } : {}),
    ...(pendingAction ? { pendingAction } : {}),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function mapSessionNotice(row: Row): Session["notice"] {
  if (row.notice_failed_run_id !== null && row.notice_failed_run_id !== undefined) {
    return {
      status: "failed",
      runId: String(row.notice_failed_run_id),
      ...(row.notice_failed_error === null || row.notice_failed_error === undefined
        ? {}
        : { error: String(row.notice_failed_error) }),
      updatedAt: String(row.notice_failed_updated_at)
    };
  }
  if (row.notice_completed_run_id !== null && row.notice_completed_run_id !== undefined) {
    return {
      status: "unread",
      runId: String(row.notice_completed_run_id),
      updatedAt: String(row.notice_completed_updated_at)
    };
  }
  return undefined;
}

function mapSessionPendingAction(row: Row): Session["pendingAction"] {
  if (
    row.pending_action_kind === null ||
    row.pending_action_kind === undefined ||
    row.pending_action_run_id === null ||
    row.pending_action_run_id === undefined ||
    row.pending_action_tool_call_id === null ||
    row.pending_action_tool_call_id === undefined ||
    row.pending_action_updated_at === null ||
    row.pending_action_updated_at === undefined
  ) {
    return undefined;
  }
  return {
    kind: row.pending_action_kind === "ask_user" ? "ask_user" : "approval",
    runId: String(row.pending_action_run_id),
    toolCallId: String(row.pending_action_tool_call_id),
    updatedAt: String(row.pending_action_updated_at)
  };
}

export function mapSessionSearchResult(row: Row, query: string): SessionSearchResult {
  const session = mapSession(row);
  if (row.match_type !== "content") {
    return { session, matchType: "title" };
  }
  const role = row.message_role === "assistant" ? "assistant" : "user";
  return {
    session,
    matchType: "content",
    messageId: String(row.message_id),
    role,
    snippet: buildSearchSnippet(String(row.message_content ?? ""), query)
  };
}

export function mapScheduledTask(row: Row): ScheduledTask {
  const kind: ScheduledTask["kind"] = row.kind === "once" ? "once" : "recurring";
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    name: String(row.name),
    prompt: String(row.prompt),
    kind,
    ...(kind === "recurring" && row.cron !== null && row.cron !== undefined && String(row.cron)
      ? { cron: String(row.cron) }
      : {}),
    ...(kind === "once" && row.run_at !== null && row.run_at !== undefined
      ? { runAt: String(row.run_at) }
      : {}),
    fullAccess: Number(row.full_access) === 1,
    enabled: Number(row.enabled) === 1,
    ...(row.next_run_at === null || row.next_run_at === undefined
      ? {}
      : { nextRunAt: String(row.next_run_at) }),
    ...(row.last_run_at === null || row.last_run_at === undefined
      ? {}
      : { lastRunAt: String(row.last_run_at) }),
    ...(row.last_status === null || row.last_status === undefined
      ? {}
      : { lastStatus: row.last_status as ScheduledTask["lastStatus"] }),
    ...(row.last_error === null || row.last_error === undefined
      ? {}
      : { lastError: String(row.last_error) }),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

export function mapMessage(row: Row): StoredMessage {
  const kind = row.kind === "compaction_summary" ? ("compaction_summary" as const) : undefined;
  const attachments = parseMessageAttachments(row.attachments);
  const reasoning =
    row.reasoning === null || row.reasoning === undefined ? undefined : String(row.reasoning);
  const reasoningMs =
    row.reasoning_ms === null || row.reasoning_ms === undefined
      ? undefined
      : Number(row.reasoning_ms);
  const durationMs =
    row.duration_ms === null || row.duration_ms === undefined
      ? undefined
      : Number(row.duration_ms);
  const feedback = row.feedback === "up" || row.feedback === "down" ? row.feedback : undefined;
  const payload =
    row.payload === null || row.payload === undefined ? undefined : String(row.payload);
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    role: row.role as Message["role"],
    ...(kind ? { kind } : {}),
    content: String(row.content),
    attachments,
    ...(reasoning !== undefined ? { reasoning } : {}),
    ...(reasoningMs !== undefined ? { reasoningMs } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(feedback !== undefined ? { feedback } : {}),
    ...(payload !== undefined ? { payload } : {}),
    createdAt: String(row.created_at)
  };
}

export function mapRun(row: Row): RunRecord {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    status: row.status as RunRecord["status"],
    ...(row.provider_id === null || row.provider_id === undefined
      ? {}
      : { providerId: String(row.provider_id) }),
    ...(row.provider_kind === null || row.provider_kind === undefined
      ? {}
      : { providerKind: row.provider_kind as RunRecord["providerKind"] }),
    ...(row.model === null || row.model === undefined ? {} : { model: String(row.model) }),
    ...(row.usage ? { usage: parseRunUsage(row.usage) } : {}),
    ...(row.error ? { error: String(row.error) } : {}),
    ...(row.file_changes_json ? { fileChanges: parseFileChanges(row.file_changes_json) } : {}),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

export function mapUsageStatsSourceRun(row: Row): UsageStatsSourceRun {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    status: row.status as RunRecord["status"],
    ...(row.usage ? { usage: parseRunUsage(row.usage) } : {}),
    ...(row.error ? { error: String(row.error) } : {}),
    createdAt: String(row.created_at),
    ...(row.provider_id === null || row.provider_id === undefined
      ? {}
      : { providerId: String(row.provider_id) }),
    ...(row.provider_kind === null || row.provider_kind === undefined
      ? {}
      : { providerKind: row.provider_kind as UsageStatsSourceRun["providerKind"] }),
    ...(row.model === null || row.model === undefined ? {} : { model: String(row.model) }),
    ...(row.fallback_provider_id === null || row.fallback_provider_id === undefined
      ? {}
      : { fallbackProviderId: String(row.fallback_provider_id) }),
    ...(row.session_model === null || row.session_model === undefined
      ? {}
      : { fallbackModel: String(row.session_model) })
  };
}

export function mapUsageCostEntry(row: Row): UsageCostEntry {
  return {
    id: String(row.id),
    runId: String(row.run_id),
    sessionId: String(row.session_id),
    attemptIndex: Number(row.attempt_index),
    ...(row.provider_id === null || row.provider_id === undefined
      ? {}
      : { providerId: String(row.provider_id) }),
    ...(row.provider_kind === null || row.provider_kind === undefined
      ? {}
      : { providerKind: row.provider_kind as UsageCostEntry["providerKind"] }),
    ...(row.model === null || row.model === undefined ? {} : { model: String(row.model) }),
    ...(row.status_code === null || row.status_code === undefined
      ? {}
      : { statusCode: Number(row.status_code) }),
    ...(row.error_code === null || row.error_code === undefined
      ? {}
      : { errorCode: String(row.error_code) }),
    ...(row.error_message === null || row.error_message === undefined
      ? {}
      : { errorMessage: String(row.error_message) }),
    promptTokens: Number(row.prompt_tokens),
    completionTokens: Number(row.completion_tokens),
    cachedPromptTokens: Number(row.cached_prompt_tokens),
    totalTokens: Number(row.total_tokens),
    inputEstimatedTokens: Number(row.input_estimated_tokens),
    costUsd: Number(row.cost_usd),
    costCny: Number(row.cost_cny),
    costSource: row.cost_source as UsageCostEntry["costSource"],
    tokenCountSource: row.token_count_source as UsageCostEntry["tokenCountSource"],
    billable: Number(row.billable) === 1,
    entryCreatedAt: String(row.entry_created_at),
    recordedAt: String(row.recorded_at)
  };
}

export function mapToolCall(row: Row): ToolCall {
  return {
    id: String(row.id),
    runId: String(row.run_id),
    name: row.name as ToolCall["name"],
    args: JSON.parse(String(row.args_json)) as Record<string, unknown>,
    status: row.status as ToolCall["status"],
    result: row.result === null ? undefined : String(row.result),
    ...(row.preview_json === null || row.preview_json === undefined
      ? {}
      : { preview: parseToolCallPreview(row.preview_json) }),
    ...(row.file_change_json === null || row.file_change_json === undefined
      ? {}
      : { fileChange: parseFileChange(row.file_change_json) }),
    ...(row.approval_json === null || row.approval_json === undefined
      ? {}
      : { approval: parseToolCallApproval(row.approval_json) }),
    ...(row.started_at === null || row.started_at === undefined
      ? {}
      : { startedAt: String(row.started_at) }),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

export function mapProvider(row: Row): ProviderConfig {
  return {
    id: String(row.id),
    kind: row.kind as ProviderConfig["kind"],
    name: String(row.name),
    baseURL: String(row.base_url),
    model: String(row.model),
    ...(row.models === null || row.models === undefined
      ? {}
      : { models: parseProviderModels(String(row.models), String(row.id)) }),
    ...(row.model_overrides === null || row.model_overrides === undefined
      ? {}
      : {
          modelOverrides: parseProviderModelOverrides(
            String(row.model_overrides),
            String(row.id)
          )
        }),
    ...(row.reasoning_mode === null || row.reasoning_mode === undefined
      ? {}
      : { reasoningMode: row.reasoning_mode as ProviderConfig["reasoningMode"] }),
    apiKeyRef: row.api_key_ref === null ? undefined : String(row.api_key_ref),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function parseProviderModelOverrides(
  raw: string,
  providerId: string
): ProviderConfig["modelOverrides"] | undefined {
  try {
    return providerModelOverridesSchema.parse(JSON.parse(raw));
  } catch (error) {
    log.warn(
      `[sqlite-state-store] 解析 providers.model_overrides 失败 providerId=${providerId} error=${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return undefined;
  }
}

function buildSearchSnippet(content: string, query: string): string {
  const maxLength = 96;
  const lowerContent = content.toLocaleLowerCase();
  const lowerQuery = query.toLocaleLowerCase();
  const index = lowerContent.indexOf(lowerQuery);
  const start = Math.max(0, index === -1 ? 0 : index - 32);
  const end = Math.min(content.length, start + maxLength);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < content.length ? "..." : "";
  return `${prefix}${content.slice(start, end).trim()}${suffix}`;
}

function parseMessageAttachments(value: unknown): MessageAttachment[] {
  if (value === null || value === undefined) {
    return [];
  }
  try {
    const parsed = JSON.parse(String(value));
    return zodMessageAttachments(parsed);
  } catch (error) {
    log.warn("[sqlite-state-store] 消息附件 JSON 解析失败，已按空附件处理", {
      error: error instanceof Error ? error.message : String(error)
    });
    return [];
  }
}

function zodMessageAttachments(value: unknown): MessageAttachment[] {
  return messageAttachmentSchema.array().parse(value);
}

function parseRunUsage(value: unknown): TokenUsage | undefined {
  try {
    return tokenUsageSchema.parse(JSON.parse(String(value)));
  } catch (error) {
    log.warn("[state-store] 解析 run usage 失败", { error });
    return undefined;
  }
}

function parseFileChange(value: unknown): FileChange | undefined {
  try {
    return fileChangeSchema.parse(JSON.parse(String(value)));
  } catch (error) {
    log.warn("[state-store] 解析 tool_call fileChange 失败", {
      error: error instanceof Error ? error.message : String(error)
    });
    return undefined;
  }
}

function parseFileChanges(value: unknown): FileChange[] | undefined {
  try {
    return fileChangeSchema.array().parse(JSON.parse(String(value)));
  } catch (error) {
    log.warn("[state-store] 解析 run fileChanges 失败", {
      error: error instanceof Error ? error.message : String(error)
    });
    return undefined;
  }
}

function parseToolCallApproval(value: unknown): ToolCall["approval"] {
  try {
    return toolCallApprovalSchema.parse(JSON.parse(String(value)));
  } catch (error) {
    log.warn("[state-store] 解析 tool_call approval 失败", { error });
    return undefined;
  }
}

function parseToolCallPreview(value: unknown): ToolCall["preview"] {
  try {
    return toolCallPreviewSchema.parse(JSON.parse(String(value)));
  } catch (error) {
    log.warn("[state-store] 解析 tool_call preview 失败", {
      error: error instanceof Error ? error.message : String(error)
    });
    return undefined;
  }
}

function parseProviderModels(raw: string, providerId: string): string[] | undefined {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
      return parsed;
    }
    log.warn(`[sqlite-state-store] providers.models 不是字符串数组 providerId=${providerId}`);
    return undefined;
  } catch (error) {
    log.warn(
      `[sqlite-state-store] 解析 providers.models 失败 providerId=${providerId} error=${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return undefined;
  }
}
