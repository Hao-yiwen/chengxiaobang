import { describe, expect, it } from "vitest";
import { resolveCommand } from "../src/mcp/runtime-resolver";

describe("resolveCommand", () => {
  it("routes node/bun to the backend's own runtime (execPath)", () => {
    expect(resolveCommand("node", ["server.js"], { execPath: "/opt/bun" })).toEqual({
      command: "/opt/bun",
      args: ["server.js"]
    });
    expect(resolveCommand("bun", ["server.js"], { execPath: "/opt/bun" })).toEqual({
      command: "/opt/bun",
      args: ["server.js"]
    });
  });

  it("rejects npx by default and reports why", () => {
    const denied = resolveCommand("npx", ["pkg"], { env: {} });
    expect(denied.unsupported).toBe(true);
    expect(denied.reason).toContain("npx");
  });

  it("passes through absolute or path-containing commands as-is", () => {
    expect(resolveCommand("/usr/local/bin/my-mcp", ["a"])).toEqual({
      command: "/usr/local/bin/my-mcp",
      args: ["a"]
    });
    expect(resolveCommand("./bin/server", [])).toEqual({ command: "./bin/server", args: [] });
  });

  it("marks unknown bare commands as unsupported when not on PATH", () => {
    const result = resolveCommand("python", ["x"], { env: { PATH: "/nonexistent" }, platform: "linux" });
    expect(result.unsupported).toBe(true);
    expect(result.reason).toContain("python");
  });
});
