import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import AdmZip from "adm-zip";
import {
  pluginManifestSchema,
  type PluginConfigField,
  type PluginConfigValues,
  type PluginContributions,
  type PluginDetail,
  type PluginInstallInput,
  type PluginManifest,
  type PluginSource,
  type PluginSummary
} from "@chengxiaobang/shared";
import type { StateStore } from "../repository/state-store";
import { builtinResourceRoot } from "../paths";
import { readSkillDir } from "./skill-market-service";
import { loadPluginCommands } from "./plugin-commands";

/** 已启用插件名集合，JSON 数组存 settings KV。 */
const ENABLED_KEY = "plugins.enabled";
/** 各插件的 userConfig 取值，JSON 对象 `{[plugin]:{[key]:value}}` 存 settings KV。 */
const OPTIONS_KEY = "plugins.options";

/** manifest 优先读取当前插件目录；同时保留旧目录名兼容，避免已安装插件失效。 */
const MANIFEST_DIRS = [".claude-plugin", ".zcode-plugin"];
const MANIFEST_FILE = "plugin.json";

const PLUGIN_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const PLUGIN_DOWNLOAD_TIMEOUT_MS = 30_000;
const PLUGIN_DOWNLOAD_MAX_BYTES = 64 * 1024 * 1024;

type SettingsStore = Pick<StateStore, "getSetting" | "setSetting">;

export interface PluginServiceOptions {
  /** 随应用内置的插件目录；默认 builtin 资源根下的 plugins。 */
  builtinRoot?: string;
  /** 用户安装的插件目录；默认 ~/.chengxiaobang/plugins。 */
  installedRoot?: string;
}

/** 已发现插件的内部表示：磁盘根目录 + 解析后的 manifest。 */
export interface DiscoveredPlugin {
  name: string;
  source: PluginSource;
  root: string;
  manifest: PluginManifest;
}

/**
 * 插件服务：发现内置/已安装插件、解析 plugin.json、启停（settings KV）、读写 userConfig，
 * 以及从本地目录/zip/GitHub 链接安装、卸载。已启用插件的磁盘根经 enabledPluginRoots 喂给
 * 技能/命令聚合体系（SkillMarketService / SlashCommandService）。
 */
export class PluginService {
  private readonly builtinRoot: string;
  private readonly installedRoot: string;

  constructor(
    private readonly store: SettingsStore,
    options: PluginServiceOptions = {}
  ) {
    this.builtinRoot = options.builtinRoot ?? join(builtinResourceRoot(), "plugins");
    this.installedRoot = options.installedRoot ?? join(homedir(), ".chengxiaobang", "plugins");
  }

  /** 扫描内置 + 已安装目录，解析 manifest；同名时 installed 覆盖 builtin（便于热修）。 */
  async discover(): Promise<DiscoveredPlugin[]> {
    const result: DiscoveredPlugin[] = [];
    const seen = new Set<string>();
    for (const { root, source } of [
      { root: this.installedRoot, source: "installed" as const },
      { root: this.builtinRoot, source: "builtin" as const }
    ]) {
      let entries;
      try {
        entries = await readdir(root, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue;
        }
        const dir = join(root, entry.name);
        const manifest = await readManifest(dir);
        if (!manifest || seen.has(manifest.name)) {
          continue;
        }
        seen.add(manifest.name);
        result.push({ name: manifest.name, source, root: dir, manifest });
      }
    }
    return result.sort((a, b) => a.name.localeCompare(b.name));
  }

  async list(): Promise<PluginSummary[]> {
    const [discovered, enabled] = await Promise.all([this.discover(), this.enabledPluginNames()]);
    return Promise.all(discovered.map((plugin) => this.toSummary(plugin, enabled.has(plugin.name))));
  }

  async getDetail(name: string): Promise<PluginDetail | undefined> {
    const [discovered, enabled] = await Promise.all([this.discover(), this.enabledPluginNames()]);
    const hit = discovered.find((plugin) => plugin.name === name);
    if (!hit) {
      console.warn(`[plugin] 未找到插件详情 name=${name}`);
      return undefined;
    }
    const [summary, skills, commands, mcpServerNames, configValues] = await Promise.all([
      this.toSummary(hit, enabled.has(name)),
      readPluginSkillRefs(hit.root),
      readPluginCommandRefs(hit.root),
      readMcpServerNames(hit.root, hit.manifest),
      this.getConfigValues(name)
    ]);
    return {
      ...summary,
      manifest: hit.manifest,
      installPath: hit.root,
      configFields: toConfigFields(hit.manifest.userConfig),
      configValues,
      skills,
      commands,
      mcpServers: mcpServerNames.map((serverName) => ({ name: serverName }))
    };
  }

