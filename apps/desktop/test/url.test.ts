import { describe, expect, it } from "vitest";
import { normalizeBrowserUrl } from "../src/renderer/lib/url";

describe("normalizeBrowserUrl", () => {
  it("prefixes https for scheme-less input", () => {
    expect(normalizeBrowserUrl("example.com")).toBe("https://example.com/");
  });

  it("keeps explicit http(s) URLs", () => {
    expect(normalizeBrowserUrl("http://localhost:3000/x")).toBe("http://localhost:3000/x");
  });

  it("treats a bare port as a local dev server", () => {
    expect(normalizeBrowserUrl("5173")).toBe("http://127.0.0.1:5173/");
  });

  it("rejects non-http schemes and garbage", () => {
    expect(normalizeBrowserUrl("file:///etc/passwd")).toBeUndefined();
    expect(normalizeBrowserUrl("javascript:alert(1)")).toBeUndefined();
    expect(normalizeBrowserUrl("   ")).toBeUndefined();
  });
});
