import { describe, expect, it } from "vitest";
import { createPlanTools } from "../src/tools/plan-tools";

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
