import { describe, expect, it } from "vitest";
import {
  hastText,
  isSafeHref,
  languageFromClass,
  rehypeMarkCodeBlocks,
  type HastNode
} from "../src/renderer/lib/markdown-utils";

describe("isSafeHref", () => {
  it("accepts http and https", () => {
    expect(isSafeHref("https://example.com")).toBe(true);
    expect(isSafeHref("http://example.com/path?a=1")).toBe(true);
    expect(isSafeHref("HTTPS://EXAMPLE.COM")).toBe(true);
  });

  it("rejects other protocols and empty strings", () => {
    expect(isSafeHref("javascript:alert(1)")).toBe(false);
    expect(isSafeHref("mailto:a@b.com")).toBe(false);
    expect(isSafeHref("file:///etc/passwd")).toBe(false);
    expect(isSafeHref("")).toBe(false);
    expect(isSafeHref("//example.com")).toBe(false);
  });
});

describe("hastText", () => {
  it("collects text across nested highlight spans", () => {
    const node: HastNode = {
      type: "element",
      tagName: "code",
      children: [
        {
          type: "element",
          tagName: "span",
          children: [{ type: "text", value: "const" }]
        },
        { type: "text", value: " x = " },
        {
          type: "element",
          tagName: "span",
          children: [{ type: "text", value: "1" }]
        },
        { type: "text", value: ";" }
      ]
    };
    expect(hastText(node)).toBe("const x = 1;");
  });

  it("returns empty string for undefined or empty nodes", () => {
    expect(hastText(undefined)).toBe("");
    expect(hastText({ type: "element", tagName: "code" })).toBe("");
  });
});

describe("languageFromClass", () => {
  it("reads hast class arrays", () => {
    expect(languageFromClass(["hljs", "language-ts"])).toBe("ts");
    expect(languageFromClass(["language-Python"])).toBe("python");
  });

  it("reads class strings", () => {
    expect(languageFromClass("hljs language-tsx")).toBe("tsx");
  });

  it("returns undefined when no language class is present", () => {
    expect(languageFromClass(["hljs"])).toBeUndefined();
    expect(languageFromClass(undefined)).toBeUndefined();
  });
});

describe("rehypeMarkCodeBlocks", () => {
  it("tags only code elements directly inside pre", () => {
    const inline: HastNode = { type: "element", tagName: "code", properties: {} };
    const block: HastNode = { type: "element", tagName: "code", properties: {} };
    const tree: HastNode = {
      type: "root",
      children: [
        { type: "element", tagName: "p", children: [inline] },
        { type: "element", tagName: "pre", children: [block] }
      ]
    };

    rehypeMarkCodeBlocks()(tree);

    expect(block.properties?.dataCodeBlock).toBe("");
    expect(inline.properties?.dataCodeBlock).toBeUndefined();
  });
});
