import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  parseSkillFile,
  resolveSkillFileUrls,
  SkillMarketError,
  SkillMarketService
} from "../src/tools/skill-market-service";

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

async function writeSkill(
  root: string,
  dirName: string,
  frontmatter: { name: string; description: string; category?: string },
  body = "正文"
): Promise<void> {
  await mkdir(join(root, dirName), { recursive: true });
  const lines = [
    "---",
    `name: ${frontmatter.name}`,
    `description: ${frontmatter.description}`,
    ...(frontmatter.category ? ["metadata:", `  category: ${frontmatter.category}`] : []),
    "---",
    body
  ];
  await writeFile(join(root, dirName, "SKILL.md"), lines.join("\n"), "utf8");
}

describe("SkillMarketService", () => {
  let dir: string;
  let service: SkillMarketService;
  let settings: ReturnType<typeof memorySettings>;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "cxb-skill-market-"));
    settings = memorySettings();
    service = new SkillMarketService(settings, {
      builtinRoot: join(dir, "builtin"),
      marketRoot: join(dir, "market"),
      customRoot: join(dir, "custom")
    });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    vi.unstubAllGlobals();
  });

  it("lists builtin, market and custom skills with enablement flags", async () => {
    await writeSkill(join(dir, "builtin"), "word", {
      name: "word",
      description: "写文档",
      category: "office"
    });
    await writeSkill(join(dir, "market"), "code-review", {
      name: "code-review",
      description: "审代码",
      category: "coding"
    });
    await writeSkill(join(dir, "custom"), "my-skill", {
      name: "my-skill",
      description: "自定义"
    });

    const skills = await service.list();

    expect(skills).toEqual([
      {
        name: "word",
        description: "写文档",
        category: "office",
        source: "builtin",
        enabled: true
      },
      {
        name: "code-review",
        description: "审代码",
        category: "coding",
        source: "market",
        enabled: false
      },
      {
        name: "my-skill",
        description: "自定义",
        category: "other",
        source: "custom",
        enabled: true
      }
    ]);
  });

  it("returns skill detail with body stripped of frontmatter", async () => {
    await writeSkill(
      join(dir, "market"),
      "code-review",
      { name: "code-review", description: "审代码", category: "coding" },
      "# 标题\n\n这是正文。"
    );

    const detail = await service.getDetail("code-review");

    expect(detail).toMatchObject({
      name: "code-review",
      description: "审代码",
      category: "coding",
      source: "market",
      enabled: false,
      content: "# 标题\n\n这是正文。"
    });
    expect(detail?.content.startsWith("---")).toBe(false);
    expect(detail?.filePath).toContain("code-review");
  });

  it("reflects enablement and returns undefined for unknown detail", async () => {
    await writeSkill(join(dir, "market"), "code-review", {
      name: "code-review",
      description: "审代码",
      category: "coding"
    });
    await service.setMarketSkillEnabled("code-review", true);

    const detail = await service.getDetail("code-review");
    expect(detail?.enabled).toBe(true);

    await expect(service.getDetail("nope")).resolves.toBeUndefined();
  });

  it("enables and disables market skills, persisting the set", async () => {
    await writeSkill(join(dir, "market"), "code-review", {
      name: "code-review",
      description: "审代码",
      category: "coding"
    });

    const afterEnable = await service.setMarketSkillEnabled("code-review", true);
    expect(afterEnable.find((s) => s.name === "code-review")?.enabled).toBe(true);
    await expect(service.enabledMarketSkillNames()).resolves.toEqual(new Set(["code-review"]));

    const afterDisable = await service.setMarketSkillEnabled("code-review", false);
    expect(afterDisable.find((s) => s.name === "code-review")?.enabled).toBe(false);
    await expect(service.enabledMarketSkillNames()).resolves.toEqual(new Set());
  });

  it("rejects enabling a skill that is not in the market", async () => {
    await expect(service.setMarketSkillEnabled("missing", true)).rejects.toBeInstanceOf(
      SkillMarketError
    );
  });

  it("creates a custom skill on disk and lists it as enabled", async () => {
    const summary = await service.createCustom({
      name: "daily-report",
      description: "生成日报",
      content: "按模板生成日报"
    });

    expect(summary).toMatchObject({ name: "daily-report", source: "custom", enabled: true });
    const written = await readFile(join(dir, "custom", "daily-report", "SKILL.md"), "utf8");
    expect(written).toContain("name: daily-report");
    expect(written).toContain("按模板生成日报");
  });

  it("rejects custom skills whose name collides with builtin or market skills", async () => {
    await writeSkill(join(dir, "builtin"), "word", { name: "word", description: "写文档" });

    await expect(
      service.createCustom({ name: "word", description: "x", content: "y" })
    ).rejects.toThrow(/重名/);
  });

  it("deletes custom skills and returns false for unknown names", async () => {
    await writeSkill(join(dir, "custom"), "my-skill", {
      name: "my-skill",
      description: "自定义"
    });

    await expect(service.deleteCustom("my-skill")).resolves.toBe(true);
    expect(existsSync(join(dir, "custom", "my-skill"))).toBe(false);
    await expect(service.deleteCustom("my-skill")).resolves.toBe(false);
  });

  it("imports a skill from a GitHub directory link via raw SKILL.md", async () => {
    const skillMd = [
      "---",
      "name: imported-skill",
      "description: 来自社区",
      "---",
      "操作说明"
    ].join("\n");
    const fetchMock = vi.fn(async () => new Response(skillMd, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const summary = await service.importFromUrl({
      url: "https://github.com/owner/repo/tree/main/skills/imported-skill"
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://raw.githubusercontent.com/owner/repo/main/skills/imported-skill/SKILL.md",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(summary).toMatchObject({ name: "imported-skill", source: "custom", enabled: true });
    expect(existsSync(join(dir, "custom", "imported-skill", "SKILL.md"))).toBe(true);
  });

  it("surfaces a friendly error when the SKILL.md cannot be fetched", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("not found", { status: 404 }))
    );

    await expect(
      service.importFromUrl({ url: "https://github.com/owner/repo" })
    ).rejects.toThrow(/拉取 SKILL\.md 失败/);
  });

  it("rejects oversized remote skill files", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("x".repeat(300 * 1024), {
            status: 200,
            headers: { "content-length": String(300 * 1024) }
          })
      )
    );

    await expect(
      service.importFromUrl({ url: "https://github.com/owner/repo" })
    ).rejects.toThrow(/大小上限/);
  });
});

