import type {
  AssistantMessage,
  Message as PiMessage,
  ToolResultMessage,
  UserMessage
} from "@earendil-works/pi-ai";
import type { StoredMessage } from "../repository/state-store";

/**
 * Rebuild the pi conversation for a session from persisted rows.
 *
 * Rows written by the pi loop carry the raw pi message JSON in `payload` and
 * replay losslessly (assistant toolCall blocks stay paired with their
 * toolResult messages). Legacy rows and direct slash-command results fall back
 * to plain text. After a /compact, rows up to and including
 * `compactedUpToMessageId` are replaced by the latest compaction summary,
 * hoisted to the front as a user block.
 */
export function buildAgentMessages(
  rows: StoredMessage[],
  compactedUpToMessageId?: string
): PiMessage[] {
  const summary = [...rows].reverse().find((row) => row.kind === "compaction_summary");
  const cutoffIndex = compactedUpToMessageId
    ? rows.findIndex((row) => row.id === compactedUpToMessageId)
    : -1;

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
