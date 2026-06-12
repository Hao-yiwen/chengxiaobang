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

  it("returns builtin commands when resource directories do not exist", async () => {
    const { commands, diagnostics } = await service.list();

    expect(commands).toEqual(expect.arrayContaining([expect.objectContaining({ name: "/ls" })]));
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

  it("does not expand builtin tool commands", async () => {
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

function createProject(path: string): Project {
  return {
    id: "project_1",
    name: "project",
    path,
    createdAt: "2026-06-08T00:00:00.000Z",
    updatedAt: "2026-06-08T00:00:00.000Z"
  };
}
