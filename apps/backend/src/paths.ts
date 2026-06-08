import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function defaultDataDir(): string {
  return join(homedir(), ".chengxiaobang", "data");
}

export function defaultSessionDir(sessionId: string): string {
  return join(homedir(), ".chengxiaobang", sessionId);
}

/**
 * Root directory that contains the bundled `skills/` (and `prompts/`) folder.
 * In production this sits next to the bundled `main.js` (dist/); in dev the
 * built-in assets live in the package root, one level above `src/`.
 */
export function builtinResourceRoot(): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  for (const candidate of [moduleDir, dirname(moduleDir)]) {
    if (existsSync(join(candidate, "skills"))) {
      return candidate;
    }
  }
  return moduleDir;
}
