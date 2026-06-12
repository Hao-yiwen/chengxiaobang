import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 根目录默认是 ~/.chengxiaobang;CHENGXIAOBANG_HOME 可整体重定向,
 * 测试环境依赖它避免把 session 工作目录写进用户真实的 home。
 */
function chengxiaobangRoot(): string {
  return process.env.CHENGXIAOBANG_HOME ?? join(homedir(), ".chengxiaobang");
}

export function defaultDataDir(): string {
  return join(chengxiaobangRoot(), "data");
}

export function defaultSessionDir(sessionId: string): string {
  return join(chengxiaobangRoot(), sessionId);
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
