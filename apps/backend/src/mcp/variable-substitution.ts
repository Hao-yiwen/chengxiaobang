import { posix, win32 } from "node:path";
import type { McpServerSpec, ResolvedMcpServer } from "./types";

/** 变量替换上下文。userConfig 缺失的键最终会让 server 标记为待配置、不启动。 */
export interface SubstitutionContext {
  /** ${CLAUDE_PLUGIN_ROOT} */
  pluginRoot: string;
  /** ${CLAUDE_PROJECT_DIR}，即当前会话 workspacePath */
  projectDir: string;
  /** ${CLAUDE_PLUGIN_DATA}，启动前需 mkdir -p */
  pluginDataDir: string;
  /** ${user_config.X} 取值；undefined/空串视为缺失 */
  userConfig: Record<string, string | undefined>;
}

export interface SubstitutionResult {
  value: string;
  /** 缺失的 user_config 键名（去重前，由上层聚合）。 */
  missing: string[];
}

const VAR_PATTERN =
  /\$\{(CLAUDE_PLUGIN_ROOT|CLAUDE_PROJECT_DIR|CLAUDE_PLUGIN_DATA|user_config\.([A-Za-z0-9_]+))\}/g;

/**
 * 替换单个字符串里的 ${CLAUDE_*} 与 ${user_config.X} 占位符。
 * 只认这四类占位符，不做 shell 展开（不解析 ~、$HOME），与 Claude Code 行为一致、可预测。
 * 缺失的 user_config 键替换为空串并记入 missing。
 */
export function substituteVars(input: string, ctx: SubstitutionContext): SubstitutionResult {
  const missing: string[] = [];
  const value = input.replace(VAR_PATTERN, (match, token: string, userKey?: string) => {
    if (token === "CLAUDE_PLUGIN_ROOT") {
      return ctx.pluginRoot;
    }
    if (token === "CLAUDE_PROJECT_DIR") {
      return ctx.projectDir;
    }
    if (token === "CLAUDE_PLUGIN_DATA") {
      return ctx.pluginDataDir;
    }
    if (userKey) {
      const resolved = ctx.userConfig[userKey];
      if (resolved === undefined || resolved === "") {
        missing.push(userKey);
        return "";
      }
      return resolved;
    }
    return match;
  });
  return { value, missing };
}

/**
 * 替换整个 server spec 的 command/args/env/cwd，聚合所有缺失的 user_config 键。
 * cwd 替换后若为相对路径，以 pluginRoot resolve；projectScoped 由原始 spec 是否引用
 * ${CLAUDE_PROJECT_DIR} 决定（用于按 workspace 多实例还是全局单例）。
 */
export function substituteServerSpec(
  spec: McpServerSpec,
  ctx: SubstitutionContext
): { resolved: ResolvedMcpServer; missing: string[] } {
  const missing = new Set<string>();
  const collect = (input: string): string => {
    const result = substituteVars(input, ctx);
    for (const key of result.missing) {
      missing.add(key);
    }
    return result.value;
  };

  const command = collect(spec.command);
  const args = spec.args.map(collect);
  const env: Record<string, string> = {};
  for (const [key, raw] of Object.entries(spec.env)) {
    env[key] = collect(raw);
  }
  let cwd = spec.cwd ? collect(spec.cwd) : undefined;
  if (cwd && !looksAbsolute(cwd)) {
    cwd = resolveLikeBase(ctx.pluginRoot, cwd);
  }

  return {
    resolved: { key: spec.key, command, args, env, cwd, projectScoped: referencesProjectDir(spec) },
    missing: [...missing]
  };
}

/** 原始 spec（替换前）是否引用 ${CLAUDE_PROJECT_DIR}。 */
function referencesProjectDir(spec: McpServerSpec): boolean {
  const haystack = [spec.command, ...spec.args, spec.cwd ?? "", ...Object.values(spec.env)].join("\n");
  return haystack.includes("${CLAUDE_PROJECT_DIR}");
}

/** 同时识别 POSIX（/foo）与 Windows（C:\foo、\foo）绝对路径，便于跨平台。 */
function looksAbsolute(path: string): boolean {
  return path.startsWith("/") || path.startsWith("\\") || /^[A-Za-z]:[\\/]/.test(path);
}

function resolveLikeBase(basePath: string, targetPath: string): string {
  if (/^[A-Za-z]:[\\/]/.test(basePath) || basePath.startsWith("\\")) {
    return win32.resolve(basePath, targetPath);
  }
  if (basePath.startsWith("/")) {
    return posix.resolve(basePath, targetPath);
  }
  return posix.resolve(basePath, targetPath);
}
