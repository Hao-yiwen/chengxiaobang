import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  detectInstalledProjectOpeners,
  projectOpenerBundleIconFileNames,
  projectOpenerSearchDirs,
  PROJECT_OPENER_DEFINITIONS
} from "../src/main/ide";

describe("projectOpenerSearchDirs", () => {
  it("searches the system and user Applications folders", () => {
    expect(projectOpenerSearchDirs("/Users/me")).toEqual([
      "/Applications",
      join("/Users/me", "Applications")
    ]);
  });
});

describe("projectOpenerBundleIconFileNames", () => {
  it("keeps explicit icns names and adds an icns candidate for extensionless names", () => {
    expect(projectOpenerBundleIconFileNames("Code.icns")).toEqual(["Code.icns"]);
    expect(projectOpenerBundleIconFileNames("Ghostty")).toEqual(["Ghostty.icns", "Ghostty"]);
  });
});

describe("detectInstalledProjectOpeners", () => {
  const dirs = ["/Applications", "/Users/me/Applications"];

  it("finds project openers installed in /Applications", async () => {
    const exists = (path: string) =>
      path === "/Applications/Visual Studio Code.app" || path === "/Applications/Zed.app";
    await expect(detectInstalledProjectOpeners(dirs, exists)).resolves.toEqual([
      {
        id: "vscode",
        name: "VS Code",
        appPath: "/Applications/Visual Studio Code.app",
        iconDataUrl: undefined
      },
      { id: "zed", name: "Zed", appPath: "/Applications/Zed.app", iconDataUrl: undefined }
    ]);
  });

  it("finds project openers installed only in the user Applications folder", async () => {
    const exists = (path: string) => path === "/Users/me/Applications/Cursor.app";
    await expect(detectInstalledProjectOpeners(dirs, exists)).resolves.toEqual([
      {
        id: "cursor",
        name: "Cursor",
        appPath: "/Users/me/Applications/Cursor.app",
        iconDataUrl: undefined
      }
    ]);
  });

  it("falls back to the CE edition when the main bundle is absent", async () => {
    const exists = (path: string) => path === "/Applications/IntelliJ IDEA CE.app";
    await expect(detectInstalledProjectOpeners(dirs, exists)).resolves.toEqual([
      {
        id: "idea",
        name: "IntelliJ IDEA",
        appPath: "/Applications/IntelliJ IDEA CE.app",
        iconDataUrl: undefined
      }
    ]);
  });

  it("finds system apps from fixed paths", async () => {
    const exists = (path: string) =>
      path === "/System/Library/CoreServices/Finder.app" ||
      path === "/System/Applications/Utilities/Terminal.app";
    await expect(detectInstalledProjectOpeners(dirs, exists)).resolves.toEqual([
      {
        id: "finder",
        name: "Finder",
        appPath: "/System/Library/CoreServices/Finder.app",
        iconDataUrl: undefined
      },
      {
        id: "terminal",
        name: "Terminal",
        appPath: "/System/Applications/Utilities/Terminal.app",
        iconDataUrl: undefined
      }
    ]);
  });

  it("attaches app icon data when the loader returns it", async () => {
    const exists = (path: string) => path === "/Applications/Warp.app";
    await expect(
      detectInstalledProjectOpeners(dirs, exists, async (appPath) => `icon:${appPath}`)
    ).resolves.toEqual([
      {
        id: "warp",
        name: "Warp",
        appPath: "/Applications/Warp.app",
        iconDataUrl: "icon:/Applications/Warp.app"
      }
    ]);
  });

  it("keeps the opener when icon loading fails", async () => {
    const exists = (path: string) => path === "/Applications/Cursor.app";
    await expect(
      detectInstalledProjectOpeners(dirs, exists, async () => {
        throw new Error("icon unavailable");
      })
    ).resolves.toEqual([
      {
        id: "cursor",
        name: "Cursor",
        appPath: "/Applications/Cursor.app",
        iconDataUrl: undefined
      }
    ]);
  });

  it("returns an empty list when nothing is installed", async () => {
    await expect(detectInstalledProjectOpeners(dirs, () => false)).resolves.toEqual([]);
  });

  it("covers all project openers shown in the menu mockup", () => {
    expect(PROJECT_OPENER_DEFINITIONS.map((opener) => opener.id)).toEqual([
      "vscode",
      "cursor",
      "zed",
      "windsurf",
      "antigravity",
      "finder",
      "terminal",
      "iterm2",
      "ghostty",
      "warp",
      "xcode",
      "android-studio",
      "idea",
      "goland",
      "pycharm"
    ]);
  });
});
