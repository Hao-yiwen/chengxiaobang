import { existsSync } from "node:fs";

export interface ResolvedCommand {
  command: string;
  args: string[];
  /** 无法解析（不支持的 command、裸命令不在 PATH）时为 true，调用方应跳过该 server。 */
  unsupported?: boolean;
  reason?: string;
}

export interface ResolveCommandOptions {
  /** 后端自身运行时路径（打包态=捆绑 bun）；默认 process.execPath。 */
  execPath?: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
}

/**
 * 把 MCP server 的 command 解析为本机可执行命令。
 * 核心决策：node/bun 类入口一律用后端自身运行时（process.execPath，打包态=捆绑 bun）执行 server.js，
 * 因为打包后机器只有 bun 没有 node，而 MCP stdio server 只用 stdin/stdout JSON-RPC，bun 完全胜任。
 * 绝对路径/含分隔符的二进制原样用；npx 默认禁（打包环境无 npm，可经 CHENGXIAOBANG_MCP_ALLOW_NPX=1 放开）；
 * 其它裸命令（python/uvx/deno 等）走 PATH 探测，找不到则标 unsupported 跳过（不抛硬错）。
 */
export function resolveCommand(
  command: string,
  args: string[],
  options: ResolveCommandOptions = {}
): ResolvedCommand {
  const execPath = options.execPath ?? process.execPath;
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;

  if (command === "node" || command === "bun") {
    return { command: execPath, args };
  }

  if (command === "npx") {
    if (env.CHENGXIAOBANG_MCP_ALLOW_NPX !== "1") {
      return {
        command,
        args,
        unsupported: true,
        reason: "默认不支持 npx 启动的 MCP server（打包环境无 npm）；可设 CHENGXIAOBANG_MCP_ALLOW_NPX=1 放开"
      };
    }
    const found = findInPath("npx", platform, env);
    return found
      ? { command: found, args }
      : { command, args, unsupported: true, reason: "未在 PATH 找到 npx" };
  }

  // 绝对路径或含路径分隔符：视为可执行二进制型 server（Go/Rust 等），原样用。
  if (command.includes("/") || command.includes("\\")) {
    return { command, args };
  }

  // 其它裸命令名：PATH 探测，找不到即跳过并诊断。
  const found = findInPath(command, platform, env);
  if (found) {
    return { command: found, args };
  }
  return { command, args, unsupported: true, reason: `未在 PATH 找到命令 ${command}` };
}

/** 在 PATH 各目录中查找命令（Windows 附带 .exe/.cmd/.bat 候选），返回首个存在的绝对路径。 */
function findInPath(
  command: string,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv
): string | undefined {
  const pathValue = env.PATH ?? env.Path ?? "";
  if (!pathValue) {
    return undefined;
  }
  const pathSep = platform === "win32" ? ";" : ":";
  const fileSep = platform === "win32" ? "\\" : "/";
  const candidates =
    platform === "win32"
      ? [command, `${command}.exe`, `${command}.cmd`, `${command}.bat`]
      : [command];
  for (const dir of pathValue.split(pathSep).filter(Boolean)) {
    for (const candidate of candidates) {
      const full = `${dir}${fileSep}${candidate}`;
      if (existsSync(full)) {
        return full;
      }
    }
  }
  return undefined;
}
