import { describe, expect, it } from "vitest";
import {
  localFilePathFromHref,
  markdownLocalFileHrefFromPath,
  previewKindForPath
} from "../src/common/file-preview";

describe("previewKindForPath", () => {
  it("treats common ignore dotfiles as previewable text", () => {
    expect(previewKindForPath(".dockerignore")).toBe("text");
    expect(previewKindForPath(".eslintignore")).toBe("text");
    expect(previewKindForPath(".prettierignore")).toBe("text");
    expect(previewKindForPath(".npmignore")).toBe("text");
  });
});

describe("localFilePathFromHref", () => {
  it("recognizes previewable relative file links", () => {
    expect(localFilePathFromHref("青海旅游全攻略.pptx")).toBe("青海旅游全攻略.pptx");
    expect(localFilePathFromHref("reports/demo.pptx")).toBe("reports/demo.pptx");
    expect(localFilePathFromHref("./demo.xlsx")).toBe("./demo.xlsx");
  });

  it("round-trips markdown local file href wrappers", () => {
    const href = markdownLocalFileHrefFromPath("reports/青海旅游全攻略.pptx");

    expect(localFilePathFromHref(href)).toBe("reports/青海旅游全攻略.pptx");
  });

  it("does not treat external or unsafe links as local files", () => {
    expect(localFilePathFromHref("https://example.com/report.pptx")).toBeNull();
    expect(localFilePathFromHref("javascript:alert(1)")).toBeNull();
    expect(localFilePathFromHref("data:text/html,hello")).toBeNull();
    expect(localFilePathFromHref("blob:https://example.com/id")).toBeNull();
  });
});
