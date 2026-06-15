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
  "ScheduleList",
  "OcrExtractText",
  "Write",
  "Edit",
  "MakeDirectory",
  "Bash",
  "FeishuSendMessage",
  "ScheduleCreate",
  "ScheduleCancel",
  "CreateSkill",
  "ExitPlanMode",
  "ExitPlanMode",
  "AskUserQuestion",
  "Skill",
  "Memory",
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
    expect(visible).toContain("AskUserQuestion");
    expect(visible).toContain("Skill");
    expect(visible).toContain("TodoWrite");
    expect(visible).toContain("TodoWrite");
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
    expect(visible).not.toContain("Write");
    expect(visible).not.toContain("Bash");
    expect(visible).not.toContain("TodoWrite");
    expect(visible).not.toContain("TodoRead");
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
});
