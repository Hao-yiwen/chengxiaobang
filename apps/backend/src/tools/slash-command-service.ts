import { homedir } from "node:os";
import { join } from "node:path";
import {
  formatPromptTemplateInvocation,
  formatSkillInvocation,
  loadPromptTemplates,
  loadSkills,
  NodeExecutionEnv,
  type FileError,
  type FileInfo,
  type Result,
  parseCommandArgs,
  type PromptTemplate,
  type Skill
} from "@earendil-works/pi-agent-core/node";
import type {
  Project,
  SlashCommand,
  SlashCommandDiagnostic,
  SlashCommandSource
} from "@chengxiaobang/shared";
import { builtinResourceRoot } from "../paths";
import { loadPluginCommands } from "./plugin-commands";

export interface SlashCommandLookup {
  prompt: string;
  matched: boolean;
}

interface LoadedResource {
  kind: "prompt_template" | "skill";
  source: SlashCommandSource;
  /** plugin 来源时的归属插件名。 */
  pluginName?: string;
  /** 插件命令的参数提示（来自 commands/*.md 的 argument-hint）。 */
  argumentHint?: string;
  /** 被单项停用：仍出现在 list（供 UI 重新启用），但不进入模型可见清单/命令展开。 */
  disabled?: boolean;
  template?: PromptTemplate;
  skill?: Skill;
}

export const builtinSlashCommands: SlashCommand[] = [
  {
    id: "builtin:/compact",
    name: "/compact",
    kind: "builtin_tool",
    description: "压缩对话上下文：将较早的历史总结为摘要，节省 token",
    source: "builtin",
    insertText: "/compact"
  }
];

type PluginRootsProvider = () => Promise<Array<{ pluginName: string; root: string }>>;

export interface SlashCommandServiceOptions {
  /** 随应用分发的市场技能目录；默认 builtin 根旁的 skills-market。 */
  marketRoot?: string;
  /** 已激活市场技能名集合；未注入时市场技能一律不加载。 */
  enabledMarketSkills?: () => Promise<Set<string>>;
  /** 已启用插件根目录回调；未注入时不加载任何插件资源。 */
  enabledPluginRoots?: PluginRootsProvider;
  /** 被单项停用的插件技能名集合回调（黑名单），命中者从模型可见清单/展开中剔除。 */
  disabledSkills?: () => Promise<Set<string>>;
  /** 被单项停用的插件命令名集合回调（黑名单），命中者从命令展开中剔除。 */
  disabledCommands?: () => Promise<Set<string>>;
}

export class SlashCommandService {
  private readonly marketRoot: string;
  private readonly enabledMarketSkills?: () => Promise<Set<string>>;
  private readonly enabledPluginRoots?: PluginRootsProvider;
  private readonly disabledSkills?: () => Promise<Set<string>>;
  private readonly disabledCommands?: () => Promise<Set<string>>;

  constructor(
    private readonly globalRoot = join(homedir(), ".chengxiaobang"),
    private readonly builtinRoot = builtinResourceRoot(),
    options: SlashCommandServiceOptions = {}
  ) {
    this.marketRoot = options.marketRoot ?? join(builtinResourceRoot(), "skills-market");
    this.enabledMarketSkills = options.enabledMarketSkills;
    this.enabledPluginRoots = options.enabledPluginRoots;
    this.disabledSkills = options.disabledSkills;
    this.disabledCommands = options.disabledCommands;
  }

  async list(project?: Project): Promise<{
    commands: SlashCommand[];
    diagnostics: SlashCommandDiagnostic[];
  }> {
    const diagnostics: SlashCommandDiagnostic[] = [];
    const resources = await this.loadResources(project, diagnostics);
    return {
      commands: mergeCommands(resources),
      diagnostics
    };
  }

