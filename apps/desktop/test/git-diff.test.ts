import { describe, expect, it } from "vitest";
import { gitStatusKind, unifiedDiffToLines } from "../src/renderer/lib/git-diff";

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
      { type: "context", text: "@@ -1,2 +1,2 @@" },
      { type: "context", text: "context line" },
      { type: "removed", text: "removed line" },
      { type: "added", text: "added line" }
    ]);
  });

  it("keeps the all-added shape of untracked file content", () => {
    expect(unifiedDiffToLines("+alpha\n+beta")).toEqual([
      { type: "added", text: "alpha" },
      { type: "added", text: "beta" }
    ]);
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
