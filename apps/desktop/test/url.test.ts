import { describe, expect, it } from "vitest";
import { localPathFromFileUrl, normalizeBrowserUrl } from "../src/renderer/lib/url";

describe("normalizeBrowserUrl", () => {
  it("prefixes https for scheme-less input", () => {
    expect(normalizeBrowserUrl("example.com")).toBe("https://example.com/");
    expect(normalizeBrowserUrl("www.baidu.com")).toBe("https://www.baidu.com/");
    expect(normalizeBrowserUrl("www.google.com")).toBe("https://www.google.com/");
  });

  it("keeps explicit http(s) URLs", () => {
    expect(normalizeBrowserUrl("http://localhost:3000/x")).toBe("http://localhost:3000/x");
  });

  it("opens local-looking addresses with http", () => {
    expect(normalizeBrowserUrl("localhost:5173")).toBe("http://localhost:5173/");
    expect(normalizeBrowserUrl("127.0.0.1:3000")).toBe("http://127.0.0.1:3000/");
  });

  it("treats a bare port as a local dev server", () => {
    expect(normalizeBrowserUrl("5173")).toBe("http://127.0.0.1:5173/");
  });

  it("opens known site aliases directly", () => {
    expect(normalizeBrowserUrl("百度")).toBe("https://www.baidu.com/");
    expect(normalizeBrowserUrl("baidu")).toBe("https://www.baidu.com/");
    expect(normalizeBrowserUrl("谷歌")).toBe("https://www.google.com/");
    expect(normalizeBrowserUrl("google")).toBe("https://www.google.com/");
    expect(normalizeBrowserUrl("github")).toBe("https://github.com/");
    expect(normalizeBrowserUrl("淘宝")).toBe("https://www.taobao.com/");
    expect(normalizeBrowserUrl("B站")).toBe("https://www.bilibili.com/");
    expect(normalizeBrowserUrl("youtube")).toBe("https://www.youtube.com/");
  });

  it("does not navigate unknown non-url text", () => {
    expect(normalizeBrowserUrl("北京天气")).toBeUndefined();
    expect(normalizeBrowserUrl("hello world")).toBeUndefined();
    expect(normalizeBrowserUrl("example")).toBeUndefined();
  });

  it("rejects non-http schemes and empty input", () => {
    expect(normalizeBrowserUrl("file:///etc/passwd")).toBeUndefined();
    expect(normalizeBrowserUrl("javascript:alert(1)")).toBeUndefined();
    expect(normalizeBrowserUrl("mailto:hello@example.com")).toBeUndefined();
    expect(normalizeBrowserUrl("   ")).toBeUndefined();
  });
});

describe("localPathFromFileUrl", () => {
  it("returns decoded Unix local paths and rejects non-local URLs", () => {
    expect(localPathFromFileUrl("file:///tmp/demo/page%20one.html")).toBe("/tmp/demo/page one.html");
    expect(localPathFromFileUrl("file://remote-host/tmp/page.html")).toBeUndefined();
    expect(localPathFromFileUrl("https://example.com")).toBeUndefined();
  });

  it("converts Windows drive file URLs to local paths", () => {
    expect(localPathFromFileUrl("file:///C:/Users/me/a%20b.html")).toBe(
      "C:\\Users\\me\\a b.html"
    );
  });
});
