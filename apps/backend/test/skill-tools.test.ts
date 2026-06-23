import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { SkillMarketService } from "../src/tools/skill-market-service";
import { createPlanTools } from "../src/tools/plan-tools";
import { createSkillTools } from "../src/tools/skill-tools";

function memorySettings() {
  const map = new Map<string, string>();
  return {
    getSetting: async (key: string) => map.get(key),
    setSetting: async (key: string, value: string) => {
      map.set(key, value);
    }
  };
}

describe("CreateSkill tool", () => {
  let dir: string;
  let service: SkillMarketService;
  let tool: AgentTool<any>;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "cxb-skilltool-"));
    service = new SkillMarketService(memorySettings(), {
      builtinRoot: join(dir, "builtin"),
      marketRoot: join(dir, "market"),
      customRoot: join(dir, "custom")
    });
    tool = createSkillTools({ skillMarketService: service })[0];
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    vi.unstubAllGlobals();
  });

  it("creates a skill from name/description/content", async () => {
    const result = await tool.execute("call_1", {
      name: "daily-report",
      description: "生成日报",
      content: "按模板写日报"
    });

    expect(JSON.stringify(result)).toContain("daily-report");
    const written = await readFile(join(dir, "custom", "daily-report", "SKILL.md"), "utf8");
    expect(written).toContain("description: 生成日报");
    expect(written).toContain("按模板写日报");
  });

  it("installs a skill from a GitHub url", async () => {
    const skillMd = ["---", "name: imported", "description: 来自社区", "---", "正文"].join("\n");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(skillMd, { status: 200 }))
    );

    await tool.execute("call_2", {
      url: "https://github.com/owner/repo/tree/main/skills/imported"
    });

    expect(existsSync(join(dir, "custom", "imported", "SKILL.md"))).toBe(true);
  });

  it("errors when manual creation is missing fields", async () => {
    await expect(tool.execute("call_3", { name: "only-name" })).rejects.toThrow(
      /需要同时提供/
    );
  });
});

describe("Skill tool", () => {
  it("records usage after a skill is loaded", async () => {
    const recorded: string[] = [];
    const skill = createPlanTools({
      getApprovedPlanArgs: () => undefined,
      getAskUserAnswer: () => undefined,
      loadSkill: async (name) => `技能 ${name} 的正文`,
      recordSkillUsage: async (name) => {
        recorded.push(name);
      }
    }).find((tool) => tool.name === "Skill");

    expect(skill).toBeTruthy();
    const result = await skill!.execute("call_skill", { skill: "ppt" });

    expect(JSON.stringify(result)).toContain("技能 ppt 的正文");
    expect(recorded).toEqual(["ppt"]);
  });

  it("does not record usage when a skill is missing", async () => {
    const recorded: string[] = [];
    const skill = createPlanTools({
      getApprovedPlanArgs: () => undefined,
      getAskUserAnswer: () => undefined,
      loadSkill: async () => undefined,
      recordSkillUsage: async (name) => {
        recorded.push(name);
      }
    }).find((tool) => tool.name === "Skill");

    expect(skill).toBeTruthy();
    await expect(skill!.execute("call_skill", { skill: "missing" })).rejects.toThrow(
      "技能不存在"
    );
    expect(recorded).toEqual([]);
  });
});
