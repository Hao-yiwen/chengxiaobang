import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { McpConnection } from "./mcp-connection";
import { loadPluginMcpServers } from "./plugin-loader";
import { substituteServerSpec } from "./variable-substitution";
import type { McpServerDescription, McpServerSpec } from "./types";

export interface McpManagerOptions {
  /** MCP server 数据目录根：实际目录为 <dataDir>/mcp/<pluginName>。 */
  dataDir: string;
  /** 已启用插件根目录回调（与技能/命令聚合共用 PluginService.enabledPluginRoots）。 */
  enabledPluginRoots: () => Promise<Array<{ pluginName: string; root: string }>>;
  /** 取插件 userConfig 取值，用于替换 ${user_config.X}。 */
  getUserConfig: (pluginName: string) => Promise<Record<string, string | undefined>>;
  /** 后端自身运行时路径（默认 process.execPath）。 */
  execPath?: string;
  platform?: NodeJS.Platform;
}

/**
 * MCP 管理器：懒加载 + 进程级缓存。首次为某 workspace 取工具时发现并启动已启用插件的 stdio MCP server，
 * 把它们的工具桥接成 pi AgentTool 注入工具集合。引用 ${CLAUDE_PROJECT_DIR} 的 server 按 workspace 多实例，
 * 否则全局单例。任一 server 启动/缺配/失败都被隔离，绝不阻断主对话。
 */
export class McpManager {
  private readonly connections = new Map<string, McpConnection>();

  constructor(private readonly options: McpManagerOptions) {}

  async getToolsForWorkspace(workspacePath: string): Promise<AgentTool[]> {
    let specs: McpServerSpec[];
    try {
      specs = await this.discoverSpecs();
    } catch (error) {
      console.error("[mcp] 发现 MCP server 失败", {
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
    const tools: AgentTool[] = [];
    for (const spec of specs) {
      try {
        const connection = await this.ensureConnection(spec, workspacePath);
        if (connection) {
          tools.push(...connection.listToolHandles());
        }
      } catch (error) {
        console.error("[mcp] 启动 MCP server 失败", {
          key: spec.key,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
    return tools;
  }

  private async discoverSpecs(): Promise<McpServerSpec[]> {
    const roots = await this.options.enabledPluginRoots();
    const specs: McpServerSpec[] = [];
    for (const { pluginName, root } of roots) {
      specs.push(...(await loadPluginMcpServers(pluginName, root)));
    }
    return specs;
  }

  private async ensureConnection(
    spec: McpServerSpec,
    workspacePath: string
  ): Promise<McpConnection | undefined> {
    if (spec.transport !== "stdio") {
      console.warn("[mcp] 跳过非 stdio MCP server", { key: spec.key, serverName: spec.serverName });
      return undefined;
    }
    const userConfig = await this.options.getUserConfig(spec.pluginName);
    const pluginDataDir = join(this.options.dataDir, "mcp", spec.pluginName);
    const { resolved, missing } = substituteServerSpec(spec, {
      pluginRoot: spec.pluginRoot,
      projectDir: workspacePath,
      pluginDataDir,
      userConfig
    });
    if (missing.length > 0) {
      console.warn("[mcp] MCP server 缺少 user_config，暂不启动", { key: spec.key, missing });
      return undefined;
    }

    const cacheKey = resolved.projectScoped ? `${spec.key}@${workspacePath}` : spec.key;
    const cached = this.connections.get(cacheKey);
    if (cached) {
      return cached;
    }

    await mkdir(pluginDataDir, { recursive: true }).catch(() => undefined);
    const connection = new McpConnection({
      serverKey: spec.key,
      serverName: spec.serverName,
      pluginName: spec.pluginName,
      resolved,
      execPath: this.options.execPath,
      platform: this.options.platform
    });
    this.connections.set(cacheKey, connection);
    await connection.start();
    return connection;
  }

  /** 当前所有连接的状态快照，供 UI/排障（GET /settings/mcp/servers）。 */
  describe(): McpServerDescription[] {
    return [...this.connections.values()].map((connection) => ({
      key: connection.key,
      pluginName: connection.pluginName,
      serverName: connection.serverName,
      status: connection.status,
      toolCount: connection.toolCount,
      pid: connection.pid,
      lastError: connection.lastError
    }));
  }

  async shutdown(): Promise<void> {
    console.info("[mcp] 关闭所有 MCP server", { count: this.connections.size });
    await Promise.all(
      [...this.connections.values()].map((connection) => connection.close().catch(() => undefined))
    );
    this.connections.clear();
  }
}
