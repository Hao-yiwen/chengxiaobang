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

export interface SlashCommandLookup {
  prompt: string;
  matched: boolean;
}

interface LoadedResource {
  kind: "prompt_template" | "skill";
  source: Extract<SlashCommandSource, "global" | "project">;
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
  }
];

export class SlashCommandService {
  constructor(private readonly globalRoot = join(homedir(), ".chengxiaobang")) {}

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

  private async loadResources(
    project: Project | undefined,
    diagnostics: SlashCommandDiagnostic[]
  ): Promise<LoadedResource[]> {
    const resources: LoadedResource[] = [];
    for (const source of resourceSources(this.globalRoot, project)) {
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
    return resources;
  }
}

function resourceSources(globalRoot: string, project: Project | undefined): Array<{
  name: Extract<SlashCommandSource, "global" | "project">;
  root: string;
}> {
  const sources: Array<{
    name: Extract<SlashCommandSource, "global" | "project">;
    root: string;
  }> = [{ name: "global", root: globalRoot }];
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
    return 2;
  }
  if (source === "global") {
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
