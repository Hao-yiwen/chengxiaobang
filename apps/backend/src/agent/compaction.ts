import { streamSimple } from "@earendil-works/pi-ai";
import type { Context } from "@earendil-works/pi-ai";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import type { ProviderConfig, Session, StreamEvent, TokenUsage } from "@chengxiaobang/shared";
import type { StateStore, StoredMessage } from "../repository/state-store";
import { buildModel, buildModelStreamOptions, toTokenUsage } from "../model/pi-model";

/** /compact keeps this many most-recent messages out of the summary. */
const COMPACT_KEEP_RECENT = 4;

const SUMMARIZER_PROMPT = [
  "你是一个对话压缩器。请把下面的对话历史总结成一段精炼的中文摘要，供后续对话作为上下文使用。",
  "摘要必须保留：",
  "- 用户的目标与任务背景",
  "- 已经做出的决定和结论",
  "- 已创建/修改的文件及关键改动",
  "- 尚未解决的问题或待办事项",
  "直接输出摘要正文，不要添加前言或解释。"
].join("\n");

/**
 * Model request asking for a compaction summary — exported so the prompt
 * stays unit-testable without the runner.
 */
export function buildCompactionContext(rows: StoredMessage[]): Context {
  const summary = [...rows].reverse().find((row) => row.kind === "compaction_summary");
  const lines: string[] = [];
  if (summary) {
    lines.push(`[user]\n【此前对话的摘要】\n${summary.content}`);
  }
  for (const row of rows) {
    if (row.kind === "compaction_summary" || row.role === "system") {
      continue;
    }
    if (row.role === "tool") {
      lines.push(`[user]\n【工具结果】\n${row.content}`);
      continue;
    }
    lines.push(`[${row.role}]\n${row.content}`);
  }
  return {
    systemPrompt: SUMMARIZER_PROMPT,
    messages: [{ role: "user", content: lines.join("\n\n"), timestamp: Date.now() }]
  };
}

export function compactableMessages(
  messages: StoredMessage[],
  compactedUpToMessageId?: string
): StoredMessage[] {
  const cutoffIndex = compactedUpToMessageId
    ? messages.findIndex((message) => message.id === compactedUpToMessageId)
    : -1;
  const visible = messages.filter(
    (message, index) => index > cutoffIndex && message.kind !== "compaction_summary"
  );
  return visible.slice(0, Math.max(0, visible.length - COMPACT_KEEP_RECENT));
}

export interface CompactionResult {
  status: "completed" | "aborted";
  compacted: boolean;
  usage?: TokenUsage;
  compactedUpToMessageId?: string;
}

export async function* compactSessionHistory(options: {
  store: StateStore;
  session: Session;
  provider: ProviderConfig;
  apiKey: string;
  runId: string;
  clientRequestId?: string;
  signal: AbortSignal;
  streamFn?: StreamFn;
  emitNoopMessage?: boolean;
  introDelta?: string;
}): AsyncGenerator<StreamEvent, CompactionResult> {
  const { store, session, runId, signal } = options;
  const messages = await store.listMessages(session.id);
  const toSummarize = compactableMessages(messages, session.compactedUpToMessageId);

  if (toSummarize.length === 0) {
    if (options.emitNoopMessage) {
      const notice = await store.addMessage({
        sessionId: session.id,
        role: "assistant",
        content: "当前对话内容较少，无需压缩。"
      });
      yield { type: "message", runId, message: notice };
    }
    return { status: "completed", compacted: false };
  }

  if (options.introDelta) {
    yield { type: "delta", runId, channel: "thinking", delta: options.introDelta };
  }

  // 多次压缩时把旧摘要也纳入新摘要输入，避免较早上下文丢失。
  const summaryRows = messages.filter((message) => message.kind === "compaction_summary");
  const context = buildCompactionContext([...summaryRows, ...toSummarize]);

  const streamFunction = options.streamFn ?? streamSimple;
  const stream = await streamFunction(buildModel(options.provider), context, {
    apiKey: options.apiKey,
    ...buildModelStreamOptions(options.provider),
    signal
  });

  let summaryText = "";
  for await (const event of stream) {
    if (signal.aborted) {
      break;
    }
    if (event.type === "text_delta") {
      summaryText += event.delta;
      yield { type: "delta", runId, channel: "thinking", delta: event.delta };
    } else if (event.type === "thinking_delta") {
      yield { type: "delta", runId, channel: "thinking", delta: event.delta };
    }
  }
  const result = await stream.result();
  if (result.stopReason === "error") {
    throw new Error(result.errorMessage ?? "模型请求失败");
  }

  if (signal.aborted || summaryText.trim().length === 0) {
    return { status: "aborted", compacted: false };
  }

  const summaryMessage = await store.addMessage({
    sessionId: session.id,
    role: "assistant",
    kind: "compaction_summary",
    content: summaryText.trim()
  });
  const compactedUpToMessageId = toSummarize[toSummarize.length - 1].id;
  await store.updateSession(session.id, { compactedUpToMessageId });
  yield { type: "message", runId, message: summaryMessage };
  return {
    status: "completed",
    compacted: true,
    compactedUpToMessageId,
    usage: toTokenUsage(result.usage)
  };
}

/**
 * Summarize older history into a compaction summary message and move the
 * session's compaction pointer, so future runs send [summary + recent
 * messages] instead of the full history.
 */
export async function* runCompaction(options: {
  store: StateStore;
  session: Session;
  provider: ProviderConfig;
  apiKey: string;
  runId: string;
  clientRequestId?: string;
  signal: AbortSignal;
  streamFn?: StreamFn;
}): AsyncGenerator<StreamEvent> {
  const { store, session, runId, signal } = options;
  yield {
    type: "run_started",
    runId,
    sessionId: session.id,
    ...(options.clientRequestId ? { clientRequestId: options.clientRequestId } : {}),
    providerId: options.provider.id,
    model: options.provider.model,
    ...(options.provider.reasoningMode ? { reasoningMode: options.provider.reasoningMode } : {})
  };
  try {
    const result = yield* compactSessionHistory({
      store,
      session,
      provider: options.provider,
      apiKey: options.apiKey,
      runId,
      signal,
      streamFn: options.streamFn,
      emitNoopMessage: true
    });
    if (result.status === "aborted") {
      await store.updateRunStatus(runId, "aborted");
      yield { type: "run_end", runId, status: "aborted" };
      return;
    }
    if (!result.compacted) {
      await store.updateRunStatus(runId, "completed");
      yield { type: "run_end", runId, status: "completed" };
      return;
    }
    await store.updateRunStatus(runId, "completed", result.usage);
    yield { type: "run_end", runId, status: "completed", usage: result.usage };
  } catch (error) {
    const errorText = error instanceof Error ? error.message : String(error);
    await store.updateRunStatus(runId, "failed", undefined, errorText);
    yield {
      type: "run_end",
      runId,
      status: "failed",
      error: errorText
    };
  }
}