  async expandPrompt(prompt: string, project?: Project): Promise<SlashCommandLookup> {
    const parsed = parseSlashPrompt(prompt);
    if (!parsed) {
      return { prompt, matched: false };
    }
    const diagnostics: SlashCommandDiagnostic[] = [];
    const resources = await this.loadResources(project, diagnostics);
    const resource = findResource(
      resources.filter((entry) => !entry.disabled),
      parsed.name
    );
    if (!resource) {
      return { prompt, matched: false };
    }
    if (resource.kind === "prompt_template" && resource.template) {
      return {
        prompt: formatPromptTemplateInvocation(
          resource.template,
          parseCommandArgs(parsed.rest)
        ),
        matched: true
      };
    }
    if (resource.kind === "skill" && resource.skill) {
      return {
        prompt: formatSkillInvocation(resource.skill, parsed.rest.trim() || undefined),
        matched: true
      };
    }
    return { prompt, matched: false };
  }

  /**
   * 模型可自主发现的技能清单（§5.3）：仅 name+description（正文经 Skill 按需拉取），
   * 过滤 disableModelInvocation，同名按 project > global > builtin 去重。
   */
  async listSkills(project?: Project): Promise<Array<{ name: string; description: string }>> {
    const resources = await this.loadResources(project, []);
    const byName = new Map<string, { skill: Skill; source: SlashCommandSource }>();
    for (const resource of modelVisibleSkills(resources)) {
      const existing = byName.get(resource.skill.name);
      if (existing && sourceRank(existing.source) >= sourceRank(resource.source)) {
        continue;
      }
      byName.set(resource.skill.name, { skill: resource.skill, source: resource.source });
    }
    return [...byName.values()].map(({ skill }) => ({
      name: skill.name,
      description: skill.description
    }));
  }

  /** 按名称查找模型可调用的技能（§5.3）：复用 findResource 的优先级，尊重 disableModelInvocation。 */
  async findSkill(name: string, project?: Project): Promise<Skill | undefined> {
    const resources = await this.loadResources(project, []);
    return findResource(modelVisibleSkills(resources), name)?.skill;
  }

  private async loadResources(
    project: Project | undefined,
    diagnostics: SlashCommandDiagnostic[]
  ): Promise<LoadedResource[]> {
    const resources: LoadedResource[] = [];
    for (const source of resourceSources(this.globalRoot, this.builtinRoot, project)) {
      const env = new SlashCommandExecutionEnv({ cwd: source.root });
      try {
        const promptResult = await loadPromptTemplates(env, ["prompts"]);
        resources.push(
          ...promptResult.promptTemplates.map((template) => ({
            kind: "prompt_template" as const,
            source: source.name,
            template
          }))
        );
        diagnostics.push(
          ...promptResult.diagnostics.map((diagnostic) => ({
            type: "warning" as const,
            message: diagnostic.message,
            path: diagnostic.path,
            source: source.name
          }))
        );

        const skillResult = await loadSkills(env, ["skills"]);
        resources.push(
          ...skillResult.skills.map((skill) => ({
            kind: "skill" as const,
            source: source.name,
            skill
          }))
        );
        diagnostics.push(
          ...skillResult.diagnostics.map((diagnostic) => ({
            type: "warning" as const,
            message: diagnostic.message,
            path: diagnostic.path,
            source: source.name
          }))
        );
      } catch (error) {
        console.warn("[slash-command-service] 加载斜杠资源失败", {
          source: source.name,
          root: source.root,
          error: error instanceof Error ? error.message : String(error)
        });
        throw error;
      } finally {
        await env.cleanup();
      }
    }
    resources.push(...(await this.loadMarketSkills(diagnostics)));
    resources.push(...(await this.loadPluginResources(diagnostics)));
    return resources;
  }

