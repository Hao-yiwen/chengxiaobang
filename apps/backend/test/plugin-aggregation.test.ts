import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SkillMarketService } from "../src/tools/skill-market-service";
import { SlashCommandService } from "../src/tools/slash-command-service";

/** 内存版 settings KV，避免为单测拉起 SQLite。 */
function memorySettings() {
  const map = new Map<string, string>();
  return {
    getSetting: async (key: string) => map.get(key),
    setSetting: async (key: string, value: string) => {
      map.set(key, value);
    }
  };
}

async function writePluginSkill(pluginRoot: string, name: string, description: string): Promise<void> {
  await mkdir(join(pluginRoot, "skills", name), { recursive: true });
  await writeFile(
    join(pluginRoot, "skills", name, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\n正文`,
    "utf8"
  );
}

async function writePluginCommand(
  pluginRoot: string,
  name: string,
  description: string,
  argumentHint: string
): Promise<void> {
  await mkdir(join(pluginRoot, "commands"), { recursive: true });
  await writeFile(
    join(pluginRoot, "commands", `${name}.md`),
    `---\ndescription: ${description}\nargument-hint: ${argumentHint}\n---\n做 $ARGUMENTS`,
    "utf8"
  );
}

describe("plugin aggregation", () => {
  let dir: string;
  let pluginRoot: string;
  const enabledPluginRoots = async () => [{ pluginName: "superpowers", root: pluginRoot }];

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "cxb-plugin-agg-"));
    pluginRoot = join(dir, "plugins", "superpowers");
    await writePluginSkill(pluginRoot, "brainstorming", "头脑风暴");
    await writePluginCommand(pluginRoot, "android-dev", "安卓开发", "[目标]");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  describe("SkillMarketService", () => {
    it("lists plugin skills and toggles them via the disabled blacklist", async () => {
      const svc = new SkillMarketService(memorySettings(), {
        builtinRoot: join(dir, "builtin"),
        marketRoot: join(dir, "market"),
        customRoot: join(dir, "custom"),
        enabledPluginRoots
      });

      const before = await svc.list();
      expect(before).toContainEqual(
        expect.objectContaining({
          name: "brainstorming",
          source: "plugin",
          pluginName: "superpowers",
          enabled: true
        })
      );

      const after = await svc.setSkillDisabled("brainstorming", true);
      expect(after.find((s) => s.name === "brainstorming")).toMatchObject({ enabled: false });
      await expect(svc.disabledSkillNames()).resolves.toEqual(new Set(["brainstorming"]));

      const detail = await svc.getDetail("brainstorming");
      expect(detail).toMatchObject({
        source: "plugin",
        pluginName: "superpowers",
        enabled: false,
        content: "正文"
      });
    });
  });

  describe("SlashCommandService", () => {
    it("aggregates enabled plugin skills and commands with metadata and expands them", async () => {
      const svc = new SlashCommandService(join(dir, "global"), join(dir, "builtin"), {
        enabledPluginRoots
      });
      const { commands } = await svc.list();

      expect(commands.find((c) => c.name === "/brainstorming")).toMatchObject({
        kind: "skill",
        source: "plugin",
        pluginName: "superpowers",
        enabled: true
      });
      expect(commands.find((c) => c.name === "/android-dev")).toMatchObject({
        kind: "prompt_template",
        source: "plugin",
        pluginName: "superpowers",
        argumentHint: "[目标]",
        enabled: true
      });

      await expect(svc.expandPrompt("/android-dev 登录页")).resolves.toEqual({
        matched: true,
        prompt: "做 登录页"
      });
      const skills = await svc.listSkills();
      expect(skills.find((s) => s.name === "brainstorming")).toMatchObject({ name: "brainstorming" });
    });

    it("keeps disabled plugin items listed but hides them from model use and expansion", async () => {
      const svc = new SlashCommandService(join(dir, "global"), join(dir, "builtin"), {
        enabledPluginRoots,
        disabledSkills: async () => new Set(["brainstorming"]),
        disabledCommands: async () => new Set(["android-dev"])
      });
      const { commands } = await svc.list();

      expect(commands.find((c) => c.name === "/brainstorming")).toMatchObject({ enabled: false });
      expect(commands.find((c) => c.name === "/android-dev")).toMatchObject({ enabled: false });

      const skills = await svc.listSkills();
      expect(skills.find((s) => s.name === "brainstorming")).toBeUndefined();

      await expect(svc.expandPrompt("/android-dev x")).resolves.toEqual({
        matched: false,
        prompt: "/android-dev x"
      });
    });
  });
});
