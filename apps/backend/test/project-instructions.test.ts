import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildProjectInstructionMessage,
  findInstructionFile
} from "../src/agent/project-instructions";

describe("findInstructionFile", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "proj-instr-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("同目录下 AGENTS.md 优先于 CLAUDE.md", async () => {
    await writeFile(join(root, "AGENTS.md"), "AGENTS 内容", "utf8");
    await writeFile(join(root, "CLAUDE.md"), "CLAUDE 内容", "utf8");
    const found = await findInstructionFile(root);
    expect(found?.filePath).toBe(join(root, "AGENTS.md"));
    expect(found?.content).toContain("AGENTS 内容");
  });

  it("缺 AGENTS.md 时回退到 CLAUDE.md", async () => {
    await writeFile(join(root, "CLAUDE.md"), "CLAUDE 内容", "utf8");
    const found = await findInstructionFile(root);
    expect(found?.filePath).toBe(join(root, "CLAUDE.md"));
  });

  it("从子目录逐级向上命中项目根", async () => {
    const sub = join(root, "a", "b");
    await mkdir(sub, { recursive: true });
    await writeFile(join(root, "AGENTS.md"), "根指令", "utf8");
    const found = await findInstructionFile(sub);
    expect(found?.filePath).toBe(join(root, "AGENTS.md"));
  });

  it("向上查找止于 Git 仓库根，不越界到父目录", async () => {
    const repo = join(root, "repo");
    const sub = join(repo, "src");
    await mkdir(join(repo, ".git"), { recursive: true });
    await mkdir(sub, { recursive: true });
    // 指令文件放在仓库之外（root），仓库根自身没有，应当查不到。
    await writeFile(join(root, "AGENTS.md"), "仓库外指令", "utf8");
    const found = await findInstructionFile(sub);
    expect(found).toBeUndefined();
  });

  it("超过上限的文件会被截断", async () => {
    await writeFile(join(root, "AGENTS.md"), "x".repeat(100 * 1024 + 50), "utf8");
    const found = await findInstructionFile(root);
    expect(found?.truncated).toBe(true);
    expect(found?.content).toContain("（文件已截断）");
  });

  it("没有任何指令文件时返回 undefined", async () => {
    expect(await findInstructionFile(root)).toBeUndefined();
  });
});

describe("buildProjectInstructionMessage", () => {
  it("用 system-reminder 包裹并强调优先级", () => {
    const message = buildProjectInstructionMessage({
      filePath: "/repo/AGENTS.md",
      content: "项目约定正文",
      truncated: false
    });
    expect(message.role).toBe("user");
    const text =
      typeof message.content === "string" ? message.content : JSON.stringify(message.content);
    expect(text).toContain("<system-reminder>");
    expect(text).toContain("# 项目指令");
    expect(text).toContain("优先于默认行为");
    expect(text).toContain("/repo/AGENTS.md");
    expect(text).toContain("项目约定正文");
    expect(text).toContain("</system-reminder>");
  });
});
