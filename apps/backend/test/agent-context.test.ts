import { describe, expect, it } from "vitest";
import type { Message } from "@chengxiaobang/shared";
import {
  buildCompactionRequest,
  buildHistory,
  buildSystemPrompt
} from "../src/agent/agent-context";

function message(role: Message["role"], content: string, kind?: Message["kind"]): Message {
  return {
    id: `m_${content}`,
    sessionId: "s",
    role,
    ...(kind ? { kind } : {}),
    content,
    createdAt: "2026-01-01T00:00:00Z"
  };
}

describe("buildSystemPrompt", () => {
  it("includes the workspace, project name and access guidance", () => {
    const prompt = buildSystemPrompt({
      workspacePath: "/tmp/proj",
      accessMode: "approval",
      projectName: "demo"
    });
    expect(prompt).toContain("/tmp/proj");
    expect(prompt).toContain("demo");
    expect(prompt).toContain("审批模式");
    expect(prompt).toContain("create_pptx");
  });

  it("describes full access mode", () => {
    const prompt = buildSystemPrompt({ workspacePath: "/w", accessMode: "full_access" });
    expect(prompt).toContain("完全访问模式");
  });
});

describe("buildHistory", () => {
  it("maps tool messages to user context and drops system messages", () => {
    const history = buildHistory([
      message("system", "ignored"),
      message("user", "你好"),
      message("assistant", "好的"),
      message("tool", "已写入 a.txt")
    ]);
    expect(history).toEqual([
      { role: "user", content: "你好" },
      { role: "assistant", content: "好的" },
      { role: "user", content: "【工具结果】\n已写入 a.txt" }
    ]);
  });

  it("replaces compacted messages with the hoisted summary", () => {
    const history = buildHistory(
      [
        message("user", "旧问题"),
        message("assistant", "旧回答"),
        message("assistant", "压缩摘要内容", "compaction_summary"),
        message("user", "新问题"),
        message("assistant", "新回答")
      ],
      "m_旧回答"
    );
    expect(history).toEqual([
      { role: "user", content: "【此前对话的摘要】\n压缩摘要内容" },
      { role: "user", content: "新问题" },
      { role: "assistant", content: "新回答" }
    ]);
  });

  it("uses the latest summary when compacted twice", () => {
    const history = buildHistory(
      [
        message("user", "一"),
        message("assistant", "第一次摘要", "compaction_summary"),
        message("user", "二"),
        message("assistant", "第二次摘要", "compaction_summary"),
        message("user", "三")
      ],
      "m_二"
    );
    expect(history).toEqual([
      { role: "user", content: "【此前对话的摘要】\n第二次摘要" },
      { role: "user", content: "三" }
    ]);
  });

  it("keeps the full history when no compaction pointer is set", () => {
    const history = buildHistory([message("user", "你好")], undefined);
    expect(history).toEqual([{ role: "user", content: "你好" }]);
  });
});

describe("buildCompactionRequest", () => {
  it("wraps the transcript with the summarizer instructions", () => {
    const request = buildCompactionRequest([
      { role: "user", content: "做个 PPT" },
      { role: "assistant", content: "已生成 deck.pptx" }
    ]);
    expect(request).toHaveLength(2);
    expect(request[0].role).toBe("system");
    expect(request[0].content).toContain("摘要");
    expect(request[1].role).toBe("user");
    expect(request[1].content).toContain("[user]\n做个 PPT");
    expect(request[1].content).toContain("[assistant]\n已生成 deck.pptx");
  });
});
