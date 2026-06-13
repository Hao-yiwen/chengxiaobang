import { homedir } from "node:os";
import { join } from "node:path";
import {
  formatPromptTemplateInvocation,
  formatSkillInvocation,
  loadPromptTemplates,
  loadSkills,
  NodeExecutionEnv,
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

export interface SlashCommandLookup {
  prompt: string;
  matched: boolean;
}

interface LoadedResource {
  kind: "prompt_template" | "skill";
  source: SlashCommandSource;
  template?: PromptTemplate;
  skill?: Skill;
}

export const builtinSlashCommands: SlashCommand[] = [
  {
    id: "builtin:/ls",
    name: "/ls",
    kind: "builtin_tool",
    description: "列出当前项目目录内容",
    source: "builtin",
    insertText: "/ls "
  },
  {
    id: "builtin:/read",
    name: "/read",
    kind: "builtin_tool",
    description: "读取当前项目中的文件",
    source: "builtin",
    insertText: "/read "
  },
  {
    id: "builtin:/write",
    name: "/write",
    kind: "builtin_tool",
    description: "写入当前项目中的文件，需要审批或完全访问权限",
    source: "builtin",
    insertText: "/write "
  },
  {
    id: "builtin:/shell",
    name: "/shell",
    kind: "builtin_tool",
    description: "在当前项目目录执行 shell 命令，需要审批或完全访问权限",
    source: "builtin",
    insertText: "/shell "
  },
  {
    id: "builtin:/git status",
    name: "/git status",
    kind: "builtin_tool",
    description: "查看当前项目 Git 状态",
    source: "builtin",
    insertText: "/git status"
  },
  {
    id: "builtin:/git diff",
    name: "/git diff",
    kind: "builtin_tool",
    description: "查看当前项目 Git 变更摘要和 diff 检查",
    source: "builtin",
    insertText: "/git diff"
  },
  {
    id: "builtin:/compact",
    name: "/compact",
    kind: "builtin_tool",
    description: "压缩对话上下文：将较早的历史总结为摘要，节省 token",
    source: "builtin",
    insertText: "/compact"
  }
];

export interface SlashCommandServiceOptions {
  /** 随应用分发的市场技能目录；默认 builtin 根旁的 skills-market。 */
  marketRoot?: string;
  /** 已激活市场技能名集合；未注入时市场技能一律不加载。 */
  enabledMarketSkills?: () => Promise<Set<string>>;
}

export class SlashCommandService {
  private readonly marketRoot: string;
  private readonly enabledMarketSkills?: () => Promise<Set<string>>;

  constructor(
    private readonly globalRoot = join(homedir(), ".chengxiaobang"),
    private readonly builtinRoot = builtinResourceRoot(),
    options: SlashCommandServiceOptions = {}
  ) {
    this.marketRoot = options.marketRoot ?? join(builtinResourceRoot(), "skills-market");
    this.enabledMarketSkills = options.enabledMarketSkills;
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
    const resource = findResource(resources, parsed.name);
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
   * 模型可自主发现的技能清单（§5.3）：仅 name+description（正文经 use_skill 按需拉取），
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
      const env = new NodeExecutionEnv({ cwd: source.root });
      const promptResult = await loadPromptTemplates(env, [join(source.root, "prompts")]);
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

      const skillResult = await loadSkills(env, [join(source.root, "skills")]);
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
      await env.cleanup();
    }
    resources.push(...(await this.loadMarketSkills(diagnostics)));
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
    const env = new NodeExecutionEnv({ cwd: this.marketRoot });
    try {
      const skillResult = await loadSkills(env, [this.marketRoot]);
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
    } finally {
      await env.cleanup();
    }
  }
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
      resource.skill.disableModelInvocation !== true
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
    id: `${resource.source}:${resource.kind}:${rawName}`,
    name,
    kind: resource.kind,
    description: resource.template?.description ?? resource.skill?.description ?? "",
    source: resource.source,
    insertText: `${name} `
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
    return 3;
  }
  if (source === "global") {
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
