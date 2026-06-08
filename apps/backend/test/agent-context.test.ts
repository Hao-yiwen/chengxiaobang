import { describe, expect, it } from "vitest";
import type { Message } from "@chengxiaobang/shared";
import { buildHistory, buildSystemPrompt } from "../src/agent/agent-context";

function message(role: Message["role"], content: string): Message {
  return { id: `m_${content}`, sessionId: "s", role, content, createdAt: "2026-01-01T00:00:00Z" };
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
});
