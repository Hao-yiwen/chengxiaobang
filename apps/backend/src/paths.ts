import { homedir } from "node:os";
import { join } from "node:path";

export function defaultDataDir(): string {
  return join(homedir(), ".chengxiaobang", "data");
}

export function defaultSessionDir(sessionId: string): string {
  return join(homedir(), ".chengxiaobang", sessionId);
}
