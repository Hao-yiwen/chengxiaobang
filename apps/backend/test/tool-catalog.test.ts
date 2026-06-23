import { describe, expect, it } from "vitest";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { selectAgentTools } from "../src/tools/registry";

const toolNames = [
  "LS",
  "Read",
  "Glob",
  "Grep",
  "BashStatus",
  "BashCancel",
  "GitStatus",
  "GitDiff",
  "WebFetch",
  "WebSearch",
  "ToolSearch",
  "ScheduleList",
  "OcrExtractText",
  "Write",
  "Edit",
  "MakeDirectory",
  "Bash",
  "PowerShell",
  "FeishuSendMessage",
  "ScheduleCreate",
  "ScheduleCancel",
  "CreateSkill",
  "ExitPlanMode",
  "ExitPlanMode",
  "AskUserQuestion",
  "Skill",
  "Memory",
  "mcp__demo__write",
  "TodoWrite",
  "TodoWrite"
];

function fakeTools(): AgentTool<any>[] {
  return toolNames.map((name) => ({
    name,
    label: name,
    description: `${name} test tool`,
    parameters: {} as never,
    execute: async () => ({ content: [{ type: "text", text: name }], details: undefined })
  }));
}

function names(options: Parameters<typeof selectAgentTools>[1]): string[] {
  return selectAgentTools(fakeTools(), options).map((tool) => tool.name);
}

describe("selectAgentTools", () => {
  it("none 阶段隐藏计划工具，保留普通工具和 todo 工具", () => {
    const visible = names({ planPhase: "none", viaFeishu: false });

    expect(visible).not.toContain("ExitPlanMode");
    expect(visible).not.toContain("ExitPlanMode");
    expect(visible).toContain("Write");
    expect(visible).toContain("Bash");
    expect(visible).toContain("PowerShell");
    expect(visible).toContain("ToolSearch");
    expect(visible).toContain("AskUserQuestion");
    expect(visible).toContain("Skill");
    expect(visible).toContain("TodoWrite");
    expect(visible).toContain("TodoWrite");
    expect(visible).not.toContain("mcp__demo__write");
  });

  it("draft 阶段只保留只读工具和计划起草辅助工具", () => {
    const visible = names({ planPhase: "draft", viaFeishu: false });
    const allowed = new Set([
      "LS",
      "Read",
      "Glob",
      "Grep",
      "BashStatus",
      "BashCancel",
      "GitStatus",
      "GitDiff",
      "WebFetch",
      "WebSearch",
      "ToolSearch",
      "ScheduleList",
      "ExitPlanMode",
      "AskUserQuestion",
      "Skill",
      "Memory"
    ]);

    expect(visible.length).toBeGreaterThan(0);
    for (const name of visible) {
      expect(allowed.has(name)).toBe(true);
    }
    expect(visible).toContain("ExitPlanMode");
    expect(visible).toContain("Read");
    expect(visible).toContain("ToolSearch");
    expect(visible).not.toContain("Write");
    expect(visible).not.toContain("Bash");
    expect(visible).not.toContain("PowerShell");
    expect(visible).not.toContain("TodoWrite");
    expect(visible).not.toContain("TodoRead");
    expect(visible).not.toContain("mcp__demo__write");
  });

  it("only exposes OCR when the current run has OCR-capable attachments", () => {
    const hidden = names({ planPhase: "none", viaFeishu: false });
    const visible = names({ planPhase: "none", viaFeishu: false, enableOcr: true });
    const draftVisible = names({ planPhase: "draft", viaFeishu: false, enableOcr: true });

    expect(hidden).not.toContain("OcrExtractText");
    expect(visible).toContain("OcrExtractText");
    expect(draftVisible).toContain("OcrExtractText");
  });

  it("execute 阶段恢复普通工具，但不再暴露计划工具和 todo 工具", () => {
    const visible = names({ planPhase: "execute", viaFeishu: false });

    expect(visible).not.toContain("ExitPlanMode");
    expect(visible).not.toContain("ExitPlanMode");
    expect(visible).not.toContain("TodoWrite");
    expect(visible).not.toContain("TodoWrite");
    expect(visible).toContain("Write");
    expect(visible).toContain("ScheduleCreate");
    expect(visible).toContain("CreateSkill");
    expect(visible).toContain("PowerShell");
    expect(visible).not.toContain("mcp__demo__write");
  });

  it("viaFeishu 任意阶段隐藏会阻塞或混淆飞书通道的工具", () => {
    for (const planPhase of ["none", "draft", "execute"] as const) {
      const visible = names({ planPhase, viaFeishu: true });
      expect(visible).not.toContain("ExitPlanMode");
      expect(visible).not.toContain("AskUserQuestion");
      expect(visible).not.toContain("TodoWrite");
      expect(visible).not.toContain("TodoWrite");
    }
    const draft = names({ planPhase: "draft", viaFeishu: true });
    expect(draft).toContain("Skill");
  });

  it("headless 通道隐藏 AskUserQuestion 和 todo 工具，避免无人值守运行卡住", () => {
    const visible = names({ planPhase: "none", viaFeishu: false, headless: true });

    expect(visible).not.toContain("AskUserQuestion");
    expect(visible).not.toContain("TodoWrite");
    expect(visible).not.toContain("TodoWrite");
    expect(visible).toContain("Write");
    expect(visible).toContain("ScheduleList");
  });

  it("deferred 工具只有被选中后才进入模型工具列表", () => {
    const selected = new Set<string>(["mcp__demo__write"]);

    const hidden = names({ planPhase: "none", viaFeishu: false });
    const visible = names({
      planPhase: "none",
      viaFeishu: false,
      enabledDeferredToolNames: selected
    });

    expect(hidden).not.toContain("mcp__demo__write");
    expect(visible).toContain("mcp__demo__write");
    expect(visible).toContain("ToolSearch");
  });

  it("为并发不安全工具补 sequential 执行模式，WebFetch 保持默认并发", () => {
    const selected = new Set<string>(["mcp__demo__write"]);
    const visible = selectAgentTools(fakeTools(), {
      planPhase: "none",
      viaFeishu: false,
      enabledDeferredToolNames: selected
    });
    const byName = new Map(visible.map((tool) => [tool.name, tool]));

    expect(byName.get("WebFetch")?.executionMode).toBeUndefined();
    expect(byName.get("WebSearch")?.executionMode).toBeUndefined();
    expect(byName.get("Read")?.executionMode).toBeUndefined();
    expect(byName.get("Write")?.executionMode).toBe("sequential");
    expect(byName.get("Bash")?.executionMode).toBe("sequential");
    expect(byName.get("AskUserQuestion")?.executionMode).toBe("sequential");
    expect(byName.get("mcp__demo__write")?.executionMode).toBe("sequential");
  });
});
