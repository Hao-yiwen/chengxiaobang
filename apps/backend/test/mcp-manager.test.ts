import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { McpManager } from "../src/mcp/mcp-manager";

/**
 * 这些用例只覆盖「发现 + 缺配/非 stdio 跳过」路径，它们在创建子进程之前就返回，
 * 因此不会真 spawn MCP server（成功启动路径依赖真实 server，留待端到端验证）。
 */
describe("McpManager", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "cxb-mcp-mgr-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function writePluginMcp(name: string, servers: unknown): Promise<string> {
    const root = join(dir, "plugins", name);
    await mkdir(join(root, ".claude-plugin"), { recursive: true });
    await writeFile(
      join(root, ".claude-plugin", "plugin.json"),
      JSON.stringify({ name, mcpServers: servers }),
      "utf8"
    );
    return root;
  }

  it("skips servers with missing user_config without creating a connection", async () => {
    const root = await writePluginMcp("android", {
      "android-emulator": {
        command: "node",
        args: ["${CLAUDE_PLUGIN_ROOT}/s.js"],
        env: { SDK: "${user_config.sdk_path}" }
      }
    });
    const getUserConfig = vi.fn(async () => ({}));
    const manager = new McpManager({
      dataDir: join(dir, "data"),
      enabledPluginRoots: async () => [{ pluginName: "android", root }],
      getUserConfig
    });

    expect(await manager.getToolsForWorkspace(join(dir, "ws"))).toEqual([]);
    expect(getUserConfig).toHaveBeenCalledWith("android");
    expect(manager.describe()).toEqual([]);
    await manager.shutdown();
  });

  it("skips non-stdio (url) servers", async () => {
    const root = await writePluginMcp("remote", { srv: { url: "https://x/sse", type: "sse" } });
    const manager = new McpManager({
      dataDir: join(dir, "data"),
      enabledPluginRoots: async () => [{ pluginName: "remote", root }],
      getUserConfig: async () => ({})
    });

    expect(await manager.getToolsForWorkspace(join(dir, "ws"))).toEqual([]);
    await manager.shutdown();
  });

  it("returns no tools when no plugins are enabled", async () => {
    const manager = new McpManager({
      dataDir: join(dir, "data"),
      enabledPluginRoots: async () => [],
      getUserConfig: async () => ({})
    });
    expect(await manager.getToolsForWorkspace(join(dir, "ws"))).toEqual([]);
  });
});
