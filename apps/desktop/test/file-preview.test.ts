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

  it("treats common rc and config dotfiles as previewable text", () => {
    expect(previewKindForPath(".npmrc")).toBe("text");
    expect(previewKindForPath(".yarnrc")).toBe("text");
    expect(previewKindForPath(".prettierrc")).toBe("text");
    expect(previewKindForPath(".editorconfig")).toBe("text");
    expect(previewKindForPath(".DS_Store")).toBe("unsupported");
  });

  it("treats common source files as previewable code", () => {
    for (const path of [
      "scripts/make-deck.mjs",
      "eslint.config.cjs",
      "src/index.mts",
      "src/index.cts",
      "src/component.astro",
      "src/App.svelte",
      "schema/query.gql",
      "include/app.h",
      "include/app.hh",
      "include/app.hpp",
      "include/app.hxx",
      "scripts/setup.bash",
      "scripts/setup.zsh",
      "src/main.zig",
      "infra/main.tf",
      "infra/dev.tfvars"
    ]) {
      expect(previewKindForPath(path)).toBe("code");
    }
  });
});

describe("localFilePathFromHref", () => {
  it("recognizes previewable relative file links", () => {
    expect(localFilePathFromHref("青海旅游全攻略.pptx")).toBe("青海旅游全攻略.pptx");
    expect(localFilePathFromHref("reports/demo.pptx")).toBe("reports/demo.pptx");
    expect(localFilePathFromHref("./demo.xlsx")).toBe("./demo.xlsx");
    expect(localFilePathFromHref("scripts/make-deck.mjs")).toBe("scripts/make-deck.mjs");
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
