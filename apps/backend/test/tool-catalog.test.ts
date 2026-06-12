import { describe, expect, it } from "vitest";
import { toolNameSchema } from "@chengxiaobang/shared";
import { selectToolDefinitions } from "../src/tools/tool-catalog";
import { TOOL_DEFINITIONS } from "../src/tools/tool-schemas";

function names(opts: Parameters<typeof selectToolDefinitions>[0]): string[] {
  return selectToolDefinitions(opts).map((def) => def.function.name);
}

describe("selectToolDefinitions", () => {
  it("TOOL_DEFINITIONS 中每个工具名都属于 toolNameSchema（含 5 个新工具）", () => {
    for (const def of TOOL_DEFINITIONS) {
      expect(toolNameSchema.safeParse(def.function.name).success).toBe(true);
    }
    const all = TOOL_DEFINITIONS.map((def) => def.function.name);
    for (const name of ["propose_plan", "update_plan", "ask_user", "btw", "use_skill"]) {
      expect(all).toContain(name);
    }
  });

  it("none 阶段不含 propose_plan/update_plan，其余全量可见", () => {
    const visible = names({ planPhase: "none", viaFeishu: false });
    expect(visible).not.toContain("propose_plan");
    expect(visible).not.toContain("update_plan");
    expect(visible).toContain("write_file");
    expect(visible).toContain("shell");
    expect(visible).toContain("ask_user");
    expect(visible).toContain("btw");
    expect(visible).toContain("use_skill");
    expect(visible).toHaveLength(TOOL_DEFINITIONS.length - 2);
  });

  it("draft 阶段只含只读工具 + propose_plan/ask_user/btw/use_skill", () => {
    const visible = names({ planPhase: "draft", viaFeishu: false });
    const allowed = new Set([
      "list_directory",
      "read_file",
      "glob",
      "search",
      "git_status",
      "git_diff",
      "fetch_url",
      "propose_plan",
      "ask_user",
      "btw",
      "use_skill"
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
  });

  it("execute 阶段含 update_plan 不含 propose_plan", () => {
    const visible = names({ planPhase: "execute", viaFeishu: false });
    expect(visible).toContain("update_plan");
    expect(visible).not.toContain("propose_plan");
    expect(visible).toContain("write_file");
    expect(visible).toHaveLength(TOOL_DEFINITIONS.length - 1);
  });

  it("viaFeishu 任意阶段剔除 propose_plan/ask_user", () => {
    for (const planPhase of ["none", "draft", "execute"] as const) {
      const visible = names({ planPhase, viaFeishu: true });
      expect(visible).not.toContain("propose_plan");
      expect(visible).not.toContain("ask_user");
    }
    // 飞书通道 draft 阶段仍可见旁注与技能工具。
    const draft = names({ planPhase: "draft", viaFeishu: true });
    expect(draft).toContain("btw");
    expect(draft).toContain("use_skill");
  });
});
