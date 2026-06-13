import { describe, expect, it } from "vitest";
import {
  isTrustedAppWindowUrl,
  localPathFromFileUrl,
  shouldAllowWebviewSrc,
  shouldOpenExternalFromAppWindow
} from "../src/main/navigation";

describe("shouldOpenExternalFromAppWindow", () => {
  it("does not externalize the Vite dev server origin", () => {
    expect(
      shouldOpenExternalFromAppWindow("http://127.0.0.1:5173/src/main.tsx", {
        devServerUrl: "http://127.0.0.1:5173"
      })
    ).toBe(false);
  });

  it("does not externalize same-origin renderer navigations", () => {
    expect(
      shouldOpenExternalFromAppWindow("http://127.0.0.1:5173/@vite/client", {
        currentUrl: "http://127.0.0.1:5173/"
      })
    ).toBe(false);
  });

  it("externalizes real http links outside the app window", () => {
    expect(
      shouldOpenExternalFromAppWindow("https://example.com/docs", {
        currentUrl: "http://127.0.0.1:5173/",
        devServerUrl: "http://127.0.0.1:5173"
      })
    ).toBe(true);
  });

  it("ignores non-http urls", () => {
    expect(shouldOpenExternalFromAppWindow("file:///tmp/index.html")).toBe(false);
  });
});

describe("shouldAllowWebviewSrc", () => {
  it("allows http(s) and local HTML/SVG preview files", () => {
    expect(shouldAllowWebviewSrc("https://example.com")).toBe(true);
    expect(shouldAllowWebviewSrc("file:///tmp/page%20one.html")).toBe(true);
    expect(shouldAllowWebviewSrc("file:///tmp/vector.svg")).toBe(true);
  });

  it("rejects unsafe or unsupported file urls", () => {
    expect(shouldAllowWebviewSrc("file:///tmp/secrets.txt")).toBe(false);
    expect(shouldAllowWebviewSrc("file://remote-host/tmp/page.html")).toBe(false);
    expect(shouldAllowWebviewSrc("javascript:alert(1)")).toBe(false);
  });
});

describe("localPathFromFileUrl", () => {
  it("decodes local file URLs into paths", () => {
    expect(localPathFromFileUrl("file:///tmp/page%20one.html")).toBe("/tmp/page one.html");
  });
});

describe("isTrustedAppWindowUrl", () => {
  it("trusts only the configured Vite origin in dev", () => {
    expect(
      isTrustedAppWindowUrl("http://127.0.0.1:5173/src/main.tsx", {
        devServerUrl: "http://127.0.0.1:5173"
      })
    ).toBe(true);
    expect(
      isTrustedAppWindowUrl("https://example.com", {
        devServerUrl: "http://127.0.0.1:5173"
      })
    ).toBe(false);
  });

  it("trusts only the packaged renderer file", () => {
    expect(
      isTrustedAppWindowUrl("file:///Applications/App.app/Contents/Resources/dist/index.html#chat", {
        rendererFilePath: "/Applications/App.app/Contents/Resources/dist/index.html"
      })
    ).toBe(true);
    expect(
      isTrustedAppWindowUrl("file:///Users/me/secrets.html", {
        rendererFilePath: "/Applications/App.app/Contents/Resources/dist/index.html"
      })
    ).toBe(false);
    expect(isTrustedAppWindowUrl("data:text/html,boom")).toBe(false);
  });
});
