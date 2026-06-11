import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveBackendCommand } from "../src/main/backend-process";

describe("resolveBackendCommand", () => {
  const previousBunBinary = process.env.BUN_BINARY;
  const tempDirs: string[] = [];

  afterEach(async () => {
    if (previousBunBinary === undefined) {
      delete process.env.BUN_BINARY;
    } else {
      process.env.BUN_BINARY = previousBunBinary;
    }
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("uses explicit Bun binary when provided", () => {
    process.env.BUN_BINARY = "/tmp/bun";

    const command = resolveBackendCommand({
      port: 3210,
      dataDir: "/tmp/data",
      token: "token",
      resourcesPath: "/tmp/resources",
      isPackaged: false
    });

    expect(command.command).toBe("/tmp/bun");
    expect(command.args).toContain("--watch");
    expect(command.args).toContain("--data-dir");
    expect(command.args).toContain("/tmp/data");
    expect(command.args).toContain("--token");
    expect(command.args).toContain("token");
  });

  it("uses workspace Bun in development", () => {
    delete process.env.BUN_BINARY;

    const command = resolveBackendCommand({
      port: 3210,
      dataDir: "/tmp/data",
      token: "token",
      resourcesPath: "/tmp/resources",
      isPackaged: false
    });

    expect(command.command).toBe(resolve(process.cwd(), "node_modules/.bin/bun"));
    expect(command.args[0]).toBe("--watch");
  });

  it("uses bundled Bun in packaged builds", async () => {
    delete process.env.BUN_BINARY;
    const resourcesPath = await mkdtemp(join(tmpdir(), "cxb-resources-"));
    tempDirs.push(resourcesPath);
    await writeFile(join(resourcesPath, "bun"), "");

    const command = resolveBackendCommand({
      port: 3210,
      dataDir: "/tmp/data",
      token: "token",
      resourcesPath,
      isPackaged: true
    });

    expect(command.command).toBe(join(resourcesPath, "bun"));
    expect(command.args).not.toContain("--watch");
  });

  it("fails clearly when packaged Bun is missing", async () => {
    delete process.env.BUN_BINARY;
    const resourcesPath = await mkdtemp(join(tmpdir(), "cxb-resources-"));
    tempDirs.push(resourcesPath);

    expect(() =>
      resolveBackendCommand({
        port: 3210,
        dataDir: "/tmp/data",
        token: "token",
        resourcesPath,
        isPackaged: true
      })
    ).toThrow("后端运行时缺失");
  });
});
