import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  checkoutGitBranch,
  collectGitChanges,
  collectGitEnvironment,
  collectGitFileDiff,
  collectGitGraph,
  commitGitChanges,
  createGitBranch,
  detectGitRepository,
  parseGitGraphLog,
  parsePorcelainStatus,
  pushGitBranch,
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

describe("parseGitGraphLog", () => {
  it("normalizes decorated refs", () => {
    const text =
      "\x1fabc123456\x1fparent1 parent2\x1fAda\x1f2026-06-24T12:00:00+08:00\x1fHEAD -> refs/heads/main, refs/remotes/origin/main, tag: refs/tags/v1\x1ffeat: graph\x1e";

    expect(parseGitGraphLog(text)).toEqual([
      {
        hash: "abc123456",
        shortHash: "abc1234",
        parents: ["parent1", "parent2"],
        subject: "feat: graph",
        authorName: "Ada",
        date: "2026-06-24T12:00:00+08:00",
        refs: [
          { name: "HEAD", type: "head" },
          { name: "main", type: "local" },
          { name: "origin/main", type: "remote" },
          { name: "v1", type: "tag" }
        ]
      }
    ]);
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
    await writeFile(join(dir, "both.txt"), "base\n");
    await git("add .");
    await git("commit -m base");

    await writeFile(join(dir, "tracked.txt"), "one\ntwo\n");
    await writeFile(join(dir, "staged.txt"), "changed\n");
    await git("add staged.txt");
    await writeFile(join(dir, "both.txt"), "staged\n");
    await git("add both.txt");
    await writeFile(join(dir, "both.txt"), "unstaged\n");
    await writeFile(join(dir, "fresh.txt"), "alpha\nbeta\n");

    const result = await collectGitChanges(dir);
    expect(result.isRepo).toBe(true);
    const byScopePath = new Map(result.files.map((file) => [`${file.scope}:${file.path}`, file]));

    expect(byScopePath.get("unstaged:tracked.txt")?.status).toBe(" M");
    expect(byScopePath.get("unstaged:tracked.txt")?.diff).toBe("");
    expect(byScopePath.get("unstaged:tracked.txt")?.additions).toBe(1);
    expect(byScopePath.get("unstaged:tracked.txt")?.deletions).toBe(0);

    expect(byScopePath.get("staged:staged.txt")?.status).toBe("M ");
    expect(byScopePath.get("staged:staged.txt")?.diff).toBe("");
    expect(byScopePath.get("staged:staged.txt")?.additions).toBe(1);
    expect(byScopePath.get("staged:staged.txt")?.deletions).toBe(1);

    expect(byScopePath.get("staged:both.txt")?.status).toBe("MM");
    expect(byScopePath.get("staged:both.txt")?.diff).toBe("");

    expect(byScopePath.get("unstaged:both.txt")?.status).toBe("MM");
    expect(byScopePath.get("unstaged:both.txt")?.diff).toBe("");

    expect(byScopePath.get("unstaged:fresh.txt")?.status).toBe("??");
    expect(byScopePath.get("unstaged:fresh.txt")?.diff).toBe("");
    expect(byScopePath.get("unstaged:fresh.txt")?.additions).toBeUndefined();
    expect(byScopePath.get("unstaged:fresh.txt")?.deletions).toBeUndefined();

    const trackedDiff = await collectGitFileDiff(dir, { scope: "unstaged", path: "tracked.txt" });
    expect(trackedDiff?.diff).toContain("+two");
    expect(trackedDiff?.additions).toBe(1);
    expect(trackedDiff?.deletions).toBe(0);

    const stagedDiff = await collectGitFileDiff(dir, { scope: "staged", path: "staged.txt" });
    expect(stagedDiff?.diff).toContain("+changed");
    expect(stagedDiff?.additions).toBe(1);
    expect(stagedDiff?.deletions).toBe(1);

    const stagedBothDiff = await collectGitFileDiff(dir, { scope: "staged", path: "both.txt" });
    expect(stagedBothDiff?.diff).toContain("-base");
    expect(stagedBothDiff?.diff).toContain("+staged");
    expect(stagedBothDiff?.diff).not.toContain("+unstaged");

    const unstagedBothDiff = await collectGitFileDiff(dir, { scope: "unstaged", path: "both.txt" });
    expect(unstagedBothDiff?.diff).toContain("-staged");
    expect(unstagedBothDiff?.diff).toContain("+unstaged");
    expect(unstagedBothDiff?.diff).not.toContain("-base");

    const freshDiff = await collectGitFileDiff(dir, { scope: "unstaged", path: "fresh.txt" });
    expect(freshDiff?.diff).toContain("diff --git a/fresh.txt b/fresh.txt");
    expect(freshDiff?.diff).toContain("--- /dev/null");
    expect(freshDiff?.diff).toContain("+++ b/fresh.txt");
    expect(freshDiff?.diff).toContain("@@ -0,0 +1,2 @@");
    expect(freshDiff?.diff).toContain("+alpha");
    expect(freshDiff?.diff).toContain("+beta");
    expect(freshDiff?.additions).toBe(2);
    expect(freshDiff?.deletions).toBe(0);
  }, 20_000);

  it("reports a non-repo directory for the graph", async () => {
    await expect(collectGitGraph(dir)).resolves.toEqual({ isRepo: false, commits: [] });
  }, 20_000);

  it("collects commit graph commits, parents and refs", async () => {
    await git("init");
    await git("branch -M main");
    await writeFile(join(dir, "base.txt"), "base\n");
    await git("add .");
    await git("commit -m chore-base");

    await git("switch -c feature");
    await writeFile(join(dir, "feature.txt"), "feature\n");
    await git("add .");
    await git("commit -m feat-branch-work");

    await git("switch main");
    await writeFile(join(dir, "main.txt"), "main\n");
    await git("add .");
    await git("commit -m fix-main-work");
    await git("merge --no-ff feature -m merge-feature");
    await git("tag v1");
    await git("update-ref refs/remotes/origin/main HEAD");

    const graph = await collectGitGraph(dir, { limit: 20 });
    expect(graph.isRepo).toBe(true);
    expect(graph.head).toBe("main");
    expect(graph.commits[0]).toMatchObject({
      subject: "merge-feature",
      parents: [expect.any(String), expect.any(String)]
    });
    expect(graph.commits[0].refs).toEqual(
      expect.arrayContaining([
        { name: "main", type: "local" },
        { name: "origin/main", type: "remote" },
        { name: "v1", type: "tag" }
      ])
    );
    expect(graph.commits.map((commit) => commit.subject)).toEqual(
      expect.arrayContaining(["feat-branch-work", "fix-main-work", "chore-base"])
    );
  }, 20_000);

  it("reports branch environment and change totals", async () => {
    await git("init");
    await git("branch -M main");
    await writeFile(join(dir, "tracked.txt"), "one\n");
    await writeFile(join(dir, "staged.txt"), "base\n");
    await git("add .");
    await git("commit -m base");

    await writeFile(join(dir, "tracked.txt"), "one\ntwo\n");
    await writeFile(join(dir, "staged.txt"), "changed\n");
    await git("add staged.txt");

    const environment = await collectGitEnvironment(dir);

    expect(environment.isRepo).toBe(true);
    expect(environment.branchName).toBe("main");
    expect(environment.changedFileCount).toBe(2);
    expect(environment.stagedFileCount).toBe(1);
    expect(environment.unstagedFileCount).toBe(1);
    expect(environment.additions).toBe(2);
    expect(environment.deletions).toBe(1);
    expect(environment.branches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "main", type: "local", current: true })
      ])
    );
  }, 20_000);

  it("checks out local, remote and newly created branches", async () => {
    await git("init");
    await git("branch -M main");
    await writeFile(join(dir, "tracked.txt"), "one\n");
    await git("add .");
    await git("commit -m base");
    await git("branch local-feature");

    const remote = await mkdtemp(join(tmpdir(), "cxb-git-remote-"));
    try {
      expect((await runCommand("git init --bare", remote)).exitCode).toBe(0);
      await git(`remote add origin ${gitRemoteUrl(remote)}`);
      await git("push -u origin main");
      await git("switch -c remote-feature");
      await writeFile(join(dir, "remote.txt"), "remote\n");
      await git("add .");
      await git("commit -m remote");
      await git("push origin remote-feature");
      await git("switch main");
      await git("branch -D remote-feature");
      await git("fetch origin");

      await checkoutGitBranch(dir, { branchName: "local-feature", branchType: "local" });
      expect((await collectGitEnvironment(dir)).branchName).toBe("local-feature");

      await checkoutGitBranch(dir, { branchName: "origin/remote-feature", branchType: "remote" });
      expect((await collectGitEnvironment(dir)).branchName).toBe("remote-feature");

      await createGitBranch(dir, { branchName: "created-feature" });
      expect((await collectGitEnvironment(dir)).branchName).toBe("created-feature");
    } finally {
      await rm(remote, { recursive: true, force: true });
    }
  }, 30_000);

  it("generates a commit message through the injected model callback", async () => {
    await git("init");
    await git("branch -M main");
    await writeFile(join(dir, "tracked.txt"), "one\n");
    await git("add .");
    await git("commit -m base");
    await git("config user.name t");
    await git("config user.email t@t.com");

    await writeFile(join(dir, "tracked.txt"), "one\ntwo\n");
    const result = await commitGitChanges(
      dir,
      { includeUnstaged: true },
      {
        generateMessage: async ({ status, diff }) => {
          expect(status).toContain("tracked.txt");
          expect(diff).toContain("+two");
          return "fix: update tracked file";
        }
      }
    );

    expect(result.message).toBe("fix: update tracked file");
    expect(result.commitHash).toMatch(/^[0-9a-f]+$/);
    expect((await runCommand("git status --porcelain", dir)).output.trim()).toBe("");
  }, 20_000);

  it("pushes a branch and sets origin upstream when missing", async () => {
    await git("init");
    await git("branch -M main");
    await writeFile(join(dir, "tracked.txt"), "one\n");
    await git("add .");
    await git("commit -m base");
    const remote = await mkdtemp(join(tmpdir(), "cxb-git-remote-"));
    try {
      expect((await runCommand("git init --bare", remote)).exitCode).toBe(0);
      await git(`remote add origin ${gitRemoteUrl(remote)}`);

      const result = await pushGitBranch(dir);

      expect(result.environment.upstream).toBe("origin/main");
      expect(result.environment.ahead).toBe(0);
    } finally {
      await rm(remote, { recursive: true, force: true });
    }
  }, 30_000);

  it("returns an empty diff for binary untracked files", async () => {
    await git("init");
    await writeFile(join(dir, "blob.bin"), Buffer.from([0, 1, 2, 0, 255]));

    const result = await collectGitChanges(dir);
    expect(result.files).toEqual([
      {
        path: "blob.bin",
        scope: "unstaged",
        status: "??",
        diff: ""
      }
    ]);
    await expect(
      collectGitFileDiff(dir, { scope: "unstaged", path: "blob.bin" })
    ).resolves.toEqual({
      path: "blob.bin",
      scope: "unstaged",
      status: "??",
      diff: ""
    });
  }, 20_000);

  it("loads a tracked file diff with spaces in the path", async () => {
    await git("init");
    await writeFile(join(dir, "space name.txt"), "old\n");
    await git("add .");
    await git("commit -m base");
    await writeFile(join(dir, "space name.txt"), "new\n");

    const file = await collectGitFileDiff(dir, { scope: "unstaged", path: "space name.txt" });

    expect(file?.diff).toContain("diff --git a/space name.txt b/space name.txt");
    expect(file?.diff).toContain("-old");
    expect(file?.diff).toContain("+new");
  }, 20_000);

  it("keeps small file diffs available when another file has a huge diff", async () => {
    await git("init");
    await writeFile(join(dir, "big.txt"), "base\n");
    await writeFile(join(dir, "small.txt"), "old\n");
    await git("add .");
    await git("commit -m base");
    await writeFile(
      join(dir, "big.txt"),
      Array.from({ length: 40_000 }, (_, index) => `line ${index}`).join("\n")
    );
    await writeFile(join(dir, "small.txt"), "new\n");

    const result = await collectGitChanges(dir);
    const byScopePath = new Map(result.files.map((file) => [`${file.scope}:${file.path}`, file]));

    expect(byScopePath.get("unstaged:big.txt")?.diff).toBe("");
    expect(byScopePath.get("unstaged:small.txt")?.diff).toBe("");
    const smallDiff = await collectGitFileDiff(dir, { scope: "unstaged", path: "small.txt" });
    expect(smallDiff?.diff).toContain("-old");
    expect(smallDiff?.diff).toContain("+new");
  }, 20_000);
});

function gitRemoteUrl(path: string): string {
  return pathToFileURL(path).href;
}
