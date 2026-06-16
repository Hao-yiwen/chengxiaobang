/**
 * MCP 桥接内部类型。本期只支持 stdio 传输；带 url / type:sse|http 的 server 记为 unsupported 跳过。
 */

/** plugin.json / .mcp.json 里单个 MCP server 的原始声明（变量占位符未替换）。 */
export interface McpServerSpec {
  /** 提供该 server 的插件名。 */
  pluginName: string;
  /** 插件磁盘根目录（${CLAUDE_PLUGIN_ROOT} 的取值）。 */
  pluginRoot: string;
  /** server 在 mcpServers 里的键名。 */
  serverName: string;
  /** 全局唯一 key：`<pluginName>.<serverName>` slug 化，用于工具命名前缀与连接缓存。 */
  key: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd?: string;
  /** stdio 可启动；unsupported 表示带 url/type 的非 stdio 传输，本期跳过。 */
  transport: "stdio" | "unsupported";
}

/** 变量替换后的可启动 server 描述。 */
export interface ResolvedMcpServer {
  key: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd?: string;
  /** 原始 spec 是否引用了 ${CLAUDE_PROJECT_DIR}，决定按 workspace 多实例还是全局单例。 */
  projectScoped: boolean;
}

export type McpServerStatus =
  | "idle"
  | "starting"
  | "ready"
  | "needs_config"
  | "unsupported"
  | "failed"
  | "closed";

/** listTools 返回的单个 MCP 工具描述。 */
export interface McpToolHandle {
  name: string;
  description?: string;
  inputSchema: unknown;
}

/** McpManager.describe() 的状态快照，供 UI/排障展示。 */
export interface McpServerDescription {
  key: string;
  pluginName: string;
  serverName: string;
  status: McpServerStatus;
  toolCount: number;
  pid?: number;
  missingConfig?: string[];
  lastError?: string;
}

/** 插件 userConfig 的运行时取值（喂给变量替换的 ${user_config.X}）。 */
export type UserConfigValues = Record<string, string | undefined>;