describe("parseSkillFile", () => {
  it("reads name, description and nested category", () => {
    const meta = parseSkillFile(
      ["---", "name: a-skill", "description: 做事", "metadata:", "  category: coding", "---", "x"].join(
        "\n"
      )
    );
    expect(meta).toEqual({ name: "a-skill", description: "做事", category: "coding" });
  });

  it("defaults unknown categories to other and rejects missing fields", () => {
    expect(
      parseSkillFile(["---", "name: a", "description: b", "metadata:", "  category: misc", "---"].join("\n"))
        ?.category
    ).toBe("other");
    expect(parseSkillFile("---\nname: only-name\n---\nbody")).toBeUndefined();
    expect(parseSkillFile("no frontmatter")).toBeUndefined();
  });

  it("unquotes quoted values", () => {
    const meta = parseSkillFile('---\nname: "a"\ndescription: \'b\'\n---\nx');
    expect(meta).toMatchObject({ name: "a", description: "b" });
  });
});

describe("resolveSkillFileUrls", () => {
  it("maps github repo, tree, blob and raw links to raw SKILL.md urls", () => {
    expect(resolveSkillFileUrls("https://github.com/o/r")).toEqual([
      "https://raw.githubusercontent.com/o/r/HEAD/SKILL.md"
    ]);
    expect(resolveSkillFileUrls("https://github.com/o/r/tree/main/skills/x")).toEqual([
      "https://raw.githubusercontent.com/o/r/main/skills/x/SKILL.md"
    ]);
    expect(resolveSkillFileUrls("https://github.com/o/r/blob/main/skills/x/SKILL.md")).toEqual([
      "https://raw.githubusercontent.com/o/r/main/skills/x/SKILL.md"
    ]);
    expect(
      resolveSkillFileUrls("https://raw.githubusercontent.com/o/r/main/skills/x/SKILL.md")
    ).toEqual(["https://raw.githubusercontent.com/o/r/main/skills/x/SKILL.md"]);
  });

  it("rejects unsupported links", () => {
    expect(resolveSkillFileUrls("not a url")).toEqual([]);
    expect(resolveSkillFileUrls("ftp://example.com/SKILL.md")).toEqual([]);
    expect(resolveSkillFileUrls("https://example.com/page")).toEqual([]);
    expect(resolveSkillFileUrls("https://example.com/SKILL.md")).toEqual([]);
    expect(resolveSkillFileUrls("http://github.com/o/r")).toEqual([]);
  });
});
