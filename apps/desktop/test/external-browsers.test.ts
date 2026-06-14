import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_EXTERNAL_BROWSER_ID,
  detectInstalledExternalBrowsers,
  externalBrowserDefinitions,
  externalBrowserLaunchCommand,
  externalBrowserSearchDirs,
  openExternalUrlInBrowser
} from "../src/main/browsers";

describe("external browsers", () => {
  it("detects installed macOS browsers from application folders", async () => {
    const existing = new Set([
      "/Applications/Safari.app",
      "/Applications/Google Chrome.app",
      "/Users/demo/Applications/Firefox.app"
    ]);

    const browsers = await detectInstalledExternalBrowsers(
      externalBrowserSearchDirs("/Users/demo", "darwin"),
      (path) => existing.has(path),
      externalBrowserDefinitions("darwin", {})
    );

    expect(browsers.map((browser) => browser.id)).toEqual(["safari", "chrome", "firefox"]);
  });

  it("detects installed Windows browsers and only includes IE when iexplore exists", async () => {
    const env = {
      LOCALAPPDATA: "C:\\Users\\demo\\AppData\\Local",
      ProgramFiles: "C:\\Program Files",
      "ProgramFiles(x86)": "C:\\Program Files (x86)"
    };
    const definitions = externalBrowserDefinitions("win32", env);
    const chromePath = definitions.find((browser) => browser.id === "chrome")?.absoluteAppPaths?.[0];
    const iePath = definitions.find((browser) => browser.id === "ie")?.absoluteAppPaths?.[0];
    const existing = new Set([chromePath, iePath].filter((path): path is string => Boolean(path)));

    const browsers = await detectInstalledExternalBrowsers(
      externalBrowserSearchDirs("C:\\Users\\demo", "win32"),
      (path) => existing.has(path),
      definitions
    );

    expect(browsers.map((browser) => browser.id)).toEqual(["chrome", "ie"]);
  });

  it("rejects unsupported urls before opening anything", async () => {
    const execFile = vi.fn();
    const openDefault = vi.fn();

    const result = await openExternalUrlInBrowser(DEFAULT_EXTERNAL_BROWSER_ID, "file:///tmp/a.html", {
      platform: "darwin",
      env: {},
      home: "/Users/demo",
      exists: () => false,
      execFile,
      openDefault
    });

    expect(result).toEqual({ ok: false, error: "只支持打开 HTTP(S) 链接" });
    expect(execFile).not.toHaveBeenCalled();
    expect(openDefault).not.toHaveBeenCalled();
  });

  it("opens default browser through the injected default opener", async () => {
    const openDefault = vi.fn(async () => undefined);

    const result = await openExternalUrlInBrowser(
      DEFAULT_EXTERNAL_BROWSER_ID,
      "https://example.com/docs",
      {
        platform: "darwin",
        env: {},
        home: "/Users/demo",
        exists: () => false,
        execFile: vi.fn(),
        openDefault
      }
    );

    expect(result).toEqual({ ok: true });
    expect(openDefault).toHaveBeenCalledWith("https://example.com/docs");
  });

  it("rejects unknown browser selections", async () => {
    const result = await openExternalUrlInBrowser("chrome", "https://example.com/docs", {
      platform: "darwin",
      env: {},
      home: "/Users/demo",
      exists: () => false,
      execFile: vi.fn(),
      openDefault: vi.fn()
    });

    expect(result).toEqual({ ok: false, error: "未知浏览器" });
  });

  it("opens a detected browser by id", async () => {
    const execFile = vi.fn((command: string, args: string[], callback: (error: Error | null) => void) => {
      callback(null);
    });

    const result = await openExternalUrlInBrowser("chrome", "https://example.com/docs", {
      platform: "darwin",
      env: {},
      home: "/Users/demo",
      exists: (path) => path === "/Applications/Google Chrome.app",
      execFile,
      openDefault: vi.fn()
    });

    expect(result).toEqual({ ok: true });
    expect(execFile).toHaveBeenCalledWith(
      "open",
      ["-a", "/Applications/Google Chrome.app", "https://example.com/docs"],
      expect.any(Function)
    );
  });

  it("builds platform-specific browser launch commands", () => {
    expect(
      externalBrowserLaunchCommand(
        "/Applications/Google Chrome.app",
        "https://example.com",
        "darwin"
      )
    ).toEqual({
      command: "open",
      args: ["-a", "/Applications/Google Chrome.app", "https://example.com"]
    });
    expect(
      externalBrowserLaunchCommand("C:\\Chrome\\chrome.exe", "https://example.com", "win32")
    ).toEqual({
      command: "C:\\Chrome\\chrome.exe",
      args: ["https://example.com"]
    });
  });
});
