import { describe, expect, it } from "vitest";
import { diffLines } from "../src/renderer/lib/diff";

describe("diffLines", () => {
  it("marks identical text as all context", () => {
    expect(diffLines("a\nb", "a\nb")).toEqual([
      { type: "context", text: "a" },
      { type: "context", text: "b" }
    ]);
  });

  it("keeps surrounding context for a pure insertion", () => {
    expect(diffLines("a\nc", "a\nb\nc")).toEqual([
      { type: "context", text: "a" },
      { type: "added", text: "b" },
      { type: "context", text: "c" }
    ]);
  });

  it("keeps surrounding context for a pure deletion", () => {
    expect(diffLines("a\nb\nc", "a\nc")).toEqual([
      { type: "context", text: "a" },
      { type: "removed", text: "b" },
      { type: "context", text: "c" }
    ]);
  });

  it("emits removed before added for a replacement", () => {
    expect(diffLines("a\nold\nc", "a\nnew\nc")).toEqual([
      { type: "context", text: "a" },
      { type: "removed", text: "old" },
      { type: "added", text: "new" },
      { type: "context", text: "c" }
    ]);
  });

  it("treats empty old text as all added and empty new text as all removed", () => {
    expect(diffLines("", "a\nb")).toEqual([
      { type: "added", text: "a" },
      { type: "added", text: "b" }
    ]);
    expect(diffLines("a", "")).toEqual([{ type: "removed", text: "a" }]);
  });

  it("degrades to removed+added for oversized inputs without hanging", () => {
    const big = Array.from({ length: 400 }, (_, index) => `line${index}`).join("\n");
    const lines = diffLines(big, `${big}\nextra`);
    // 400 × 401 cells > 100k → blunt fallback, still complete and ordered.
    expect(lines.filter((line) => line.type === "removed")).toHaveLength(400);
    expect(lines.filter((line) => line.type === "added")).toHaveLength(401);
    expect(lines.some((line) => line.type === "context")).toBe(false);
  });
});
