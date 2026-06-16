import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { McpServerSpec } from "./types";

interface RawMcpServerConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  type?: string;
}

const MANIFEST_DIRS = [".claude-plugin", ".zcode-plugin"];

/**
 * 读取一个插件根声明的 MCP server：合并 plugin.json 内的 mcpServers 与独立 .mcp.json
 * （后者覆盖前者，便于把 ${ZCODE_*} 写法的 manifest 与 ${CLAUDE_*} 写法的 .mcp.json 共存）。
 * 带 url 或缺 command 的非 stdio server 标记为 unsupported（本期只支持 stdio）。
 */
export async function loadPluginMcpServers(
  pluginName: string,
  pluginRoot: string
): Promise<McpServerSpec[]> {
  const merged = new Map<string, RawMcpServerConfig>();

  for (const sub of MANIFEST_DIRS) {
    const manifest = await readJson(join(pluginRoot, sub, "plugin.json"));
    const servers = manifest?.mcpServers;
    if (servers && typeof servers === "object") {
      for (const [name, config] of Object.entries(servers)) {
        merged.set(name, config as RawMcpServerConfig);
      }
      break;
    }
  }

  const mcpJson = await readJson(join(pluginRoot, ".mcp.json"));
  if (mcpJson?.mcpServers && typeof mcpJson.mcpServers === "object") {
    for (const [name, config] of Object.entries(mcpJson.mcpServers)) {
      merged.set(name, config as RawMcpServerConfig);
    }
  }

  return [...merged.entries()].map(([serverName, config]) =>
    toSpec(pluginName, pluginRoot, serverName, config)
  );
}

function toSpec(
  pluginName: string,
  pluginRoot: string,
  serverName: string,
  config: RawMcpServerConfig
): McpServerSpec {
  const isStdio = typeof config.command === "string" && config.command.length > 0 && !config.url;
  return {
    pluginName,
    pluginRoot,
    serverName,
    key: `${pluginName}.${serverName}`,
    command: config.command ?? "",
    args: Array.isArray(config.args) ? config.args.map(String) : [],
    env: config.env && typeof config.env === "object" ? config.env : {},
    cwd: typeof config.cwd === "string" ? config.cwd : undefined,
    transport: isStdio ? "stdio" : "unsupported"
  };
}

async function readJson(path: string): Promise<Record<string, unknown> | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}
