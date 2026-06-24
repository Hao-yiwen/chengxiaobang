import { describe, expect, it } from "vitest";
import type { Message, Session, ToolCall } from "@chengxiaobang/shared";
import {
  buildSessionMarkdown,
  exportFilename,
  type ExportLabels
} from "../src/renderer/lib/session-export";

const labels: ExportLabels = {
  user: "你",
  assistant: "程小帮",
  toolCall: "工具调用",
  reasoning: "深度思考",
  exportedAt: "导出时间"
};

const session: Session = {
  id: "session_1",
  projectId: null,
  title: "示例会话",
  accessMode: "approval",
  createdAt: "2026-06-08T00:00:00.000Z",
  updatedAt: "2026-06-08T00:00:05.000Z"
};

function message(partial: Partial<Message> & Pick<Message, "id" | "role" | "createdAt">): Message {
  return { sessionId: session.id, content: "", ...partial };
}

const userMessage = message({
  id: "u1",
  role: "user",
  content: "帮我看看目录",
  createdAt: "2026-06-08T00:00:00.000Z"
});
const toolMessage = message({
  id: "t1",
  role: "tool",
  content: "raw tool output row",
  createdAt: "2026-06-08T00:00:01.500Z"
});
const assistantMessage = message({
  id: "a1",
  role: "assistant",
  content: "目录里有 package.json",
  reasoning: "需要先列目录",
  createdAt: "2026-06-08T00:00:02.000Z"
});
const toolCall: ToolCall = {
  id: "tool_1",
  runId: "run_1",
  name: "Glob",
  args: { pattern: "*" },
  status: "completed",
  result: "file package.json",
  createdAt: "2026-06-08T00:00:01.000Z",
  updatedAt: "2026-06-08T00:00:01.000Z"
};

describe("buildSessionMarkdown", () => {
  it("renders title, export time, and the timeline in order", () => {
    const markdown = buildSessionMarkdown(
      session,
      [userMessage, toolMessage, assistantMessage],
      [toolCall],
      labels,
      { now: new Date("2026-06-10T08:00:00.000Z") }
    );

    expect(markdown).toContain("# 示例会话");
    expect(markdown).toContain("> 导出时间: 2026-06-10T08:00:00.000Z");
    // Timeline order: user → tool call → assistant.
    const userIndex = markdown.indexOf("## 你");
    const toolIndex = markdown.indexOf("**工具调用** `Glob` · completed");
    const assistantIndex = markdown.indexOf("## 程小帮");
    expect(userIndex).toBeGreaterThan(-1);
    expect(toolIndex).toBeGreaterThan(userIndex);
    expect(assistantIndex).toBeGreaterThan(toolIndex);
    expect(markdown).toContain("file package.json");
  });

  it("includes reasoning as a quoted block by default and omits it on demand", () => {
    const withReasoning = buildSessionMarkdown(session, [assistantMessage], [], labels);
    expect(withReasoning).toContain("> **深度思考**");
    expect(withReasoning).toContain("> 需要先列目录");

    const without = buildSessionMarkdown(session, [assistantMessage], [], labels, {
      includeReasoning: false
    });
    expect(without).not.toContain("深度思考");
  });

  it("does not render tool-role messages as chat sections", () => {
    const markdown = buildSessionMarkdown(session, [toolMessage], [], labels);
    expect(markdown).not.toContain("raw tool output row");
  });

  it("exports assistant answers without final artifact XML", () => {
    const artifactAnswer = message({
      id: "a_artifact",
      role: "assistant",
      content: "文件已生成。\n\n<artifacts><artifact path=\"page.html\" /></artifacts>",
      createdAt: "2026-06-08T00:00:03.000Z"
    });

    const markdown = buildSessionMarkdown(session, [artifactAnswer], [], labels);

    expect(markdown).toContain("文件已生成。");
    expect(markdown).not.toContain("<artifacts>");
    expect(markdown).not.toContain("page.html");
  });

  it("exports reasoning-only turns as a quote alone, and skips them without reasoning", () => {
    const reasoningOnly = message({
      id: "a2",
      role: "assistant",
      content: "",
      reasoning: "先想清楚",
      createdAt: "2026-06-08T00:00:03.000Z"
    });

    const markdown = buildSessionMarkdown(session, [reasoningOnly], [], labels);
    expect(markdown).toContain("> 先想清楚");
    // 没有正文段落,引用块后不应跟空行正文。
    expect(markdown).not.toMatch(/> 先想清楚\n\n\n/);

    const without = buildSessionMarkdown(session, [reasoningOnly], [], labels, {
      includeReasoning: false
    });
    // 关掉思考导出后,这一轮没有任何可见内容,整节跳过。
    expect(without).not.toContain("## 程小帮");
  });

  it("truncates long tool results", () => {
    const longResult = "x".repeat(500);
    const markdown = buildSessionMarkdown(
      session,
      [],
      [{ ...toolCall, result: longResult }],
      labels
    );
    expect(markdown).toContain(`${"x".repeat(400)}…`);
    expect(markdown).not.toContain("x".repeat(401));
  });
});

describe("exportFilename", () => {
  it("strips path separators and reserved characters, keeping Chinese", () => {
    expect(exportFilename("重构/登录:模块?")).toBe("重构登录模块.md");
    expect(exportFilename('a\\b"c<d>e|f*g')).toBe("abcdefg.md");
  });

  it("falls back to session.md for empty titles", () => {
    expect(exportFilename("")).toBe("session.md");
    expect(exportFilename("///")).toBe("session.md");
  });
});
