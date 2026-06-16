import { describe, expect, it } from "vitest";
import { previewKindForPath } from "../src/common/file-preview";

describe("previewKindForPath", () => {
  it("treats common ignore dotfiles as previewable text", () => {
    expect(previewKindForPath(".dockerignore")).toBe("text");
    expect(previewKindForPath(".eslintignore")).toBe("text");
    expect(previewKindForPath(".prettierignore")).toBe("text");
    expect(previewKindForPath(".npmignore")).toBe("text");
  });
});
