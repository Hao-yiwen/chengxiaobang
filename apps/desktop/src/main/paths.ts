import { homedir } from "node:os";
import { join } from "node:path";

export function defaultDataDir(): string {
  return join(homedir(), ".chengxiaobang", "data");
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
