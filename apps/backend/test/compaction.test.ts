import { describe, expect, it } from "vitest";
import { buildCompactionContext } from "../src/agent/compaction";
import type { StoredMessage } from "../src/repository/state-store";

function row(
  role: StoredMessage["role"],
  content: string,
  kind?: StoredMessage["kind"]
): StoredMessage {
  return {
    id: `m_${content}`,
    sessionId: "s",
    role,
    ...(kind ? { kind } : {}),
    content,
    createdAt: "2026-01-01T00:00:00Z"
  };
}

describe("buildCompactionContext", () => {
  it("builds a summarizer request over the transcript", () => {
    const context = buildCompactionContext([
      row("user", "你好"),
      row("assistant", "好的"),
      row("tool", "已写入 a.txt")
    ]);

    expect(context.systemPrompt).toContain("对话压缩器");
    expect(context.messages).toHaveLength(1);
    const transcript = context.messages[0];
    expect(transcript.role).toBe("user");
    expect(transcript.content).toContain("[user]\n你好");
    expect(transcript.content).toContain("[assistant]\n好的");
    // Tool rows fold into user context, mirroring the chat history rebuild.
    expect(transcript.content).toContain("【工具结果】\n已写入 a.txt");
  });

  it("hoists only the latest previous summary and skips system rows", () => {
    const context = buildCompactionContext([
      row("assistant", "旧摘要", "compaction_summary"),
      row("assistant", "新摘要", "compaction_summary"),
      row("system", "忽略我"),
      row("user", "继续")
    ]);

    const transcript = String(context.messages[0].content);
    expect(transcript).toContain("【此前对话的摘要】\n新摘要");
    expect(transcript).not.toContain("旧摘要");
    expect(transcript).not.toContain("忽略我");
  });
});
