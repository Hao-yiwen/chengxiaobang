import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import type {
  SkillCategory,
  SkillCreateInput,
  SkillDetail,
  SkillImportInput,
  SkillSummary
} from "@chengxiaobang/shared";
import type { StateStore } from "../repository/state-store";
import { builtinResourceRoot } from "../paths";

import { getLogger } from "../logging/logger";

const log = getLogger({ module: "tools/skill-market-service" });

/** 激活的市场技能名集合，JSON 数组存 settings KV。 */
const ENABLED_SETTING_KEY = "skills.enabledMarketSkills";
/** 被单项停用的插件来源技能名集合（黑名单），JSON 数组存 settings KV。 */
const DISABLED_SKILLS_KEY = "skills.disabled";
/** 被单项停用的插件来源命令名集合（黑名单），JSON 数组存 settings KV。 */
const DISABLED_COMMANDS_KEY = "commands.disabled";

const SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const SKILL_IMPORT_TIMEOUT_MS = 10_000;
const SKILL_IMPORT_MAX_BYTES = 256 * 1024;

type SettingsStore = Pick<StateStore, "getSetting" | "setSetting">;

/** 已启用插件根目录回调；返回每个插件的名字与磁盘根，供技能聚合读取其 skills/。 */
type PluginRootsProvider = () => Promise<Array<{ pluginName: string; root: string }>>;

interface SkillFileMeta {
  name: string;
  description: string;
  category: SkillCategory;
}

export interface SkillMarketServiceOptions {
  /** 随应用分发、默认未激活的市场技能目录。 */
  marketRoot?: string;
  /** 始终激活的内置技能目录。 */
  builtinRoot?: string;
  /** 自定义技能安装目录（即全局 skills 根，slash 服务会自动加载）。 */
  customRoot?: string;
  /** 已启用插件根目录回调，用于把插件 skills/ 聚合进技能列表。 */
  enabledPluginRoots?: PluginRootsProvider;
}

/**
 * 技能市场：内置技能只读展示，市场技能经 settings KV 记录激活集合，
 * 自定义技能安装到 ~/.chengxiaobang/skills（安装即被 SlashCommandService 拾取）；
 * 已启用插件提供的技能聚合进列表，可经 skills.disabled 黑名单单项停用。
 */
export class SkillMarketService {
  private readonly marketRoot: string;
  private readonly builtinRoot: string;
  private readonly customRoot: string;
  private readonly enabledPluginRoots?: PluginRootsProvider;

  constructor(
    private readonly store: SettingsStore,
    options: SkillMarketServiceOptions = {}
  ) {
    this.marketRoot = options.marketRoot ?? join(builtinResourceRoot(), "skills-market");
    this.builtinRoot = options.builtinRoot ?? join(builtinResourceRoot(), "skills");
    this.customRoot = options.customRoot ?? join(homedir(), ".chengxiaobang", "skills");
    this.enabledPluginRoots = options.enabledPluginRoots;
  }

  async list(): Promise<SkillSummary[]> {
    const [enabled, disabled, pluginRoots] = await Promise.all([
      this.enabledMarketSkillNames(),
      this.disabledSkillNames(),
      this.pluginRoots()
    ]);
    const [builtin, market, custom] = await Promise.all([
      readSkillDir(this.builtinRoot),
      readSkillDir(this.marketRoot),
      readSkillDir(this.customRoot)
    ]);
    const plugin = await this.readPluginSkillSummaries(pluginRoots, disabled);
    return [
      ...builtin.map((meta) => toSummary(meta, "builtin", true)),
      ...market.map((meta) => toSummary(meta, "market", enabled.has(meta.name))),
      ...custom.map((meta) => toSummary(meta, "custom", true)),
      ...plugin
    ];
  }

