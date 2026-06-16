import { describe, expect, it, vi } from "vitest";
import {
  bridgeMcpTool,
  isMcpToolName,
  mapCallToolResult,
  mcpToolName
} from "../src/mcp/mcp-tool-bridge";

describe("mcpToolName / isMcpToolName", () => {
  it("builds prefixed names and slugs the server key", () => {
    expect(mcpToolName("android-emulator.android-emulator", "preflight")).toBe(
      "mcp__android_emulator_android_emulator__preflight"
    );
    expect(isMcpToolName("mcp__x__y")).toBe(true);
    expect(isMcpToolName("Read")).toBe(false);
  });
});

describe("bridgeMcpTool", () => {
  it("wraps a handle into an AgentTool and forwards execute to callTool", async () => {
    const callTool = vi.fn(async () => ({ content: [{ type: "text", text: "ok" }] }));
    const tool = bridgeMcpTool({
      serverKey: "p.s",
      serverName: "s",
      handle: {
        name: "do_it",
        description: "做事",
        inputSchema: { type: "object", properties: { x: { type: "string" } } }
      },
      callTool
    });
    expect(tool.name).toBe("mcp__p_s__do_it");
    expect(tool.label).toBe("s · do_it");
    expect(tool.description).toBe("做事");

    const result = await tool.execute("call-1", { x: "1" });
    expect(callTool).toHaveBeenCalledWith("do_it", { x: "1" }, undefined);
    expect(result.content).toEqual([{ type: "text", text: "ok" }]);
  });
});

describe("mapCallToolResult", () => {
  it("maps text and image blocks and carries structuredContent into details", () => {
    const result = mapCallToolResult(
      {
        content: [
          { type: "text", text: "hi" },
          { type: "image", data: "b64", mimeType: "image/jpeg" }
        ],
        structuredContent: { a: 1 }
      },
      "t"
    );
    expect(result.content).toEqual([
      { type: "text", text: "hi" },
      { type: "image", data: "b64", mimeType: "image/jpeg" }
    ]);
    expect(result.details).toEqual({ a: 1 });
  });

  it("summarizes non-text/image blocks and fills empty output", () => {
    expect(mapCallToolResult({ content: [{ type: "resource", uri: "x" }] }, "t").content).toEqual([
      { type: "text", text: "[MCP resource 资源]" }
    ]);
    expect(mapCallToolResult({ content: [] }, "t").content).toEqual([
      { type: "text", text: "（MCP 工具无文本输出）" }
    ]);
  });

  it("throws on isError using the joined text", () => {
    expect(() =>
      mapCallToolResult({ content: [{ type: "text", text: "boom" }], isError: true }, "t")
    ).toThrow("boom");
    expect(() => mapCallToolResult({ content: [], isError: true }, "my_tool")).toThrow(/my_tool/);
  });
});
