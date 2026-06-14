import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  defaultDataDir,
  defaultLogDir,
  defaultProfilePath,
  devDockIconPath,
  preloadPath,
  rendererIndexPath
} from "../src/main/paths";

describe("main process paths", () => {
  it("resolves data dir inside the configured chengxiaobang root", () => {
    const root = process.env.CHENGXIAOBANG_HOME ?? join(homedir(), ".chengxiaobang");
    expect(defaultDataDir()).toBe(join(root, "data"));
  });

  it("defaults log dir to the logs folder inside the data dir", () => {
    expect(defaultLogDir()).toBe(join(defaultDataDir(), "logs"));
    expect(defaultLogDir("/tmp/cxb-data")).toBe(join("/tmp/cxb-data", "logs"));
  });

  it("resolves profile path inside the configured chengxiaobang root", () => {
    const root = process.env.CHENGXIAOBANG_HOME ?? join(homedir(), ".chengxiaobang");
    expect(defaultProfilePath()).toBe(join(root, "profile.json"));
  });

  it("resolves the dev dock icon inside the app's build directory", () => {
    expect(devDockIconPath("/repo/apps/desktop")).toBe(join("/repo/apps/desktop", "build", "icon.png"));
  });

  it("loads the CommonJS preload bundle from the sandboxed window", () => {
    const appRoot = join(process.cwd(), "fixtures", "ChengXiaoBang.app", "Contents", "Resources", "app.asar");
    const mainUrl = pathToFileURL(join(appRoot, "dist", "main", "main.js")).href;

    expect(preloadPath(mainUrl)).toBe(join(appRoot, "dist", "preload", "index.cjs"));
    expect(rendererIndexPath(mainUrl)).toBe(join(appRoot, "dist", "renderer", "index.html"));
  });
});
