import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isPathOutsideWorkspace, listProjectFiles, safeResolve } from "../src/tools/workspace";

describe("safeResolve", () => {
  it("resolves inside the workspace and rejects escapes", () => {
    expect(safeResolve("/tmp/ws", "a/b.txt", "linux")).toBe("/tmp/ws/a/b.txt");
    expect(safeResolve("/tmp/ws", ".", "linux")).toBe("/tmp/ws");
    expect(() => safeResolve("/tmp/ws", "../outside", "linux")).toThrow("超出当前项目范围");
  });

  it("treats Windows workspace paths as case-insensitive", () => {
    const base = "C:\\Users\\Me\\Repo";

    expect(isPathOutsideWorkspace(base, "c:\\users\\me\\repo\\src\\index.ts", "win32")).toBe(
      false
    );
    expect(() => safeResolve(base, "c:\\users\\me\\repo\\src\\index.ts", "win32")).not.toThrow();
    expect(isPathOutsideWorkspace(base, "C:\\Users\\Me\\Other\\index.ts", "win32")).toBe(true);
    expect(isPathOutsideWorkspace(base, "D:\\Repo\\index.ts", "win32")).toBe(true);
    expect(() => safeResolve(base, "C:\\Users\\Me\\Other\\index.ts", "win32")).toThrow(
      "超出当前项目范围"
    );
  });
});

describe("listProjectFiles", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "cxb-files-"));
    await mkdir(join(dir, "src"), { recursive: true });
    await mkdir(join(dir, "node_modules", "pkg"), { recursive: true });
    await mkdir(join(dir, ".git"), { recursive: true });
    await writeFile(join(dir, "src", "index.ts"), "export {};");
    await writeFile(join(dir, "src", "main-index.ts"), "export {};");
    await writeFile(join(dir, "README.md"), "# readme");
    await writeFile(join(dir, "node_modules", "pkg", "a.js"), "ignored");
    await writeFile(join(dir, ".git", "config"), "ignored");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("lists posix-style relative paths, excluding ignored directories", async () => {
    const files = await listProjectFiles(dir, "");
    expect(files).toContain("src/index.ts");
    expect(files).toContain("README.md");
    expect(files.some((file) => file.includes("node_modules"))).toBe(false);
    expect(files.some((file) => file.includes(".git"))).toBe(false);
  });

  it("filters case-insensitively and ranks basename-prefix matches first", async () => {
    const files = await listProjectFiles(dir, "IND");
    expect(files[0]).toBe("src/index.ts");
    expect(files).toContain("src/main-index.ts");
    expect(files).not.toContain("README.md");
  });

  it("caps the number of results", async () => {
    const files = await listProjectFiles(dir, "", 2);
    expect(files).toHaveLength(2);
  });
});
