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

export function defaultProviderConfigPath(): string {
  return join(chengxiaobangRoot(), "config.yaml");
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
  const candidates = [moduleDir, dirname(moduleDir)];
  for (const candidate of candidates) {
    if (existsSync(join(candidate, "skills"))) {
      return candidate;
    }
  }
  // 探测失败说明打包布局变动或 skills 目录被裁剪;此时 skills/skills-market/prompts 会
  // 全部静默加载为空且难以定位,这里显式报错暴露根定位失败,而不是默默回退。
  console.error("[paths] 无法定位内置资源根:未在候选目录下找到 skills/,内置技能与提示将为空", {
    moduleDir,
    candidates
  });
  return moduleDir;
}
