import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  defaultDataDir,
  devDockIconPath,
  preloadPath,
  rendererIndexPath
} from "../src/main/paths";

describe("main process paths", () => {
  it("defaults data dir to ~/.chengxiaobang/data", () => {
    expect(defaultDataDir()).toBe(join(homedir(), ".chengxiaobang", "data"));
  });

  it("resolves the dev dock icon inside the app's build directory", () => {
    expect(devDockIconPath("/repo/apps/desktop")).toBe("/repo/apps/desktop/build/icon.png");
  });

  it("loads the CommonJS preload bundle from the sandboxed window", () => {
    const mainUrl = "file:///Applications/ChengXiaoBang.app/Contents/Resources/app.asar/dist/main/main.js";

    expect(preloadPath(mainUrl)).toBe(
      "/Applications/ChengXiaoBang.app/Contents/Resources/app.asar/dist/preload/index.cjs"
    );
    expect(rendererIndexPath(mainUrl)).toBe(
      "/Applications/ChengXiaoBang.app/Contents/Resources/app.asar/dist/renderer/index.html"
    );
  });
});
