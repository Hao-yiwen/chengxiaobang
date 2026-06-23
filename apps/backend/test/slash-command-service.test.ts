import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Project } from "@chengxiaobang/shared";
import { SlashCommandService } from "../src/tools/slash-command-service";

describe("SlashCommandService", () => {
  let dir: string;
  let service: SlashCommandService;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "cxb-slash-"));
    service = new SlashCommandService(join(dir, "global"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns only the compaction builtin tool when resource directories do not exist", async () => {
    const { commands, diagnostics } = await service.list();

    expect(commands.filter((command) => command.kind === "builtin_tool")).toEqual([
      expect.objectContaining({ name: "/compact" })
    ]);
    expect(diagnostics).toEqual([]);
  });

  it("expands prompt template slash commands", async () => {
    await mkdir(join(dir, "global", "prompts"), { recursive: true });
    await writeFile(
      join(dir, "global", "prompts", "review.md"),
      "---\ndescription: Review code\n---\nReview $1 and $2",
      "utf8"
    );

    const result = await service.expandPrompt('/review "foo bar" baz');

    expect(result).toEqual({ matched: true, prompt: "Review foo bar and baz" });
  });

  it("prefers project templates over global templates", async () => {
    const projectPath = join(dir, "project");
    await mkdir(join(dir, "global", "prompts"), { recursive: true });
    await mkdir(join(projectPath, ".chengxiaobang", "prompts"), { recursive: true });
    await writeFile(join(dir, "global", "prompts", "review.md"), "Global $ARGUMENTS", "utf8");
    await writeFile(
      join(projectPath, ".chengxiaobang", "prompts", "review.md"),
      "Project $ARGUMENTS",
      "utf8"
    );
    const project = createProject(projectPath);

    const result = await service.expandPrompt("/review target", project);

    expect(result).toEqual({ matched: true, prompt: "Project target" });
  });

  it("does not expand removed tool slash shortcuts", async () => {
    const result = await service.expandPrompt("/ls src");

    expect(result).toEqual({ matched: false, prompt: "/ls src" });
  });

  describe("skills（§5.3）", () => {
    /** 隔离真实内置技能目录：builtin 根指向空临时目录。 */
    let isolated: SlashCommandService;

    beforeEach(() => {
      isolated = new SlashCommandService(join(dir, "global"), join(dir, "builtin"));
    });

    async function writeSkill(
      root: string,
      name: string,
      description: string,
      extraFrontmatter = ""
    ): Promise<void> {
      await mkdir(join(root, "skills", name), { recursive: true });
      await writeFile(
        join(root, "skills", name, "SKILL.md"),
        `---\nname: ${name}\ndescription: ${description}\n${extraFrontmatter}---\n${name} 的操作说明正文`,
        "utf8"
      );
    }

    it("listSkills returns name and description for loaded skills", async () => {
      await writeSkill(join(dir, "global"), "excel", "处理表格");
      await writeSkill(join(dir, "global"), "ppt", "做演示文稿");

      const skills = await isolated.listSkills();

      expect(skills).toEqual(
        expect.arrayContaining([
          { name: "excel", description: "处理表格" },
          { name: "ppt", description: "做演示文稿" }
        ])
      );
      expect(skills).toHaveLength(2);
    });

    it("listSkills includes when_to_use and sorts recently used skills first", async () => {
      const usage = {
        skillUsageStats: async () => ({
          ppt: { usageCount: 3, lastUsedAt: Date.now() },
          excel: { usageCount: 1, lastUsedAt: Date.now() - 20 * 24 * 60 * 60 * 1000 }
        }),
        recordSkillUsage: async () => undefined
      };
      isolated = new SlashCommandService(join(dir, "global"), join(dir, "builtin"), {
        skillUsage: usage
      });
      await writeSkill(join(dir, "global"), "excel", "处理表格", "when_to_use: 数据分析\n");
      await writeSkill(join(dir, "global"), "ppt", "做演示文稿", "when_to_use: 汇报展示\n");

      const skills = await isolated.listSkills();

      expect(skills).toEqual([
        { name: "ppt", description: "做演示文稿", whenToUse: "汇报展示" },
        { name: "excel", description: "处理表格", whenToUse: "数据分析" }
      ]);
    });

    it("user-invocable false hides slash entry but keeps model Skill access", async () => {
      await writeSkill(
        join(dir, "global"),
        "hidden-helper",
        "隐藏辅助技能",
        "user-invocable: false\nwhen_to_use: 模型需要内部辅助时\n"
      );

      const { commands } = await isolated.list();
      expect(commands.some((command) => command.name === "/hidden-helper")).toBe(false);
      await expect(isolated.expandPrompt("/hidden-helper x")).resolves.toEqual({
        matched: false,
        prompt: "/hidden-helper x"
      });
      await expect(isolated.listSkills()).resolves.toEqual([
        {
          name: "hidden-helper",
          description: "隐藏辅助技能",
          whenToUse: "模型需要内部辅助时"
        }
      ]);
      await expect(isolated.findSkill("hidden-helper")).resolves.toMatchObject({
        name: "hidden-helper"
      });
    });

    it("records usage when expanding a slash skill", async () => {
      const recorded: string[] = [];
      isolated = new SlashCommandService(join(dir, "global"), join(dir, "builtin"), {
        skillUsage: {
          skillUsageStats: async () => ({}),
          recordSkillUsage: async (name) => {
            recorded.push(name);
          }
        }
      });
      await writeSkill(join(dir, "global"), "excel", "处理表格");

      const result = await isolated.expandPrompt("/excel 处理 A1");

      expect(result.matched).toBe(true);
      expect(recorded).toEqual(["excel"]);
    });

    it("listSkills filters skills with disable-model-invocation", async () => {
      await writeSkill(join(dir, "global"), "excel", "处理表格");
      await writeSkill(join(dir, "global"), "secret", "隐藏技能", "disable-model-invocation: true\n");

      const skills = await isolated.listSkills();

      expect(skills.map((skill) => skill.name)).toEqual(["excel"]);
    });

    it("findSkill returns the full skill and undefined for unknown names", async () => {
      await writeSkill(join(dir, "global"), "excel", "处理表格");

      const hit = await isolated.findSkill("excel");
      expect(hit?.name).toBe("excel");
      expect(hit?.content).toContain("excel 的操作说明正文");

      await expect(isolated.findSkill("missing")).resolves.toBeUndefined();
    });

    it("findSkill respects disable-model-invocation", async () => {
      await writeSkill(join(dir, "global"), "secret", "隐藏技能", "disable-model-invocation: true\n");

      await expect(isolated.findSkill("secret")).resolves.toBeUndefined();
    });

    it("loads market skills only when they are enabled", async () => {
      const withMarket = new SlashCommandService(join(dir, "global"), join(dir, "builtin"), {
        marketRoot: join(dir, "market"),
        enabledMarketSkills: async () => new Set(["code-review"])
      });
      // 市场目录本身就是技能根（不含 skills/ 中间层）。
      await writeMarketSkill(join(dir, "market"), "code-review", "审代码");
      await writeMarketSkill(join(dir, "market"), "translate", "翻译");

      const skills = await withMarket.listSkills();
      expect(skills).toEqual([{ name: "code-review", description: "审代码" }]);

      const { commands } = await withMarket.list();
      const marketCommand = commands.find((command) => command.name === "/code-review");
      expect(marketCommand?.source).toBe("market");
      expect(commands.some((command) => command.name === "/translate")).toBe(false);

      const expanded = await withMarket.expandPrompt("/code-review src");
      expect(expanded.matched).toBe(true);
    });

    it("does not load market skills without an enablement provider", async () => {
      const noProvider = new SlashCommandService(join(dir, "global"), join(dir, "builtin"), {
        marketRoot: join(dir, "market")
      });
      await writeMarketSkill(join(dir, "market"), "code-review", "审代码");

      await expect(noProvider.listSkills()).resolves.toEqual([]);
    });

    it("prefers project skills over global ones in both listSkills and findSkill", async () => {
      const projectPath = join(dir, "project");
      await writeSkill(join(dir, "global"), "excel", "全局版");
      await writeSkill(join(projectPath, ".chengxiaobang"), "excel", "项目版");
      const project = createProject(projectPath);

      const skills = await isolated.listSkills(project);
      expect(skills).toEqual([{ name: "excel", description: "项目版" }]);

      const found = await isolated.findSkill("excel", project);
      expect(found?.description).toBe("项目版");
    });
  });
});

/** 市场根目录直接包含技能目录（不含 skills/ 中间层）。 */
async function writeMarketSkill(
  marketRoot: string,
  name: string,
  description: string
): Promise<void> {
  await mkdir(join(marketRoot, name), { recursive: true });
  await writeFile(
    join(marketRoot, name, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\n${name} 的操作说明正文`,
    "utf8"
  );
}

function createProject(path: string): Project {
  return {
    id: "project_1",
    name: "project",
    path,
    createdAt: "2026-06-08T00:00:00.000Z",
    updatedAt: "2026-06-08T00:00:00.000Z"
  };
}
