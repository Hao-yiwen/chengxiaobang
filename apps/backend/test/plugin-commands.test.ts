import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadPluginCommands } from "../src/tools/plugin-commands";

describe("loadPluginCommands", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "cxb-plugin-cmd-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns empty when commands dir is missing", async () => {
    await expect(loadPluginCommands(dir)).resolves.toEqual([]);
  });

  it("parses name from filename, description and argument-hint from frontmatter", async () => {
    await mkdir(join(dir, "commands"), { recursive: true });
    await writeFile(
      join(dir, "commands", "android-dev.md"),
      [
        "---",
        "description: 启动 Android 开发循环",
        'argument-hint: "[目标]"',
        "skills: android-dev",
        "---",
        "",
        "用 android-dev 技能：$ARGUMENTS"
      ].join("\n"),
      "utf8"
    );

    const commands = await loadPluginCommands(dir);
    expect(commands).toHaveLength(1);
    expect(commands[0].template.name).toBe("android-dev");
    expect(commands[0].template.description).toBe("启动 Android 开发循环");
    expect(commands[0].argumentHint).toBe("[目标]");
    expect(commands[0].template.content).toContain("$ARGUMENTS");
    expect(commands[0].template.content.startsWith("---")).toBe(false);
  });

  it("prefers frontmatter name over filename and handles files without frontmatter", async () => {
    await mkdir(join(dir, "commands"), { recursive: true });
    await writeFile(join(dir, "commands", "file.md"), "---\nname: custom-name\n---\nbody", "utf8");
    await writeFile(join(dir, "commands", "plain.md"), "no frontmatter body", "utf8");

    const commands = await loadPluginCommands(dir);
    expect(commands.map((c) => c.template.name).sort()).toEqual(["custom-name", "plain"]);
    expect(commands.find((c) => c.template.name === "plain")?.template.content).toBe(
      "no frontmatter body"
    );
  });

  it("ignores non-md files", async () => {
    await mkdir(join(dir, "commands"), { recursive: true });
    await writeFile(join(dir, "commands", "readme.txt"), "x", "utf8");
    await expect(loadPluginCommands(dir)).resolves.toEqual([]);
  });
});
