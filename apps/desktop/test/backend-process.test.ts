import { describe, expect, it } from "vitest";
import { resolveBackendCommand } from "../src/main/backend-process";

describe("resolveBackendCommand", () => {
  it("uses explicit Bun binary when provided", () => {
    const previous = process.env.BUN_BINARY;
    process.env.BUN_BINARY = "/tmp/bun";
    try {
      const command = resolveBackendCommand({
        port: 3210,
        dataDir: "/tmp/data",
        token: "token",
        resourcesPath: "/tmp/resources",
        isPackaged: false
      });

      expect(command.command).toBe("/tmp/bun");
      expect(command.args).toContain("--data-dir");
      expect(command.args).toContain("/tmp/data");
      expect(command.args).toContain("--token");
      expect(command.args).toContain("token");
    } finally {
      process.env.BUN_BINARY = previous;
    }
  });
});
