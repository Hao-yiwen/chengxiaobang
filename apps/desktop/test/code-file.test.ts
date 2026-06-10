import { describe, expect, it } from "vitest";
import { codeFileName, extensionForLanguage } from "../src/renderer/lib/code-file";

describe("extensionForLanguage", () => {
  it("maps common languages and aliases", () => {
    expect(extensionForLanguage("ts")).toBe("ts");
    expect(extensionForLanguage("typescript")).toBe("ts");
    expect(extensionForLanguage("javascript")).toBe("js");
    expect(extensionForLanguage("mjs")).toBe("js");
    expect(extensionForLanguage("python")).toBe("py");
    expect(extensionForLanguage("bash")).toBe("sh");
    expect(extensionForLanguage("zsh")).toBe("sh");
    expect(extensionForLanguage("yaml")).toBe("yml");
    expect(extensionForLanguage("rust")).toBe("rs");
    expect(extensionForLanguage("c++")).toBe("cpp");
  });

  it("is case-insensitive", () => {
    expect(extensionForLanguage("TypeScript")).toBe("ts");
    expect(extensionForLanguage("PYTHON")).toBe("py");
  });

  it("falls back to txt for unknown or missing languages", () => {
    expect(extensionForLanguage("nosuchlang")).toBe("txt");
    expect(extensionForLanguage(undefined)).toBe("txt");
    expect(extensionForLanguage("")).toBe("txt");
  });
});

describe("codeFileName", () => {
  it("builds a timestamped name with the mapped extension", () => {
    const now = new Date("2026-06-10T12:30:45.000Z");
    expect(codeFileName("ts", now)).toBe("code-20260610T123045.ts");
    expect(codeFileName(undefined, now)).toBe("code-20260610T123045.txt");
  });
});
