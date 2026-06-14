import { join } from "node:path";
import { pathToFileURL } from "node:url";
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
    const htmlUrl = pathToFileURL(join(process.cwd(), "tmp", "page one.html")).href;
    const svgUrl = pathToFileURL(join(process.cwd(), "tmp", "vector.svg")).href;

    expect(shouldAllowWebviewSrc("https://example.com")).toBe(true);
    expect(shouldAllowWebviewSrc(htmlUrl)).toBe(true);
    expect(shouldAllowWebviewSrc(svgUrl)).toBe(true);
  });

  it("rejects unsafe or unsupported file urls", () => {
    const textUrl = pathToFileURL(join(process.cwd(), "tmp", "secrets.txt")).href;

    expect(shouldAllowWebviewSrc(textUrl)).toBe(false);
    expect(shouldAllowWebviewSrc("file://remote-host/tmp/page.html")).toBe(false);
    expect(shouldAllowWebviewSrc("javascript:alert(1)")).toBe(false);
  });
});

describe("localPathFromFileUrl", () => {
  it("decodes local file URLs into paths", () => {
    const path = join(process.cwd(), "tmp", "page one.html");
    expect(localPathFromFileUrl(pathToFileURL(path).href)).toBe(path);
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
    const rendererPath = join(process.cwd(), "dist", "index.html");
    const rendererUrl = `${pathToFileURL(rendererPath).href}#chat`;
    const secretUrl = pathToFileURL(join(process.cwd(), "secrets.html")).href;

    expect(
      isTrustedAppWindowUrl(rendererUrl, {
        rendererFilePath: rendererPath
      })
    ).toBe(true);
    expect(
      isTrustedAppWindowUrl(secretUrl, {
        rendererFilePath: rendererPath
      })
    ).toBe(false);
    expect(isTrustedAppWindowUrl("data:text/html,boom")).toBe(false);
  });
});