  /**
   * 单个技能的详情（含 SKILL.md 正文），供详情页渲染。
   * 按 builtin → market → custom 顺序查找首个匹配的 name；找不到返回 undefined。
   */
  async getDetail(name: string): Promise<SkillDetail | undefined> {
    const enabled = await this.enabledMarketSkillNames();
    const sources = [
      { root: this.builtinRoot, source: "builtin" as const },
      { root: this.marketRoot, source: "market" as const },
      { root: this.customRoot, source: "custom" as const }
    ];
    for (const { root, source } of sources) {
      const entries = await readSkillDir(root);
      const hit = entries.find((meta) => meta.name === name);
      if (!hit) {
        continue;
      }
      const filePath = join(root, hit.dirName, "SKILL.md");
      let raw: string;
      try {
        raw = await readFile(filePath, "utf8");
      } catch (error) {
        log.warn(`[skill-market] 读取技能正文失败 path=${filePath}: ${String(error)}`);
        return undefined;
      }
      const isEnabled = source === "market" ? enabled.has(name) : true;
      return {
        ...toSummary(hit, source, isEnabled),
        content: stripFrontmatter(raw),
        filePath
      };
    }
    const disabled = await this.disabledSkillNames();
    for (const { pluginName, root } of await this.pluginRoots()) {
      const entries = await readSkillDir(join(root, "skills"));
      const hit = entries.find((meta) => meta.name === name);
      if (!hit) {
        continue;
      }
      const filePath = join(root, "skills", hit.dirName, "SKILL.md");
      let raw: string;
      try {
        raw = await readFile(filePath, "utf8");
      } catch (error) {
        log.warn(`[skill-market] 读取插件技能正文失败 path=${filePath}: ${String(error)}`);
        return undefined;
      }
      return {
        ...toSummary(hit, "plugin", !disabled.has(name), pluginName),
        content: stripFrontmatter(raw),
        filePath
      };
    }
    log.warn(`[skill-market] 未找到技能详情 name=${name}`);
    return undefined;
  }

  /** SlashCommandService 据此过滤市场技能：只有激活的才进入命令/技能清单。 */
  async enabledMarketSkillNames(): Promise<Set<string>> {
    const raw = await this.store.getSetting(ENABLED_SETTING_KEY);
    if (!raw) {
      return new Set();
    }
    try {
      const parsed = JSON.parse(raw);
      return new Set(Array.isArray(parsed) ? parsed.filter((v) => typeof v === "string") : []);
    } catch (error) {
      log.warn(`[skill-market] 激活技能配置解析失败，按空集处理: ${String(error)}`);
      return new Set();
    }
  }

  async setMarketSkillEnabled(name: string, enabled: boolean): Promise<SkillSummary[]> {
    const market = await readSkillDir(this.marketRoot);
    if (!market.some((meta) => meta.name === name)) {
      throw new SkillMarketError(`市场中没有名为 ${name} 的技能`);
    }
    const current = await this.enabledMarketSkillNames();
    if (enabled) {
      current.add(name);
    } else {
      current.delete(name);
    }
    await this.store.setSetting(ENABLED_SETTING_KEY, JSON.stringify([...current].sort()));
    log.info(`[skill-market] ${enabled ? "激活" : "停用"}市场技能 name=${name}`);
    return this.list();
  }

  /** 被单项停用的插件来源技能名集合（SlashCommandService 据此从模型可见清单中剔除）。 */
  async disabledSkillNames(): Promise<Set<string>> {
    return parseNameSet(await this.store.getSetting(DISABLED_SKILLS_KEY), "停用技能集合");
  }

  /** 单项停用/恢复一个（通常是插件来源的）技能，写入 skills.disabled 黑名单。 */
  async setSkillDisabled(name: string, disabled: boolean): Promise<SkillSummary[]> {
    const current = await this.disabledSkillNames();
    if (disabled) {
      current.add(name);
    } else {
      current.delete(name);
    }
    await this.store.setSetting(DISABLED_SKILLS_KEY, JSON.stringify([...current].sort()));
    log.info(`[skill-market] ${disabled ? "停用" : "启用"}技能 name=${name}`);
    return this.list();
  }

  /** 被单项停用的插件来源命令名集合（SlashCommandService 据此从命令面板/展开中剔除）。 */
  async disabledCommandNames(): Promise<Set<string>> {
    return parseNameSet(await this.store.getSetting(DISABLED_COMMANDS_KEY), "停用命令集合");
  }

