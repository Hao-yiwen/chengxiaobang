import { fileURLToPath } from "node:url";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PluginService } from "../src/tools/plugin-service";

/** 搬运到 apps/backend/plugins 的内置插件根。 */
const BUILTIN_PLUGINS_ROOT = fileURLToPath(new URL("../plugins", import.meta.url));

function memorySettings() {
  const map = new Map<string, string>();
  return {
    getSetting: async (key: string) => map.get(key),
    setSetting: async (key: string, value: string) => {
      map.set(key, value);
    }
  };
}

describe("内置插件", () => {
  let installedRoot: string;

  beforeEach(async () => {
    installedRoot = await mkdtemp(join(tmpdir(), "cxb-builtin-"));
  });

  afterEach(async () => {
    await rm(installedRoot, { recursive: true, force: true });
  });

  function service() {
    return new PluginService(memorySettings(), { builtinRoot: BUILTIN_PLUGINS_ROOT, installedRoot });
  }

  it("discovers the four bundled MIT plugins, all builtin and disabled by default", async () => {
    const list = await service().list();
    expect(list.map((p) => p.name).sort()).toEqual([
      "android-emulator",
      "ios-simulator",
      "skill-creator",
      "superpowers"
    ]);
    expect(list.every((p) => p.source === "builtin" && p.enabled === false)).toBe(true);

    const superpowers = list.find((p) => p.name === "superpowers");
    expect(superpowers?.contributions.skills).toBeGreaterThanOrEqual(10);
    expect(superpowers?.contributions.commands).toBe(superpowers?.contributions.skills);

    const android = list.find((p) => p.name === "android-emulator");
    expect(android?.contributions.mcpServers).toBe(1);
    expect(android?.hasConfig).toBe(true);
  });

  it("exposes android plugin detail with its mcp server, command and config fields", async () => {
    const detail = await service().getDetail("android-emulator");
    expect(detail?.mcpServers).toEqual([{ name: "android-emulator" }]);
    expect(detail?.configFields.some((f) => f.key === "sdk_path")).toBe(true);
    expect(detail?.commands.length).toBeGreaterThanOrEqual(1);
  });
});
