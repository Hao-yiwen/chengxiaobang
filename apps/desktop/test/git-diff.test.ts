import { describe, expect, it } from "vitest";
import {
  gitChangeStats,
  gitStatusKind,
  unifiedDiffToLines
} from "../src/renderer/lib/git-diff";

describe("unifiedDiffToLines", () => {
  it("maps diff body lines and drops headers", () => {
    const diff = [
      "diff --git a/a.ts b/a.ts",
      "index 111..222 100644",
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@ -1,2 +1,2 @@",
      " context line",
      "-removed line",
      "+added line",
      "\\ No newline at end of file"
    ].join("\n");
    expect(unifiedDiffToLines(diff)).toEqual([
      { type: "context", text: "@@ -1,2 +1,2 @@", hunk: true },
      { type: "context", text: "context line", oldLineNumber: 1, newLineNumber: 1 },
      { type: "removed", text: "removed line", oldLineNumber: 2 },
      { type: "added", text: "added line", newLineNumber: 2 }
    ]);
  });

  it("keeps the all-added shape of untracked file content", () => {
    expect(unifiedDiffToLines("+alpha\n+beta")).toEqual([
      { type: "added", text: "alpha" },
      { type: "added", text: "beta" }
    ]);
  });
});

describe("gitChangeStats", () => {
  it("counts added and removed content lines without diff headers", () => {
    expect(
      gitChangeStats([
        {
          diff: [
            "--- a/a.ts",
            "+++ b/a.ts",
            "@@ -1 +1,2 @@",
            "-old",
            "+new",
            "+next"
          ].join("\n")
        }
      ])
    ).toEqual({ additions: 2, deletions: 1 });
  });
});

describe("gitStatusKind", () => {
  it("collapses porcelain codes into label kinds", () => {
    expect(gitStatusKind("??")).toBe("untracked");
    expect(gitStatusKind("A ")).toBe("added");
    expect(gitStatusKind(" D")).toBe("deleted");
    expect(gitStatusKind("R ")).toBe("renamed");
    expect(gitStatusKind(" M")).toBe("modified");
    expect(gitStatusKind("MM")).toBe("modified");
  });
});