  /** 单项停用/恢复一个（通常是插件来源的）命令，写入 commands.disabled 黑名单。 */
  async setCommandDisabled(name: string, disabled: boolean): Promise<void> {
    const current = await this.disabledCommandNames();
    if (disabled) {
      current.add(name);
    } else {
      current.delete(name);
    }
    await this.store.setSetting(DISABLED_COMMANDS_KEY, JSON.stringify([...current].sort()));
    log.info(`[skill-market] ${disabled ? "停用" : "启用"}命令 name=${name}`);
  }

  private async pluginRoots(): Promise<Array<{ pluginName: string; root: string }>> {
    return this.enabledPluginRoots ? this.enabledPluginRoots() : [];
  }

  private async readPluginSkillSummaries(
    roots: Array<{ pluginName: string; root: string }>,
    disabled: Set<string>
  ): Promise<SkillSummary[]> {
    const summaries: SkillSummary[] = [];
    for (const { pluginName, root } of roots) {
      const skills = await readSkillDir(join(root, "skills"));
      for (const meta of skills) {
        summaries.push(toSummary(meta, "plugin", !disabled.has(meta.name), pluginName));
      }
    }
    return summaries;
  }

  /** 经 GitHub 链接（或 SKILL.md 直链）导入自定义技能。 */
  async importFromUrl(input: SkillImportInput): Promise<SkillSummary> {
    const candidates = resolveSkillFileUrls(input.url.trim());
    if (candidates.length === 0) {
      throw new SkillMarketError("无法识别的链接，请提供 GitHub 仓库/目录链接或 SKILL.md 直链");
    }
    let content: string | undefined;
    let hitUrl: string | undefined;
    const failures: string[] = [];
    for (const candidate of candidates) {
      log.info(`[skill-market] 尝试拉取技能文件 url=${candidate}`);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), SKILL_IMPORT_TIMEOUT_MS);
      try {
        const response = await fetch(candidate, { signal: controller.signal });
        if (response.ok) {
          content = await readResponseTextWithLimit(response, SKILL_IMPORT_MAX_BYTES);
          hitUrl = candidate;
          break;
        }
        failures.push(`${candidate} -> HTTP ${response.status}`);
      } catch (error) {
        failures.push(`${candidate} -> ${skillImportFailureText(error)}`);
      } finally {
        clearTimeout(timeout);
      }
    }
    if (!content) {
      log.warn(`[skill-market] 技能文件拉取失败: ${failures.join("; ")}`);
      if (failures.some((failure) => failure.includes("超过大小上限"))) {
        throw new SkillMarketError(`技能文件超过大小上限（${formatBytes(SKILL_IMPORT_MAX_BYTES)}）`);
      }
      if (failures.some((failure) => failure.includes("请求超时"))) {
        throw new SkillMarketError("拉取 SKILL.md 超时，请稍后重试");
      }
      throw new SkillMarketError("拉取 SKILL.md 失败，请确认链接指向包含 SKILL.md 的公开仓库或目录");
    }
    const meta = parseSkillFile(content);
    if (!meta) {
      throw new SkillMarketError("文件缺少有效的 frontmatter（需要 name 和 description 字段）");
    }
    const summary = await this.installCustom(meta, content);
    log.info(`[skill-market] 导入自定义技能成功 name=${summary.name} from=${hitUrl}`);
    return summary;
  }

  /** 手动创建自定义技能：frontmatter 由输入生成，正文为用户提供的指令。 */
  async createCustom(input: SkillCreateInput): Promise<SkillSummary> {
    // 名称先按技能名规则校验(原本只在 installCustom 里校验,发生在 parseSkillFile 之后):
    // 避免换行/冒号等破坏或注入 frontmatter 结构。
    if (!SKILL_NAME_PATTERN.test(input.name)) {
      throw new SkillMarketError("非法的技能名（只允许小写字母、数字与连字符，且以字母或数字开头）");
    }
    // description 去掉换行(parseSkillFile 是逐行解析,换行是唯一真正的注入向量;
    // 单行内的冒号/# 等都会被 (.+) 整体捕获,不破坏结构)。
    const safeDescription = input.description.replace(/[\r\n]+/g, " ").trim();
    const content = [
      "---",
      `name: ${input.name}`,
      `description: ${safeDescription}`,
      "metadata:",
      "  category: other",
      "  author: user",
      "---",
      "",
      input.content,
      ""
    ].join("\n");
    const meta = parseSkillFile(content);
    if (!meta) {
      throw new SkillMarketError("技能内容生成失败，请检查名称与描述");
    }
    const summary = await this.installCustom(meta, content);
    log.info(`[skill-market] 创建自定义技能成功 name=${summary.name}`);
    return summary;
  }

  async deleteCustom(name: string): Promise<boolean> {
    if (!SKILL_NAME_PATTERN.test(name)) {
      throw new SkillMarketError("非法的技能名");
    }
    const custom = await readSkillDir(this.customRoot);
    const hit = custom.find((meta) => meta.name === name);
    if (!hit) {
      return false;
    }
    await rm(join(this.customRoot, hit.dirName), { recursive: true, force: true });
    log.info(`[skill-market] 删除自定义技能 name=${name} dir=${hit.dirName}`);
    return true;
  }

  private async installCustom(
    meta: SkillFileMeta,
    content: string
  ): Promise<SkillSummary> {
    if (!SKILL_NAME_PATTERN.test(meta.name)) {
      throw new SkillMarketError(
        `技能名 ${meta.name} 不合法：只能包含小写字母、数字和连字符`
      );
    }
    const [builtin, market] = await Promise.all([
      readSkillDir(this.builtinRoot),
      readSkillDir(this.marketRoot)
    ]);
    if ([...builtin, ...market].some((existing) => existing.name === meta.name)) {
      throw new SkillMarketError(`技能名 ${meta.name} 与内置/市场技能重名，请改名后再导入`);
    }
    const dir = join(this.customRoot, meta.name);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "SKILL.md"), content, "utf8");
    return toSummary(meta, "custom", true);
  }
}

