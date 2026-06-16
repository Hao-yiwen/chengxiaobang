import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadPluginMcpServers } from "../src/mcp/plugin-loader";

describe("loadPluginMcpServers", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "cxb-mcp-loader-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("merges plugin.json and .mcp.json servers with .mcp.json winning", async () => {
    await mkdir(join(dir, ".claude-plugin"), { recursive: true });
    await writeFile(
      join(dir, ".claude-plugin", "plugin.json"),
      JSON.stringify({
        name: "android",
        mcpServers: {
          "android-emulator": { command: "node", args: ["${CLAUDE_PLUGIN_ROOT}/old.js"] }
        }
      }),
      "utf8"
    );
    await writeFile(
      join(dir, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          "android-emulator": {
            command: "node",
            args: ["${CLAUDE_PLUGIN_ROOT}/dist/server.js"],
            env: { A: "1" }
          }
        }
      }),
      "utf8"
    );

    const specs = await loadPluginMcpServers("android", dir);
    expect(specs).toHaveLength(1);
    expect(specs[0]).toMatchObject({
      pluginName: "android",
      serverName: "android-emulator",
      key: "android.android-emulator",
      command: "node",
      args: ["${CLAUDE_PLUGIN_ROOT}/dist/server.js"],
      env: { A: "1" },
      transport: "stdio"
    });
  });

  it("marks url / no-command servers as unsupported", async () => {
    await writeFile(
      join(dir, ".mcp.json"),
      JSON.stringify({
        mcpServers: { remote: { url: "https://x/sse", type: "sse" }, broken: {} }
      }),
      "utf8"
    );
    const specs = await loadPluginMcpServers("p", dir);
    expect(specs.find((s) => s.serverName === "remote")?.transport).toBe("unsupported");
    expect(specs.find((s) => s.serverName === "broken")?.transport).toBe("unsupported");
  });

  it("returns empty when no mcp config exists", async () => {
    await expect(loadPluginMcpServers("p", dir)).resolves.toEqual([]);
  });
});
