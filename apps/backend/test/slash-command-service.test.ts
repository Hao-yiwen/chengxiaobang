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