/** 业务可预期的失败（重名、链接无效等），路由层映射为 400。 */
export class SkillMarketError extends Error {}

function toSummary(
  meta: SkillFileMeta,
  source: SkillSummary["source"],
  enabled: boolean,
  pluginName?: string
): SkillSummary {
  return {
    name: meta.name,
    description: meta.description,
    category: meta.category,
    source,
    enabled,
    ...(pluginName ? { pluginName } : {})
  };
}

/** 把 settings KV 里的 JSON 字符串数组解析为名字集合；缺失或非法时按空集处理。 */
function parseNameSet(raw: string | undefined, label: string): Set<string> {
  if (!raw) {
    return new Set();
  }
  try {
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.filter((v) => typeof v === "string") : []);
  } catch (error) {
    log.warn(`[skill-market] ${label}解析失败，按空集处理: ${String(error)}`);
    return new Set();
  }
}

export type SkillDirEntry = SkillFileMeta & { dirName: string };

/** 列出根目录下每个含合法 SKILL.md 的技能；目录缺失返回空。供插件服务复用以列举插件 skills/。 */
export async function readSkillDir(root: string): Promise<SkillDirEntry[]> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const skills: SkillDirEntry[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const filePath = join(root, entry.name, "SKILL.md");
    let content: string;
    try {
      content = await readFile(filePath, "utf8");
    } catch {
      continue;
    }
    const meta = parseSkillFile(content);
    if (!meta) {
      log.warn(`[skill-market] 跳过无效技能文件 path=${filePath}`);
      continue;
    }
    skills.push({ ...meta, dirName: entry.name });
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * 轻量 frontmatter 解析：取顶层 name/description 与 metadata 下的 category。
 * 只支持单行标量（足以覆盖本仓技能与常见社区 SKILL.md）。
 */
export function parseSkillFile(content: string): SkillFileMeta | undefined {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match?.[1]) {
    return undefined;
  }
  let name: string | undefined;
  let description: string | undefined;
  let category: string | undefined;
  for (const line of match[1].split(/\r?\n/)) {
    const topLevel = line.match(/^(name|description):\s*(.+)$/);
    if (topLevel?.[1] === "name") {
      name = unquote(topLevel[2]);
    } else if (topLevel?.[1] === "description") {
      description = unquote(topLevel[2]);
    }
    const nested = line.match(/^\s+category:\s*(.+)$/);
    if (nested?.[1]) {
      category = unquote(nested[1]);
    }
  }
  if (!name || !description) {
    return undefined;
  }
  return {
    name,
    description,
    category: category === "coding" || category === "office" ? category : "other"
  };
}

