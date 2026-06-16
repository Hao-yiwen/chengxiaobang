import { describe, expect, it } from "vitest";
import {
  gitChangeStats,
  gitStatusKind
} from "../src/renderer/lib/git-diff";

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

  it("uses the requested staged or unstaged status column", () => {
    expect(gitStatusKind("AD", "staged")).toBe("added");
    expect(gitStatusKind("AD", "unstaged")).toBe("deleted");
    expect(gitStatusKind("R ", "staged")).toBe("renamed");
    expect(gitStatusKind(" M", "unstaged")).toBe("modified");
  });
});
