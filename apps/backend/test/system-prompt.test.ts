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
    expect(prompt).toContain("Skill");
    expect(prompt).toContain("TodoWrite");
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
    expect(empty).toContain("Memory 工具");
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
    expect(local).toContain("FeishuSendMessage");
    expect(local).not.toContain("当前对话来自飞书");

    const viaFeishu = buildSystemPrompt({
      workspacePath: "/w",
      accessMode: "approval",
      viaFeishu: true
    });
    expect(viaFeishu).toContain("当前对话来自飞书");
    expect(viaFeishu).toContain("不要调用 FeishuSendMessage 重复发送你的回复");
    expect(viaFeishu).not.toContain("<artifacts>");
  });

  it("注入系统骨架段：Harness、代码与协作规范、上下文管理、安全段", () => {
    const prompt = buildSystemPrompt({ workspacePath: "/w", accessMode: "approval" });
    expect(prompt).toContain("# Harness");
    expect(prompt).toContain("<system-reminder>");
    expect(prompt).toContain("文件路径:行号");
    expect(prompt).toContain("# 代码与协作规范");
    expect(prompt).toContain("# 上下文管理");
    expect(prompt).toContain("# 环境信息");
    expect(prompt).toContain("CTF");
  });

  it("环境信息段：environment 提供时含 Git/Shell/操作系统/模型与 Git 快照", () => {
    const base = buildSystemPrompt({ workspacePath: "/w", accessMode: "approval" });
    expect(base).not.toContain("是否 Git 仓库");

    const withEnv = buildSystemPrompt({
      workspacePath: "/w",
      accessMode: "approval",
      environment: {
        isGitRepo: true,
        shell: "zsh",
        osVersion: "darwin 25.5.0 arm64",
        model: "glm-test",
        inputModalities: ["text", "image"],
        gitStatus: "这是对话开始时的 Git 状态快照，对话过程中不会更新。\n当前分支: main"
      }
    });
    expect(withEnv).toContain("是否 Git 仓库: 是");
    expect(withEnv).toContain("Shell: zsh");
    expect(withEnv).toContain("操作系统: darwin 25.5.0 arm64");
    expect(withEnv).toContain("当前驱动模型: glm-test");
    expect(withEnv).toContain("当前模型输入能力: text,image");
    expect(withEnv).toContain("supportsImage=true");
    expect(withEnv).toContain("当前分支: main");
  });

  it("环境信息段：文本模型明确标记不支持图片输入", () => {
    const prompt = buildSystemPrompt({
      workspacePath: "/w",
      accessMode: "approval",
      environment: {
        isGitRepo: false,
        shell: "zsh",
        osVersion: "darwin 25.5.0 arm64",
        model: "deepseek",
        inputModalities: ["text"]
      }
    });

    expect(prompt).toContain("当前模型输入能力: text");
    expect(prompt).toContain("supportsImage=false");
  });
});
