import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  getDefaultEnvironment,
  StdioClientTransport
} from "@modelcontextprotocol/sdk/client/stdio.js";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { resolveCommand } from "./runtime-resolver";
import { bridgeMcpTool, type McpCallResult } from "./mcp-tool-bridge";
import type { McpServerStatus, McpToolHandle, ResolvedMcpServer } from "./types";

import { getLogger } from "../logging/logger";

const log = getLogger({ module: "mcp/mcp-connection" });

const CONNECT_TIMEOUT_MS = 15_000;
const CALL_TIMEOUT_MS = 60_000;
/** 每个 server 最多采集的 stderr 行数，避免噪声刷屏。 */
const STDERR_LOG_LIMIT = 50;

export interface McpConnectionOptions {
  serverKey: string;
  serverName: string;
  pluginName: string;
  resolved: ResolvedMcpServer;
  /** 后端自身运行时（process.execPath，打包态=捆绑 bun），用于执行 node/bun 类 server。 */
  execPath?: string;
  platform?: NodeJS.Platform;
}

/**
 * 单个 stdio MCP server 的连接封装：负责启动子进程、握手、listTools、callTool、关闭，
 * 并把就绪后的工具桥接为 pi AgentTool。任一步失败只置 failed 状态并打日志，不向外抛断主流程。
 */
export class McpConnection {
  readonly key: string;
  readonly serverName: string;
  readonly pluginName: string;
  status: McpServerStatus = "idle";
  lastError?: string;

  private client?: Client;
  private transport?: StdioClientTransport;
  private handles: McpToolHandle[] = [];
  private stderrLines = 0;

  constructor(private readonly options: McpConnectionOptions) {
    this.key = options.serverKey;
    this.serverName = options.serverName;
    this.pluginName = options.pluginName;
  }

  get pid(): number | undefined {
    return this.transport?.pid ?? undefined;
  }

  get toolCount(): number {
    return this.handles.length;
  }

  /** 启动子进程并握手；解析不出运行时或连接失败时置 unsupported/failed，不抛错。 */
  async start(): Promise<void> {
    if (this.status === "ready" || this.status === "starting") {
      return;
    }
    this.status = "starting";
    const { resolved } = this.options;
    const command = resolveCommand(resolved.command, resolved.args, {
      execPath: this.options.execPath,
      platform: this.options.platform
    });
    if (command.unsupported) {
      this.status = "unsupported";
      this.lastError = command.reason;
      log.warn("[mcp] 跳过不支持的 MCP server", {
        key: this.key,
        command: resolved.command,
        reason: command.reason
      });
      return;
    }

    log.info("[mcp] 启动 MCP server", {
      key: this.key,
      command: command.command,
      argsCount: command.args.length,
      cwd: resolved.cwd
    });

    const transport = new StdioClientTransport({
      command: command.command,
      args: command.args,
      env: { ...getDefaultEnvironment(), ...resolved.env },
      cwd: resolved.cwd,
      stderr: "pipe"
    });
    transport.stderr?.on("data", (chunk: Buffer) => this.onStderr(chunk));
    transport.onerror = (error) => {
      log.error("[mcp] MCP transport 错误", { key: this.key, error: error.message });
    };
    transport.onclose = () => {
      if (this.status === "ready") {
        log.warn("[mcp] MCP server 连接关闭", { key: this.key, pid: this.pid });
        this.status = "closed";
      }
    };

    const client = new Client({ name: "chengxiaobang", version: "0.1.0" }, { capabilities: {} });
    this.transport = transport;
    this.client = client;

    try {
      await client.connect(transport, { timeout: CONNECT_TIMEOUT_MS });
      const listed = await client.listTools(undefined, { timeout: CONNECT_TIMEOUT_MS });
      this.handles = (listed.tools ?? []).map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema
      }));
      this.status = "ready";
      log.info("[mcp] MCP server 就绪", {
        key: this.key,
        pid: this.pid,
        toolCount: this.handles.length
      });
    } catch (error) {
      this.status = "failed";
      this.lastError = error instanceof Error ? error.message : String(error);
      log.error("[mcp] MCP server 连接失败", { key: this.key, error: this.lastError });
      await this.close().catch(() => undefined);
    }
  }

  /** 把已就绪 server 的工具桥接为 pi AgentTool 列表（未就绪时返回空）。 */
  listToolHandles(): AgentTool[] {
    if (this.status !== "ready") {
      return [];
    }
    return this.handles.map((handle) =>
      bridgeMcpTool({
        serverKey: this.key,
        serverName: this.serverName,
        handle,
        callTool: (toolName, args, signal) => this.callTool(toolName, args, signal)
      })
    );
  }

  private async callTool(
    toolName: string,
    args: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<McpCallResult> {
    if (!this.client || this.status !== "ready") {
      throw new Error(`MCP server ${this.key} 未就绪，无法调用工具 ${toolName}`);
    }
    log.info("[mcp] 调用 MCP 工具", { key: this.key, tool: toolName });
    try {
      const result = await this.client.callTool(
        { name: toolName, arguments: args },
        undefined,
        { signal, timeout: CALL_TIMEOUT_MS }
      );
      log.info("[mcp] MCP 工具完成", {
        key: this.key,
        tool: toolName,
        isError: Boolean(result.isError)
      });
      return result as McpCallResult;
    } catch (error) {
      log.error("[mcp] MCP 工具调用失败", {
        key: this.key,
        tool: toolName,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  async close(): Promise<void> {
    try {
      await this.client?.close();
    } catch (error) {
      log.warn("[mcp] 关闭 MCP client 失败", {
        key: this.key,
        error: error instanceof Error ? error.message : String(error)
      });
    }
    this.client = undefined;
    this.transport = undefined;
    if (this.status !== "failed" && this.status !== "unsupported") {
      this.status = "closed";
    }
  }

  private onStderr(chunk: Buffer): void {
    if (this.stderrLines >= STDERR_LOG_LIMIT) {
      return;
    }
    const line = chunk.toString("utf8").trim();
    if (!line) {
      return;
    }
    this.stderrLines += 1;
    log.warn("[mcp] MCP server stderr", { key: this.key, pid: this.pid, line: line.slice(0, 500) });
  }
}
