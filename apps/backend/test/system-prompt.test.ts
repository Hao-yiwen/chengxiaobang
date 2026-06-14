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
    expect(prompt).toContain("use_skill");
    expect(prompt).toContain("todo_create");
    expect(prompt).toContain("简单问答、小改动或单次工具调用不要创建 todo");
    expect(prompt).toContain("<artifacts><artifact path=\"page.html\" />");
    expect(prompt).toContain("不要放进 Markdown 代码块");
    expect(prompt).not.toContain("create_pptx");
    expect(prompt).not.toContain("create_docx");
    expect(prompt).not.toContain("create_xlsx");
  });

  it("describes full access mode", () => {
    const prompt = buildSystemPrompt({ workspacePath: "/w", accessMode: "full_access" });
    expect(prompt).toContain("完全访问模式");
  });

  it("注入长期记忆段：含协议说明与目录快照，未启用时完全省略", () => {
    const without = buildSystemPrompt({ workspacePath: "/w", accessMode: "approval" });
    expect(without).not.toContain("长期记忆");

    const empty = buildSystemPrompt({ workspacePath: "/w", accessMode: "approval", memory: {} });
    expect(empty).toContain("## 长期记忆");
    expect(empty).toContain("memory 工具");
    expect(empty).toContain("/memories 是虚拟路径前缀");
    expect(empty).toContain("它不是系统根目录下的 /memories");
    expect(empty).toContain("（记忆目录为空）");

    const listed = buildSystemPrompt({
      workspacePath: "/w",
      accessMode: "approval",
      memory: { listing: "32B\t/memories/user.md" }
    });
    expect(listed).toContain("/memories/user.md");
    expect(listed).not.toContain("（记忆目录为空）");
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
    expect(viaFeishu).not.toContain("<artifacts>");
  });
});
