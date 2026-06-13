import { describe, expect, it } from "vitest";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { selectAgentTools } from "../src/tools/registry";

const toolNames = [
  "list_directory",
  "read_file",
  "glob",
  "search",
  "shell_status",
  "shell_cancel",
  "git_status",
  "git_diff",
  "fetch_url",
  "web_search",
  "schedule_list",
  "write_file",
  "edit_file",
  "make_directory",
  "shell",
  "feishu_send_message",
  "schedule_create",
  "schedule_create_once",
  "schedule_cancel",
  "create_skill",
  "propose_plan",
  "update_plan",
  "ask_user",
  "btw",
  "use_skill",
  "memory",
  "todo_create",
  "todo_update"
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

    expect(visible).not.toContain("propose_plan");
    expect(visible).not.toContain("update_plan");
    expect(visible).toContain("write_file");
    expect(visible).toContain("shell");
    expect(visible).toContain("ask_user");
    expect(visible).toContain("btw");
    expect(visible).toContain("use_skill");
    expect(visible).toContain("todo_create");
    expect(visible).toContain("todo_update");
  });

  it("draft 阶段只保留只读工具和计划起草辅助工具", () => {
    const visible = names({ planPhase: "draft", viaFeishu: false });
    const allowed = new Set([
      "list_directory",
      "read_file",
      "glob",
      "search",
      "shell_status",
      "shell_cancel",
      "git_status",
      "git_diff",
      "fetch_url",
      "web_search",
      "schedule_list",
      "propose_plan",
      "ask_user",
      "btw",
      "use_skill",
      "memory"
    ]);

    expect(visible.length).toBeGreaterThan(0);
    for (const name of visible) {
      expect(allowed.has(name)).toBe(true);
    }
    expect(visible).toContain("propose_plan");
    expect(visible).toContain("read_file");
    expect(visible).not.toContain("write_file");
    expect(visible).not.toContain("shell");
    expect(visible).not.toContain("update_plan");
    expect(visible).not.toContain("todo_create");
    expect(visible).not.toContain("todo_update");
  });

  it("execute 阶段恢复普通工具，但不再暴露计划工具和 todo 工具", () => {
    const visible = names({ planPhase: "execute", viaFeishu: false });

    expect(visible).not.toContain("update_plan");
    expect(visible).not.toContain("propose_plan");
    expect(visible).not.toContain("todo_create");
    expect(visible).not.toContain("todo_update");
    expect(visible).toContain("write_file");
    expect(visible).toContain("schedule_create");
    expect(visible).toContain("schedule_create_once");
    expect(visible).toContain("create_skill");
  });

  it("viaFeishu 任意阶段隐藏会阻塞或混淆飞书通道的工具", () => {
    for (const planPhase of ["none", "draft", "execute"] as const) {
      const visible = names({ planPhase, viaFeishu: true });
      expect(visible).not.toContain("propose_plan");
      expect(visible).not.toContain("ask_user");
      expect(visible).not.toContain("todo_create");
      expect(visible).not.toContain("todo_update");
    }
    const draft = names({ planPhase: "draft", viaFeishu: true });
    expect(draft).toContain("btw");
    expect(draft).toContain("use_skill");
  });

  it("headless 通道隐藏 ask_user 和 todo 工具，避免无人值守运行卡住", () => {
    const visible = names({ planPhase: "none", viaFeishu: false, headless: true });

    expect(visible).not.toContain("ask_user");
    expect(visible).not.toContain("todo_create");
    expect(visible).not.toContain("todo_update");
    expect(visible).toContain("write_file");
    expect(visible).toContain("schedule_list");
  });
});
