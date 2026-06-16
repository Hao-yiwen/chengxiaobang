import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AdmZip from "adm-zip";
import { PluginError, PluginService } from "../src/tools/plugin-service";

/** 内存版 settings KV，避免为单测拉起 SQLite。 */
function memorySettings() {
  const map = new Map<string, string>();
  return {
    getSetting: async (key: string) => map.get(key),
    setSetting: async (key: string, value: string) => {
      map.set(key, value);
    }
  };
}

interface PluginSpec {
  manifest: Record<string, unknown>;
  skills?: Array<{ name: string; description: string }>;
  commands?: Array<{ name: string; description?: string; argumentHint?: string }>;
  mcpJson?: Record<string, unknown>;
}

/** 在 root 下造一个 Claude Code 格式插件目录，返回其绝对路径。 */
async function writePlugin(root: string, dirName: string, spec: PluginSpec): Promise<string> {
  const pluginDir = join(root, dirName);
  await mkdir(join(pluginDir, ".claude-plugin"), { recursive: true });
  await writeFile(
    join(pluginDir, ".claude-plugin", "plugin.json"),
    JSON.stringify(spec.manifest),
    "utf8"
  );
  for (const skill of spec.skills ?? []) {
    await mkdir(join(pluginDir, "skills", skill.name), { recursive: true });
    await writeFile(
      join(pluginDir, "skills", skill.name, "SKILL.md"),
      `---\nname: ${skill.name}\ndescription: ${skill.description}\n---\n正文`,
      "utf8"
    );
  }
  if (spec.commands?.length) {
    await mkdir(join(pluginDir, "commands"), { recursive: true });
    for (const cmd of spec.commands) {
      await writeFile(
        join(pluginDir, "commands", `${cmd.name}.md`),
        `---\ndescription: ${cmd.description ?? ""}\nargument-hint: ${cmd.argumentHint ?? ""}\n---\n做 $ARGUMENTS`,
        "utf8"
      );
    }
  }
  if (spec.mcpJson) {
    await writeFile(join(pluginDir, ".mcp.json"), JSON.stringify(spec.mcpJson), "utf8");
  }
  return pluginDir;
}

