import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  collectGitChanges,
  detectGitRepository,
  parsePorcelainStatus,
  splitUnifiedDiff
} from "../src/tools/git-changes";
import { runCommand } from "../src/tools/shell";

describe("parsePorcelainStatus", () => {
  it("parses regular status lines", () => {
    const text = [" M src/a.ts", "M  src/b.ts", "?? new.txt", "MM both.ts"].join("\n");
    expect(parsePorcelainStatus(text)).toEqual([
      { status: " M", path: "src/a.ts" },
      { status: "M ", path: "src/b.ts" },
      { status: "??", path: "new.txt" },
      { status: "MM", path: "both.ts" }
    ]);
  });

  it("takes the new path for renames and unquotes quoted paths", () => {
    const text = ['R  old.ts -> new.ts', '?? "a b.txt"'].join("\n");
    expect(parsePorcelainStatus(text)).toEqual([
      { status: "R ", path: "new.ts" },
      { status: "??", path: "a b.txt" }
    ]);
  });

  it("skips lines that are not valid porcelain output", () => {
    const text = ["zsh: profile noise", "", " M ok.ts", "some random words here"].join("\n");
    expect(parsePorcelainStatus(text)).toEqual([{ status: " M", path: "ok.ts" }]);
  });
});

describe("splitUnifiedDiff", () => {
  const diff = [
    "noise before the first block is dropped",
    "diff --git a/src/a.ts b/src/a.ts",
    "index 111..222 100644",
    "--- a/src/a.ts",
    "+++ b/src/a.ts",
    "@@ -1,2 +1,2 @@",
    "-old line",
    "+new line",
    "diff --git a/added.ts b/added.ts",
    "new file mode 100644",
    "--- /dev/null",
    "+++ b/added.ts",
    "@@ -0,0 +1 @@",
    "+hello",
    "diff --git a/gone.ts b/gone.ts",
    "deleted file mode 100644",
    "--- a/gone.ts",
    "+++ /dev/null",
    "@@ -1 +0,0 @@",
    "-bye"
  ].join("\n");

  it("groups blocks by file path, including added and deleted files", () => {
    const blocks = splitUnifiedDiff(diff);
    expect([...blocks.keys()]).toEqual(["src/a.ts", "added.ts", "gone.ts"]);
    expect(blocks.get("src/a.ts")).toContain("+new line");
    expect(blocks.get("added.ts")).toContain("+hello");
    expect(blocks.get("gone.ts")).toContain("-bye");
  });

  it("ignores blocks without a usable path (binary files)", () => {
    const binary = [
      "diff --git a/img.png b/img.png",
      "index 111..222 100644",
      "Binary files a/img.png and b/img.png differ"
    ].join("\n");
    expect(splitUnifiedDiff(binary).size).toBe(0);
  });
});

describe("collectGitChanges", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "cxb-git-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function git(command: string): Promise<void> {
    const result = await runCommand(
      `git -c user.name=t -c user.email=t@t.com ${command}`,
      dir
    );
    expect(result.exitCode).toBe(0);
  }

  it("reports a non-repo directory", async () => {
    await expect(detectGitRepository(dir)).resolves.toBe(false);
    await expect(collectGitChanges(dir)).resolves.toEqual({ isRepo: false, files: [] });
  }, 20_000);

  it("collects staged, unstaged and untracked changes", async () => {
    await git("init");
    await expect(detectGitRepository(dir)).resolves.toBe(true);
    await writeFile(join(dir, "tracked.txt"), "one\n");
    await writeFile(join(dir, "staged.txt"), "base\n");
    await git("add .");
    await git('commit -m "base"');

    await writeFile(join(dir, "tracked.txt"), "one\ntwo\n");
    await writeFile(join(dir, "staged.txt"), "changed\n");
    await git("add staged.txt");
    await writeFile(join(dir, "fresh.txt"), "alpha\nbeta\n");

    const result = await collectGitChanges(dir);
    expect(result.isRepo).toBe(true);
    const byPath = new Map(result.files.map((file) => [file.path, file]));

    expect(byPath.get("tracked.txt")?.status).toBe(" M");
    expect(byPath.get("tracked.txt")?.diff).toContain("+two");

    expect(byPath.get("staged.txt")?.status).toBe("M ");
    expect(byPath.get("staged.txt")?.diff).toContain("+changed");

    expect(byPath.get("fresh.txt")?.status).toBe("??");
    expect(byPath.get("fresh.txt")?.diff).toBe("+alpha\n+beta");
  }, 20_000);

  it("returns an empty diff for binary untracked files", async () => {
    await git("init");
    await writeFile(join(dir, "blob.bin"), Buffer.from([0, 1, 2, 0, 255]));

    const result = await collectGitChanges(dir);
    expect(result.files).toEqual([{ path: "blob.bin", status: "??", diff: "" }]);
  }, 20_000);
});
