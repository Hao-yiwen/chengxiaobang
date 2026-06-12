import { homedir } from "node:os";
import { join } from "node:path";

export function defaultDataDir(): string {
  return join(homedir(), ".chengxiaobang", "data");
}

export function defaultLogDir(dataDir = defaultDataDir()): string {
  return join(dataDir, "logs");
}

/** The 1024px PNG used as the dev dock icon (packaged builds use the .icns). */
export function devDockIconPath(appPath: string): string {
  return join(appPath, "build", "icon.png");
}

export function preloadPath(mainModuleUrl: string): string {
  return join(dirnameFromUrl(mainModuleUrl), "../preload/index.cjs");
}

export function rendererIndexPath(mainModuleUrl: string): string {
  return join(dirnameFromUrl(mainModuleUrl), "../renderer/index.html");
}

function dirnameFromUrl(url: string): string {
  return new URL(".", url).pathname;
}
