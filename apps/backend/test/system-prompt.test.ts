import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "../src/agent/system-prompt";

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

  it("mentions the feishu tool and adds plain-text guidance for feishu sessions", () => {
    const local = buildSystemPrompt({ workspacePath: "/w", accessMode: "approval" });
    expect(local).toContain("feishu_send_message");
    expect(local).not.toContain("当前对话来自飞书");

    const viaFeishu = buildSystemPrompt({
      workspacePath: "/w",
      accessMode: "approval",
      viaFeishu: true
    });
    expect(viaFeishu).toContain("当前对话来自飞书");
    expect(viaFeishu).toContain("不要调用 feishu_send_message 重复发送你的回复");
  });
});
