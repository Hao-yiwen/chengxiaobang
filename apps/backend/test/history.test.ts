import { describe, expect, it } from "vitest";
import type { AssistantMessage, ToolResultMessage } from "@earendil-works/pi-ai";
import { buildAgentMessages } from "../src/agent/history";
import type { StoredMessage } from "../src/repository/state-store";

let counter = 0;
function row(input: Partial<StoredMessage> & Pick<StoredMessage, "role" | "content">): StoredMessage {
  counter += 1;
  return {
    id: input.id ?? `msg_${counter}`,
    sessionId: "session_1",
    createdAt: input.createdAt ?? new Date(1700000000000 + counter * 1000).toISOString(),
    ...input
  };
}

function assistantPayload(
  blocks: AssistantMessage["content"],
  stopReason: AssistantMessage["stopReason"] = "stop"
): string {
  const message: AssistantMessage = {
    role: "assistant",
    content: blocks,
    api: "openai-completions",
    provider: "deepseek",
    model: "deepseek-v4-flash",
    usage: {
      input: 1,
      output: 2,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 3,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    },
    stopReason,
    timestamp: 1700000000000
  };
  return JSON.stringify(message);
}

function toolResultPayload(toolCallId: string, text: string): string {
  const message: ToolResultMessage = {
    role: "toolResult",
    toolCallId,
    toolName: "Read",
    content: [{ type: "text", text }],
    isError: false,
    timestamp: 1700000000000
  };
  return JSON.stringify(message);
}

describe("buildAgentMessages", () => {
  it("replays payload rows losslessly, keeping toolCall/toolResult pairs", () => {
    const rows: StoredMessage[] = [
      row({ role: "user", content: "读一下 a.txt" }),
      row({
        role: "assistant",
        content: "",
        payload: assistantPayload(
          [{ type: "toolCall", id: "call_1", name: "Read", arguments: { file_path: "a.txt" } }],
          "toolUse"
        )
      }),
      row({ role: "tool", content: "内容", payload: toolResultPayload("call_1", "内容") }),
      row({
        role: "assistant",
        content: "文件内容是：内容",
        payload: assistantPayload([{ type: "text", text: "文件内容是：内容" }])
      })
    ];

    const history = buildAgentMessages(rows);

    expect(history.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "toolResult",
      "assistant"
    ]);
    const assistant = history[1] as AssistantMessage;
    expect(assistant.content[0]).toMatchObject({ type: "toolCall", id: "call_1" });
    expect(history[2]).toMatchObject({ role: "toolResult", toolCallId: "call_1" });
  });

  it("falls back to plain messages for legacy rows without payload", () => {
    const rows: StoredMessage[] = [
      row({ role: "user", content: "你好" }),
      row({ role: "assistant", content: "你好，有什么可以帮你？" }),
      row({ role: "tool", content: "file a.txt" })
    ];

    const history = buildAgentMessages(rows);

    expect(history[0]).toMatchObject({ role: "user", content: "你好" });
    expect(history[1]).toMatchObject({
      role: "assistant",
      content: [{ type: "text", text: "你好，有什么可以帮你？" }]
    });
    // 没有 payload 的 tool 行来自旧数据或异常路径，只能作为 user 上下文回放；
    // 孤儿 toolResult 会被 provider 拒收。
    expect(history[2]).toMatchObject({ role: "user", content: "【工具结果】\nfile a.txt" });
  });

  it("synthesizes an error tool result for dangling toolCalls (aborted runs)", () => {
    const rows: StoredMessage[] = [
      row({ role: "user", content: "执行" }),
      row({
        role: "assistant",
        content: "",
        payload: assistantPayload(
          [{ type: "toolCall", id: "call_lost", name: "Bash", arguments: { command: "ls" } }],
          "toolUse"
        )
      })
    ];

    const history = buildAgentMessages(rows);

    expect(history).toHaveLength(3);
    expect(history[2]).toMatchObject({
      role: "toolResult",
      toolCallId: "call_lost",
      isError: true,
      content: [{ type: "text", text: "（运行中止，无结果）" }]
    });
  });

  it("drops tool results whose assistant turn is missing", () => {
    const rows: StoredMessage[] = [
      row({ role: "user", content: "hi" }),
      row({ role: "tool", content: "孤儿", payload: toolResultPayload("call_gone", "孤儿") })
    ];

    const history = buildAgentMessages(rows);

    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ role: "user", content: "hi" });
  });

  it("hoists the latest compaction summary and hides rows behind the pointer", () => {
    const rows: StoredMessage[] = [
      row({ id: "old_1", role: "user", content: "旧消息一" }),
      row({ id: "old_2", role: "assistant", content: "旧回复" }),
      row({ role: "assistant", kind: "compaction_summary", content: "旧摘要" }),
      row({ role: "assistant", kind: "compaction_summary", content: "新摘要" }),
      row({ role: "user", content: "新消息" })
    ];

    const history = buildAgentMessages(rows, "old_2");

    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({ role: "user", content: "【此前对话的摘要】\n新摘要" });
    expect(history[1]).toMatchObject({ role: "user", content: "新消息" });
  });

  it("skips system rows and survives corrupt payloads", () => {
    const rows: StoredMessage[] = [
      row({ role: "system", content: "ignore me" }),
      row({ role: "assistant", content: "正文", payload: "{broken json" })
    ];

    const history = buildAgentMessages(rows);

    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      role: "assistant",
      content: [{ type: "text", text: "正文" }]
    });
  });
});
