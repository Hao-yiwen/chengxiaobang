import { describe, expect, it } from "vitest";
import {
  createTextDiffSource,
  parseGitPatchDiff,
  textDiffFiles
} from "../src/renderer/lib/diff";

describe("text diff sources", () => {
  it("builds old/new file contents for Edit and Write previews", () => {
    const source = createTextDiffSource({
      fileName: " src/a.ts ",
      oldText: "x = 1",
      newText: "x = 2",
      cacheKey: "tool_1:edit"
    });

    expect(source).toEqual({
      kind: "text",
      fileName: "src/a.ts",
      oldText: "x = 1",
      newText: "x = 2",
      cacheKey: "tool_1:edit"
    });
    expect(textDiffFiles(source)).toEqual({
      oldFile: {
        name: "src/a.ts",
        contents: "x = 1",
        cacheKey: "tool_1:edit:old"
      },
      newFile: {
        name: "src/a.ts",
        contents: "x = 2",
        cacheKey: "tool_1:edit:new"
      }
    });
  });
});

describe("parseGitPatchDiff", () => {
  it("parses a complete git patch", () => {
    const blocks = parseGitPatchDiff({
      patch: [
        "diff --git a/src/a.ts b/src/a.ts",
        "--- a/src/a.ts",
        "+++ b/src/a.ts",
        "@@ -1 +1 @@",
        "-old line",
        "+new line"
      ].join("\n"),
      path: "src/a.ts",
      cacheKeyPrefix: "change:src/a.ts"
    });

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      kind: "file",
      fileDiff: {
        name: "src/a.ts",
        deletionLines: ["old line\n"],
        additionLines: ["new line\n"]
      }
    });
  });

  it("parses a synthesized untracked-file patch", () => {
    const blocks = parseGitPatchDiff({
      patch: [
        "diff --git a/fresh.txt b/fresh.txt",
        "new file mode 100644",
        "--- /dev/null",
        "+++ b/fresh.txt",
        "@@ -0,0 +1,2 @@",
        "+alpha",
        "+beta"
      ].join("\n"),
      path: "fresh.txt",
      cacheKeyPrefix: "change:fresh.txt"
    });

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      kind: "file",
      fileDiff: {
        name: "fresh.txt",
        deletionLines: [],
        additionLines: ["alpha\n", "beta\n"]
      }
    });
  });

  it("returns one block per file when a patch contains multiple file blocks", () => {
    const blocks = parseGitPatchDiff({
      patch: [
        "diff --git a/a.ts b/a.ts",
        "--- a/a.ts",
        "+++ b/a.ts",
        "@@ -1 +1 @@",
        "-a",
        "+aa",
        "diff --git a/b.ts b/b.ts",
        "--- a/b.ts",
        "+++ b/b.ts",
        "@@ -1 +1 @@",
        "-b",
        "+bb"
      ].join("\n"),
      path: "mixed",
      cacheKeyPrefix: "change:mixed"
    });

    expect(blocks).toHaveLength(2);
    expect(blocks.map((block) => block.kind === "file" ? block.fileDiff.name : "raw")).toEqual([
      "a.ts",
      "b.ts"
    ]);
  });

  it("keeps raw fallback for unparseable non-empty diffs", () => {
    expect(
      parseGitPatchDiff({
        patch: "+alpha\n+beta",
        path: "fresh.txt",
        cacheKeyPrefix: "change:fresh.txt"
      })
    ).toEqual([
      {
        kind: "raw",
        id: "change:fresh.txt:raw",
        raw: "+alpha\n+beta\n",
        error: "没有解析到 fresh.txt 的文件 diff"
      }
    ]);
  });

  it("returns no blocks for empty diffs", () => {
    expect(
      parseGitPatchDiff({
        patch: "",
        path: "blob.bin",
        cacheKeyPrefix: "change:blob.bin"
      })
    ).toEqual([]);
  });
});