  /** 市场技能与内置技能同根分发，但只有被用户激活的才进入命令/技能清单。 */
  private async loadMarketSkills(
    diagnostics: SlashCommandDiagnostic[]
  ): Promise<LoadedResource[]> {
    if (!this.enabledMarketSkills) {
      return [];
    }
    const enabled = await this.enabledMarketSkills();
    if (enabled.size === 0) {
      return [];
    }
    const env = new SlashCommandExecutionEnv({ cwd: this.marketRoot });
    try {
      const skillResult = await loadSkills(env, ["."]);
      diagnostics.push(
        ...skillResult.diagnostics.map((diagnostic) => ({
          type: "warning" as const,
          message: diagnostic.message,
          path: diagnostic.path,
          source: "market" as const
        }))
      );
      return skillResult.skills
        .filter((skill) => enabled.has(skill.name))
        .map((skill) => ({
          kind: "skill" as const,
          source: "market" as const,
          skill
        }));
    } catch (error) {
      console.warn("[slash-command-service] 加载市场技能失败", {
        root: this.marketRoot,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    } finally {
      await env.cleanup();
    }
  }

  /** 已启用插件提供的技能与命令；被黑名单标记的仍列出但标 disabled（供 UI 重新启用）。 */
  private async loadPluginResources(
    diagnostics: SlashCommandDiagnostic[]
  ): Promise<LoadedResource[]> {
    if (!this.enabledPluginRoots) {
      return [];
    }
    const roots = await this.enabledPluginRoots();
    if (roots.length === 0) {
      return [];
    }
    const [disabledSkills, disabledCommands] = await Promise.all([
      this.disabledSkills ? this.disabledSkills() : Promise.resolve(new Set<string>()),
      this.disabledCommands ? this.disabledCommands() : Promise.resolve(new Set<string>())
    ]);
    const resources: LoadedResource[] = [];
    for (const { pluginName, root } of roots) {
      const env = new SlashCommandExecutionEnv({ cwd: root });
      try {
        const skillResult = await loadSkills(env, ["skills"]);
        resources.push(
          ...skillResult.skills.map((skill) => ({
            kind: "skill" as const,
            source: "plugin" as const,
            pluginName,
            disabled: disabledSkills.has(skill.name),
            skill
          }))
        );
        diagnostics.push(
          ...skillResult.diagnostics.map((diagnostic) => ({
            type: "warning" as const,
            message: diagnostic.message,
            path: diagnostic.path,
            source: "plugin" as const
          }))
        );
      } catch (error) {
        console.warn("[slash-command-service] 加载插件技能失败", {
          pluginName,
          root,
          error: error instanceof Error ? error.message : String(error)
        });
      } finally {
        await env.cleanup();
      }
      try {
        const commands = await loadPluginCommands(root);
        resources.push(
          ...commands.map((command) => ({
            kind: "prompt_template" as const,
            source: "plugin" as const,
            pluginName,
            argumentHint: command.argumentHint,
            disabled: disabledCommands.has(command.template.name),
            template: command.template
          }))
        );
      } catch (error) {
        console.warn("[slash-command-service] 加载插件命令失败", {
          pluginName,
          root,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
    return resources;
  }
}

class SlashCommandExecutionEnv extends NodeExecutionEnv {
  override async absolutePath(path: string): Promise<Result<string, FileError>> {
    return normalizePathResult(await super.absolutePath(path));
  }

  override async joinPath(parts: string[]): Promise<Result<string, FileError>> {
    return normalizePathResult(await super.joinPath(parts));
  }

  override async fileInfo(path: string): Promise<Result<FileInfo, FileError>> {
    return normalizeFileInfoResult(await super.fileInfo(path));
  }

  override async listDir(
    path: string,
    abortSignal?: AbortSignal
  ): Promise<Result<FileInfo[], FileError>> {
    const result = await super.listDir(path, abortSignal);
    if (!result.ok) {
      return result;
    }
    return {
      ok: true,
      value: result.value.map(normalizeFileInfo)
    };
  }

  override async canonicalPath(path: string): Promise<Result<string, FileError>> {
    return normalizePathResult(await super.canonicalPath(path));
  }
}

function normalizePathResult<TError>(result: Result<string, TError>): Result<string, TError> {
  if (!result.ok) {
    return result;
  }
  return { ok: true, value: normalizeEnvPath(result.value) };
}

function normalizeFileInfoResult<TError>(
  result: Result<FileInfo, TError>
): Result<FileInfo, TError> {
  if (!result.ok) {
    return result;
  }
  return { ok: true, value: normalizeFileInfo(result.value) };
}

function normalizeFileInfo(info: FileInfo): FileInfo {
  const path = normalizeEnvPath(info.path);
  return {
    ...info,
    name: basenameEnvPath(path),
    path
  };
}

function normalizeEnvPath(path: string): string {
  return path.replaceAll("\\", "/");
}

function basenameEnvPath(path: string): string {
  const normalized = path.replace(/\/+$/u, "");
  return normalized.split("/").pop() ?? normalized;
}

function resourceSources(
  globalRoot: string,
  builtinRoot: string,
  project: Project | undefined
): Array<{ name: SlashCommandSource; root: string }> {
  const sources: Array<{ name: SlashCommandSource; root: string }> = [
    { name: "builtin", root: builtinRoot },
    { name: "global", root: globalRoot }
  ];
  if (project) {
    sources.push({ name: "project", root: join(project.path, ".chengxiaobang") });
  }
  return sources;
}

function mergeCommands(resources: LoadedResource[]): SlashCommand[] {
  const byName = new Map<string, SlashCommand>();
  for (const command of builtinSlashCommands) {
    byName.set(command.name, command);
  }
  for (const resource of resources) {
    const command = resourceToCommand(resource);
    const existing = byName.get(command.name);
    if (existing && sourceRank(existing.source) > sourceRank(command.source)) {
      continue;
    }
    if (
      existing &&
      sourceRank(existing.source) === sourceRank(command.source) &&
      kindRank(existing.kind) >= kindRank(command.kind)
    ) {
      continue;
    }
    byName.set(command.name, command);
  }
  return [...byName.values()].sort(compareCommands);
}

type SkillResource = LoadedResource & { kind: "skill"; skill: Skill };

/** kind==="skill" 且未禁用模型调用的资源（listSkills / findSkill 共用过滤，§5.3）。 */
function modelVisibleSkills(resources: LoadedResource[]): SkillResource[] {
  return resources.filter(
    (resource): resource is SkillResource =>
      resource.kind === "skill" &&
      resource.skill !== undefined &&
      resource.skill.disableModelInvocation !== true &&
      resource.disabled !== true
  );
}

function findResource(resources: LoadedResource[], rawName: string): LoadedResource | undefined {
  let match: LoadedResource | undefined;
  for (const resource of resources) {
    const name = resourceName(resource);
    if (
      name === rawName &&
      (!match ||
        sourceRank(resource.source) > sourceRank(match.source) ||
        (sourceRank(resource.source) === sourceRank(match.source) &&
          kindRank(resource.kind) > kindRank(match.kind)))
    ) {
      match = resource;
    }
  }
  return match;
}

function resourceToCommand(resource: LoadedResource): SlashCommand {
  const rawName = resourceName(resource);
  const name = `/${rawName}`;
  return {
    id: resource.pluginName
      ? `plugin:${resource.pluginName}:${resource.kind}:${rawName}`
      : `${resource.source}:${resource.kind}:${rawName}`,
    name,
    kind: resource.kind,
    description: resource.template?.description ?? resource.skill?.description ?? "",
    source: resource.source,
    insertText: `${name} `,
    ...(resource.pluginName ? { pluginName: resource.pluginName } : {}),
    ...(resource.argumentHint ? { argumentHint: resource.argumentHint } : {}),
    ...(resource.source === "plugin" ? { enabled: !resource.disabled } : {})
  };
}

function resourceName(resource: LoadedResource): string {
  return resource.template?.name ?? resource.skill?.name ?? "";
}

function compareCommands(a: SlashCommand, b: SlashCommand): number {
  const sourceOrder = sourceRank(b.source) - sourceRank(a.source);
  if (sourceOrder !== 0) {
    return sourceOrder;
  }
  return a.name.localeCompare(b.name);
}

function sourceRank(source: SlashCommandSource): number {
  if (source === "project") {
    return 4;
  }
  if (source === "global") {
    return 3;
  }
  if (source === "plugin") {
    return 2;
  }
  if (source === "market") {
    return 1;
  }
  return 0;
}

function kindRank(kind: SlashCommand["kind"]): number {
  if (kind === "prompt_template") {
    return 2;
  }
  if (kind === "skill") {
    return 1;
  }
  return 0;
}

function parseSlashPrompt(prompt: string): { name: string; rest: string } | undefined {
  const trimmed = prompt.trim();
  if (!trimmed.startsWith("/")) {
    return undefined;
  }
  const withoutSlash = trimmed.slice(1);
  const match = withoutSlash.match(/^(\S+)(?:\s+([\s\S]*))?$/);
  if (!match?.[1]) {
    return undefined;
  }
  return { name: match[1], rest: match[2] ?? "" };
}
