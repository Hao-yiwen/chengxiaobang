import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function chengxiaobangRoot(): string {
  return process.env.CHENGXIAOBANG_HOME ?? join(homedir(), ".chengxiaobang");
}

export function defaultDataDir(): string {
  return join(chengxiaobangRoot(), "data");
}

export function defaultLogDir(dataDir = defaultDataDir()): string {
  return join(dataDir, "logs");
}

export function defaultProviderConfigPath(): string {
  return join(chengxiaobangRoot(), "config.yaml");
}

export function defaultProfilePath(): string {
  return join(chengxiaobangRoot(), "profile.json");
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
  return dirname(fileURLToPath(url));
}