/** 去掉开头的 YAML frontmatter，返回 SKILL.md 正文（详情页渲染用）。 */
export function stripFrontmatter(content: string): string {
  const match = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return (match ? content.slice(match[0].length) : content).replace(/^\s+/, "");
}

function unquote(value: string): string {
  const trimmed = value.trim();
  const quoted = trimmed.match(/^"(.*)"$|^'(.*)'$/);
  return (quoted?.[1] ?? quoted?.[2] ?? trimmed).trim();
}

/**
 * 把用户输入的链接翻译为 SKILL.md 的 raw 候选地址（按优先级尝试）：
 * - SKILL.md / *.md 直链按原样使用（github blob 链接转 raw）；
 * - github.com/owner/repo[/tree/<ref>/<path>] 视作技能目录，取其下 SKILL.md；
 * - 仓库根链接未指定分支时用 HEAD（raw.githubusercontent.com 支持）。
 */
export function resolveSkillFileUrls(url: string): string[] {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return [];
  }
  if (parsed.protocol !== "https:" || !isAllowedSkillImportHost(parsed.hostname)) {
    return [];
  }
  const path = parsed.pathname.replace(/\/+$/, "");
  if (parsed.hostname === "raw.githubusercontent.com") {
    return path.endsWith(".md") ? [parsed.href] : [`${parsed.origin}${path}/SKILL.md`];
  }
  if (parsed.hostname !== "github.com") {
    return [];
  }
  const segments = path.split("/").filter(Boolean);
  if (segments.length < 2) {
    return [];
  }
  const [owner, repo, kind, ref, ...rest] = segments;
  const rawBase = `https://raw.githubusercontent.com/${owner}/${repo}`;
  if ((kind === "blob" || kind === "tree" || kind === "raw") && ref) {
    const subPath = rest.join("/");
    if (subPath.endsWith(".md")) {
      return [`${rawBase}/${ref}/${subPath}`];
    }
    return [`${rawBase}/${ref}${subPath ? `/${subPath}` : ""}/SKILL.md`];
  }
  // 仓库根：默认分支用 HEAD。
  return [`${rawBase}/HEAD/SKILL.md`];
}

function isAllowedSkillImportHost(hostname: string): boolean {
  return hostname === "github.com" || hostname === "raw.githubusercontent.com";
}

function skillImportFailureText(error: unknown): string {
  if (error instanceof SkillMarketError) {
    return error.message;
  }
  if (error instanceof Error && error.name === "AbortError") {
    return `请求超时（${SKILL_IMPORT_TIMEOUT_MS}ms）`;
  }
  return error instanceof Error ? error.message : String(error);
}

async function readResponseTextWithLimit(response: Response, maxBytes: number): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new SkillMarketError(`技能文件超过大小上限（${formatBytes(maxBytes)}）`);
  }
  const reader = response.body?.getReader();
  if (!reader) {
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > maxBytes) {
      throw new SkillMarketError(`技能文件超过大小上限（${formatBytes(maxBytes)}）`);
    }
    return text;
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
      log.warn("[skill-market] 技能文件超过大小上限，已中止读取", {
        maxBytes,
        totalBytes: total
      });
      throw new SkillMarketError(`技能文件超过大小上限（${formatBytes(maxBytes)}）`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
}

function formatBytes(bytes: number): string {
  return `${Math.round(bytes / 1024)}KB`;
}