  /** 已启用插件名集合（启停判定 + 聚合体系过滤共用）。 */
  async enabledPluginNames(): Promise<Set<string>> {
    const raw = await this.store.getSetting(ENABLED_KEY);
    if (!raw) {
      return new Set();
    }
    try {
      const parsed = JSON.parse(raw);
      return new Set(Array.isArray(parsed) ? parsed.filter((v) => typeof v === "string") : []);
    } catch (error) {
      console.warn(`[plugin] 启用集合解析失败，按空集处理: ${String(error)}`);
      return new Set();
    }
  }

  async setEnabled(name: string, enabled: boolean): Promise<PluginSummary[]> {
    const discovered = await this.discover();
    if (!discovered.some((plugin) => plugin.name === name)) {
      throw new PluginError(`没有名为 ${name} 的插件`);
    }
    const current = await this.enabledPluginNames();
    if (enabled) {
      current.add(name);
    } else {
      current.delete(name);
    }
    await this.store.setSetting(ENABLED_KEY, JSON.stringify([...current].sort()));
    console.info(`[plugin] ${enabled ? "启用" : "停用"}插件 name=${name}`);
    return this.list();
  }

  /** 已启用插件的磁盘根目录列表，供技能/命令聚合把每个插件根当作额外来源加载。 */
  async enabledPluginRoots(): Promise<Array<{ pluginName: string; root: string }>> {
    const [discovered, enabled] = await Promise.all([this.discover(), this.enabledPluginNames()]);
    return discovered
      .filter((plugin) => enabled.has(plugin.name))
      .map((plugin) => ({ pluginName: plugin.name, root: plugin.root }));
  }

  async getConfigValues(name: string): Promise<PluginConfigValues> {
    const all = await this.allConfigValues();
    return all[name] ?? {};
  }

  async setConfigValues(name: string, values: PluginConfigValues): Promise<PluginDetail> {
    const detail = await this.getDetail(name);
    if (!detail) {
      throw new PluginError(`没有名为 ${name} 的插件`);
    }
    const all = await this.allConfigValues();
    all[name] = values;
    await this.store.setSetting(OPTIONS_KEY, JSON.stringify(all));
    console.info(`[plugin] 更新插件配置 name=${name} keys=${Object.keys(values).join(",") || "(空)"}`);
    const updated = await this.getDetail(name);
    if (!updated) {
      throw new PluginError(`更新配置后未能读取插件详情 name=${name}`);
    }
    return updated;
  }

  /** 从本地目录、本地 .zip 或 GitHub 链接安装插件到已安装目录。 */
  async install(input: PluginInstallInput): Promise<PluginSummary> {
    let tempDir: string | undefined;
    try {
      let sourceDir: string;
      if (input.url) {
        tempDir = await mkdtemp(join(tmpdir(), "cxb-plugin-"));
        sourceDir = await this.downloadAndExtract(input.url.trim(), tempDir);
      } else if (input.path) {
        const path = input.path.trim();
        if (path.toLowerCase().endsWith(".zip")) {
          tempDir = await mkdtemp(join(tmpdir(), "cxb-plugin-"));
          sourceDir = extractZip(path, join(tempDir, "extracted"));
        } else {
          sourceDir = path;
        }
      } else {
        throw new PluginError("需提供本地路径或 GitHub 链接");
      }

      const manifestDir = await findManifestDir(sourceDir);
      if (!manifestDir) {
        throw new PluginError("未找到 .claude-plugin/plugin.json，请确认这是一个合法插件");
      }
      const manifest = await readManifest(manifestDir);
      if (!manifest) {
        throw new PluginError("插件 manifest 解析失败（缺少合法的 plugin.json）");
      }
      if (!PLUGIN_NAME_PATTERN.test(manifest.name)) {
        throw new PluginError(`插件名 ${manifest.name} 不合法：只能包含小写字母、数字和连字符`);
      }
      const existing = await this.discover();
      if (existing.some((plugin) => plugin.name === manifest.name && plugin.source === "installed")) {
        throw new PluginError(`已安装名为 ${manifest.name} 的插件，请先卸载后再安装`);
      }

      const dest = join(this.installedRoot, manifest.name);
      await mkdir(this.installedRoot, { recursive: true });
      await rm(dest, { recursive: true, force: true });
      await cp(manifestDir, dest, { recursive: true });
      console.info(
        `[plugin] 安装插件成功 name=${manifest.name} from=${input.url ?? input.path} dest=${dest}`
      );
      return this.toSummary({ name: manifest.name, source: "installed", root: dest, manifest }, false);
    } finally {
      if (tempDir) {
        await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
      }
    }
  }