describe("PluginService", () => {
  let dir: string;
  let service: PluginService;
  let settings: ReturnType<typeof memorySettings>;
  let builtinRoot: string;
  let installedRoot: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "cxb-plugin-svc-"));
    builtinRoot = join(dir, "builtin");
    installedRoot = join(dir, "installed");
    settings = memorySettings();
    service = new PluginService(settings, { builtinRoot, installedRoot });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    vi.unstubAllGlobals();
  });

  it("discovers builtin plugins with contribution counts", async () => {
    await writePlugin(builtinRoot, "superpowers", {
      manifest: {
        name: "superpowers",
        version: "1.0.0",
        description: "工作流",
        author: { name: "obra" }
      },
      skills: [
        { name: "brainstorming", description: "头脑风暴" },
        { name: "writing-plans", description: "写计划" }
      ],
      commands: [{ name: "plan", description: "做计划" }]
    });

    const list = await service.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      name: "superpowers",
      version: "1.0.0",
      author: "obra",
      source: "builtin",
      enabled: false,
      hasConfig: false,
      contributions: { skills: 2, commands: 1, mcpServers: 0, hooks: 0 }
    });
  });

  it("counts mcpServers from manifest and .mcp.json deduped, surfaces config fields", async () => {
    await writePlugin(builtinRoot, "android", {
      manifest: {
        name: "android",
        mcpServers: { "android-emulator": {} },
        userConfig: { sdk_path: { type: "string", description: "SDK 路径" } }
      },
      mcpJson: { mcpServers: { "android-emulator": {} } }
    });

    const detail = await service.getDetail("android");
    expect(detail?.contributions.mcpServers).toBe(1);
    expect(detail?.mcpServers).toEqual([{ name: "android-emulator" }]);
    expect(detail?.hasConfig).toBe(true);
    expect(detail?.configFields).toEqual([
      expect.objectContaining({ key: "sdk_path", type: "string", description: "SDK 路径" })
    ]);
  });

  it("enables/disables a plugin and exposes enabled roots", async () => {
    const root = await writePlugin(builtinRoot, "superpowers", { manifest: { name: "superpowers" } });

    await expect(service.enabledPluginRoots()).resolves.toEqual([]);
    await service.setEnabled("superpowers", true);
    await expect(service.enabledPluginRoots()).resolves.toEqual([
      { pluginName: "superpowers", root }
    ]);

    const list = await service.setEnabled("superpowers", false);
    expect(list[0].enabled).toBe(false);
    await expect(service.enabledPluginRoots()).resolves.toEqual([]);
  });

  it("rejects enabling an unknown plugin", async () => {
    await expect(service.setEnabled("nope", true)).rejects.toBeInstanceOf(PluginError);
  });

  it("persists per-plugin config values", async () => {
    await writePlugin(builtinRoot, "android", {
      manifest: { name: "android", userConfig: { sdk_path: { type: "string" } } }
    });

    await service.setConfigValues("android", { sdk_path: "/opt/android" });
    await expect(service.getConfigValues("android")).resolves.toEqual({ sdk_path: "/opt/android" });
    const detail = await service.getDetail("android");
    expect(detail?.configValues).toEqual({ sdk_path: "/opt/android" });
  });

  it("installs a plugin from a local directory", async () => {
    const sourceDir = await writePlugin(join(dir, "src"), "my-plugin", {
      manifest: { name: "my-plugin", description: "本地" },
      skills: [{ name: "s1", description: "技能1" }]
    });

    const summary = await service.install({ path: sourceDir });
    expect(summary).toMatchObject({ name: "my-plugin", source: "installed" });
    expect(existsSync(join(installedRoot, "my-plugin", ".claude-plugin", "plugin.json"))).toBe(true);
    expect(existsSync(join(installedRoot, "my-plugin", "skills", "s1", "SKILL.md"))).toBe(true);
  });

  it("rejects installing a duplicate plugin name", async () => {
    const sourceDir = await writePlugin(join(dir, "src"), "dup", { manifest: { name: "dup" } });
    await service.install({ path: sourceDir });
    await expect(service.install({ path: sourceDir })).rejects.toThrow(/已安装/);
  });

  it("installs from a GitHub zipball (mocked) wrapped in a repo-ref dir", async () => {
    const zip = new AdmZip();
    zip.addFile(
      "my-repo-main/.claude-plugin/plugin.json",
      Buffer.from(JSON.stringify({ name: "remote-plugin", description: "远程" }))
    );
    zip.addFile(
      "my-repo-main/skills/s1/SKILL.md",
      Buffer.from("---\nname: s1\ndescription: d\n---\nx")
    );
    const buffer = zip.toBuffer();
    const fetchMock = vi.fn(async () => new Response(buffer, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const summary = await service.install({ url: "https://github.com/owner/my-repo" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://codeload.github.com/owner/my-repo/zip/HEAD",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(summary).toMatchObject({ name: "remote-plugin", source: "installed" });
    expect(existsSync(join(installedRoot, "remote-plugin", "skills", "s1", "SKILL.md"))).toBe(true);
  });

  it("uninstalls installed plugins clearing enabled+config, refuses builtin", async () => {
    await writePlugin(builtinRoot, "builtin-plugin", { manifest: { name: "builtin-plugin" } });
    const sourceDir = await writePlugin(join(dir, "src"), "installed-plugin", {
      manifest: { name: "installed-plugin" }
    });
    await service.install({ path: sourceDir });
    await service.setEnabled("installed-plugin", true);
    await service.setConfigValues("installed-plugin", { k: "v" });

    await expect(service.uninstall("installed-plugin")).resolves.toBe(true);
    expect(existsSync(join(installedRoot, "installed-plugin"))).toBe(false);
    await expect(service.enabledPluginNames()).resolves.toEqual(new Set());
    await expect(service.getConfigValues("installed-plugin")).resolves.toEqual({});

    await expect(service.uninstall("builtin-plugin")).rejects.toThrow(/内置插件不可卸载/);
    await expect(service.uninstall("nope")).resolves.toBe(false);
  });

  it("lets installed plugins override builtin with the same name", async () => {
    await writePlugin(builtinRoot, "shared-name", {
      manifest: { name: "shared-name", description: "内置版" }
    });
    const sourceDir = await writePlugin(join(dir, "src"), "shared-name", {
      manifest: { name: "shared-name", description: "安装版" }
    });
    await service.install({ path: sourceDir });

    const list = await service.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ source: "installed", description: "安装版" });
  });
});
