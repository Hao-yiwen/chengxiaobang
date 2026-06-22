import type {
  AssistantMessage,
  Message as PiMessage,
  ToolResultMessage,
  UserMessage
} from "@earendil-works/pi-ai";
import type { StoredMessage } from "../repository/state-store";

/**
 * 从持久化消息行重建 pi 对话。
 *
 * pi 循环写入的行会在 `payload` 保存原始 pi 消息 JSON，因此 assistant
 * toolCall 与 toolResult 能无损配对回放。旧数据或孤儿工具结果行没有 payload，
 * 只能降级为纯文本。执行 /compact 后，`compactedUpToMessageId` 及之前的行
 * 会被最新摘要替代，并以前置 user 块注入模型上下文。
 */
export function buildAgentMessages(
  rows: StoredMessage[],
  compactedUpToMessageId?: string
): PiMessage[] {
  const summary = [...rows].reverse().find((row) => row.kind === "compaction_summary");
  let cutoffIndex = compactedUpToMessageId
    ? rows.findIndex((row) => row.id === compactedUpToMessageId)
    : -1;
  if (compactedUpToMessageId && cutoffIndex === -1) {
    // 压缩指针悬空(指向的消息已被回退删除):降级为截断到最近一条摘要行,
    // 避免 cutoff 失效导致早期历史连同摘要一起被全量回灌模型(可能直接超上限)。
    cutoffIndex = summary ? rows.indexOf(summary) : -1;
    console.warn("[history] compactedUpToMessageId 悬空，降级到最近摘要行", {
      compactedUpToMessageId,
      cutoffIndex
    });
  }

  const history: PiMessage[] = [];
  for (const [index, row] of rows.entries()) {
    if (index <= cutoffIndex || row.kind === "compaction_summary" || row.role === "system") {
      continue;
    }
    const restored = row.payload ? parsePayload(row.payload) : undefined;
    if (restored) {
      history.push(restored);
      continue;
    }
    if (row.role === "tool") {
      history.push(plainUserMessage(`【工具结果】\n${row.content}`, row.createdAt));
      continue;
    }
    if (row.role === "assistant") {
      history.push(plainAssistantMessage(row.content, row.createdAt));
      continue;
    }
    history.push(plainUserMessage(row.content, row.createdAt));
  }

  const repaired = repairToolCallPairs(history);
  if (summary) {
    repaired.unshift(plainUserMessage(`【此前对话的摘要】\n${summary.content}`, summary.createdAt));
  }
  return repaired;
}

function parsePayload(payload: string): PiMessage | undefined {
  try {
    const parsed = JSON.parse(payload) as PiMessage;
    if (parsed.role === "assistant" || parsed.role === "toolResult" || parsed.role === "user") {
      return parsed;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Providers reject toolCall blocks without a matching tool result (an aborted
 * run can persist the assistant turn but not its results) and tool results
 * whose assistant turn is gone. Synthesize the former, drop the latter.
 */
function repairToolCallPairs(history: PiMessage[]): PiMessage[] {
  const answered = new Set(
    history
      .filter((message): message is ToolResultMessage => message.role === "toolResult")
      .map((message) => message.toolCallId)
  );
  const requested = new Set<string>();
  const repaired: PiMessage[] = [];
  for (const message of history) {
    if (message.role === "toolResult") {
      if (!requested.has(message.toolCallId)) {
        continue;
      }
      repaired.push(message);
      continue;
    }
    repaired.push(message);
    if (message.role !== "assistant") {
      continue;
    }
    for (const block of message.content) {
      if (block.type !== "toolCall") {
        continue;
      }
      requested.add(block.id);
      if (!answered.has(block.id)) {
        repaired.push(orphanToolResult(block.id, block.name, message.timestamp));
      }
    }
  }
  return repaired;
}

function orphanToolResult(
  toolCallId: string,
  toolName: string,
  timestamp: number
): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId,
    toolName,
    content: [{ type: "text", text: "（运行中止，无结果）" }],
    isError: true,
    timestamp
  };
}

function plainUserMessage(content: string, createdAt: string): UserMessage {
  return { role: "user", content, timestamp: toTimestamp(createdAt) };
}

function plainAssistantMessage(content: string, createdAt: string): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text: content }],
    api: "openai-completions",
    provider: "history",
    model: "history",
    usage: emptyUsage(),
    stopReason: "stop",
    timestamp: toTimestamp(createdAt)
  };
}

function emptyUsage(): AssistantMessage["usage"] {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
  };
}

function toTimestamp(createdAt: string): number {
  const parsed = Date.parse(createdAt);
  return Number.isNaN(parsed) ? 0 : parsed;
}