  async uninstall(name: string): Promise<boolean> {
    if (!PLUGIN_NAME_PATTERN.test(name)) {
      throw new PluginError("非法的插件名");
    }
    const discovered = await this.discover();
    const hit = discovered.find((plugin) => plugin.name === name);
    if (!hit) {
      return false;
    }
    if (hit.source !== "installed") {
      throw new PluginError("内置插件不可卸载");
    }
    await rm(hit.root, { recursive: true, force: true });
    const enabled = await this.enabledPluginNames();
    if (enabled.delete(name)) {
      await this.store.setSetting(ENABLED_KEY, JSON.stringify([...enabled].sort()));
    }
    const all = await this.allConfigValues();
    if (all[name]) {
      delete all[name];
      await this.store.setSetting(OPTIONS_KEY, JSON.stringify(all));
    }
    console.info(`[plugin] 卸载插件 name=${name} root=${hit.root}`);
    return true;
  }

  private async toSummary(plugin: DiscoveredPlugin, enabled: boolean): Promise<PluginSummary> {
    const contributions = await countContributions(plugin);
    return {
      name: plugin.name,
      version: plugin.manifest.version,
      description: plugin.manifest.description ?? "",
      author: authorName(plugin.manifest.author),
      source: plugin.source,
      enabled,
      hasConfig: Boolean(
        plugin.manifest.userConfig && Object.keys(plugin.manifest.userConfig).length > 0
      ),
      contributions
    };
  }

  private async allConfigValues(): Promise<Record<string, PluginConfigValues>> {
    const raw = await this.store.getSetting(OPTIONS_KEY);
    if (!raw) {
      return {};
    }
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? (parsed as Record<string, PluginConfigValues>) : {};
    } catch (error) {
      console.warn(`[plugin] 配置解析失败，按空处理: ${String(error)}`);
      return {};
    }
  }

  private async downloadAndExtract(url: string, tempDir: string): Promise<string> {
    const zipUrl = resolvePluginZipballUrl(url);
    console.info(`[plugin] 下载插件 zipball url=${zipUrl}`);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PLUGIN_DOWNLOAD_TIMEOUT_MS);
    let buffer: Buffer;
    try {
      const response = await fetch(zipUrl, { signal: controller.signal, redirect: "follow" });
      if (!response.ok) {
        throw new PluginError(`下载插件失败 HTTP ${response.status}`);
      }
      buffer = await readResponseBufferWithLimit(response, PLUGIN_DOWNLOAD_MAX_BYTES);
    } catch (error) {
      if (error instanceof PluginError) {
        throw error;
      }
      if (error instanceof Error && error.name === "AbortError") {
        throw new PluginError(`下载插件超时（${PLUGIN_DOWNLOAD_TIMEOUT_MS}ms）`);
      }
      throw new PluginError(`下载插件失败: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      clearTimeout(timeout);
    }
    const zipPath = join(tempDir, "plugin.zip");
    await writeFile(zipPath, buffer);
    return extractZip(zipPath, join(tempDir, "extracted"));
  }
}

/** 业务可预期的失败（重名、链接无效、非法插件等），路由层映射为 400。 */
export class PluginError extends Error {}

/** 读取并校验插件 manifest（当前目录优先，回退旧兼容目录）。 */
async function readManifest(pluginDir: string): Promise<PluginManifest | undefined> {
  for (const sub of MANIFEST_DIRS) {
    const manifestPath = join(pluginDir, sub, MANIFEST_FILE);
    let raw: string;
    try {
      raw = await readFile(manifestPath, "utf8");
    } catch {
      continue;
    }
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch (error) {
      console.warn(`[plugin] plugin.json 不是合法 JSON path=${manifestPath}: ${String(error)}`);
      continue;
    }
    const parsed = pluginManifestSchema.safeParse(json);
    if (parsed.success) {
      return parsed.data;
    }
    console.warn(`[plugin] manifest 校验失败 path=${manifestPath}: ${parsed.error.message}`);
  }
  return undefined;
}

/** 在 root 下广度优先查找含 manifest 的目录（应对 GitHub zip 多套一层 `repo-ref/`）。 */
async function findManifestDir(root: string, maxDepth = 3): Promise<string | undefined> {
  const queue: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
  while (queue.length > 0) {
    const { dir, depth } = queue.shift() as { dir: string; depth: number };
    if (await readManifest(dir)) {
      return dir;
    }
    if (depth >= maxDepth) {
      continue;
    }
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith(".")) {
        queue.push({ dir: join(dir, entry.name), depth: depth + 1 });
      }
    }
  }
  return undefined;
}

function extractZip(zipPath: string, destDir: string): string {
  try {
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(destDir, true);
  } catch (error) {
    throw new PluginError(`解压插件失败: ${error instanceof Error ? error.message : String(error)}`);
  }
  return destDir;
}

/** 把 GitHub 仓库/目录链接翻译为可下载的 zipball 地址；.zip 直链原样使用。 */
function resolvePluginZipballUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new PluginError("无法识别的链接，请提供 GitHub 仓库链接或 .zip 直链");
  }
  if (parsed.protocol !== "https:") {
    throw new PluginError("仅支持 https 链接");
  }
  if (parsed.pathname.toLowerCase().endsWith(".zip")) {
    return parsed.href;
  }
  if (parsed.hostname === "codeload.github.com") {
    return parsed.href;
  }
  if (parsed.hostname === "github.com") {
    const segments = parsed.pathname.split("/").filter(Boolean);
    if (segments.length < 2) {
      throw new PluginError("无法识别的 GitHub 仓库链接");
    }
    const [owner, repo, kind, ref] = segments;
    const cleanRepo = repo.replace(/\.git$/, "");
    if (kind === "tree" && ref) {
      return `https://codeload.github.com/${owner}/${cleanRepo}/zip/${ref}`;
    }
    return `https://codeload.github.com/${owner}/${cleanRepo}/zip/HEAD`;
  }
  throw new PluginError("仅支持 GitHub 仓库链接或 .zip 直链");
}

async function readResponseBufferWithLimit(response: Response, maxBytes: number): Promise<Buffer> {
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new PluginError(`插件包超过大小上限（${formatBytes(maxBytes)}）`);
  }
  const reader = response.body?.getReader();
  if (!reader) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > maxBytes) {
      throw new PluginError(`插件包超过大小上限（${formatBytes(maxBytes)}）`);
    }
    return buffer;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (!value) {
      continue;
    }
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      console.warn("[plugin] 插件包超过大小上限，已中止下载", { maxBytes, totalBytes: total });
      throw new PluginError(`插件包超过大小上限（${formatBytes(maxBytes)}）`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
}

async function countContributions(plugin: DiscoveredPlugin): Promise<PluginContributions> {
  const [skills, commands, mcpServerNames, hooks] = await Promise.all([
    readSkillDir(join(plugin.root, "skills")),
    loadPluginCommands(plugin.root),
    readMcpServerNames(plugin.root, plugin.manifest),
    countHooks(plugin.root, plugin.manifest)
  ]);
  return {
    skills: skills.length,
    commands: commands.length,
    mcpServers: mcpServerNames.length,
    hooks
  };
}

async function readPluginSkillRefs(root: string): Promise<Array<{ name: string; description: string }>> {
  const skills = await readSkillDir(join(root, "skills"));
  return skills.map((skill) => ({ name: skill.name, description: skill.description }));
}

async function readPluginCommandRefs(
  root: string
): Promise<Array<{ name: string; description: string; argumentHint?: string }>> {
  const commands = await loadPluginCommands(root);
  return commands.map((command) => ({
    name: command.template.name,
    description: command.template.description ?? "",
    argumentHint: command.argumentHint
  }));
}

/** 合并 manifest.mcpServers 与独立 .mcp.json 声明的 server 名（去重）。 */
async function readMcpServerNames(root: string, manifest: PluginManifest): Promise<string[]> {
  const names = new Set<string>();
  if (manifest.mcpServers) {
    for (const key of Object.keys(manifest.mcpServers)) {
      names.add(key);
    }
  }
  try {
    const parsed = JSON.parse(await readFile(join(root, ".mcp.json"), "utf8")) as {
      mcpServers?: Record<string, unknown>;
    };
    if (parsed?.mcpServers && typeof parsed.mcpServers === "object") {
      for (const key of Object.keys(parsed.mcpServers)) {
        names.add(key);
      }
    }
  } catch {
    // 没有 .mcp.json 属正常情况
  }
  return [...names].sort();
}

/** 统计插件声明的 hook 事件数（manifest.hooks 优先，回退 hooks/hooks.json）。 */
async function countHooks(root: string, manifest: PluginManifest): Promise<number> {
  let config: unknown = manifest.hooks;
  if (typeof config === "string") {
    try {
      config = JSON.parse(await readFile(join(root, config), "utf8"));
    } catch {
      return 0;
    }
  }
  if (!config) {
    try {
      config = JSON.parse(await readFile(join(root, "hooks", "hooks.json"), "utf8"));
    } catch {
      return 0;
    }
  }
  if (config && typeof config === "object") {
    const events = (config as { hooks?: Record<string, unknown> }).hooks ?? config;
    if (events && typeof events === "object") {
      return Object.keys(events).length;
    }
  }
  return 0;
}

function toConfigFields(userConfig: PluginManifest["userConfig"]): PluginConfigField[] {
  if (!userConfig) {
    return [];
  }
  return Object.entries(userConfig).map(([key, def]) => ({
    key,
    type: def.type ?? "string",
    description: def.description,
    default: def.default
  }));
}

function authorName(author: PluginManifest["author"]): string | undefined {
  if (!author) {
    return undefined;
  }
  return typeof author === "string" ? author : author.name;
}

function formatBytes(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))}MB`;
}
