import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { PromptTemplate } from "@earendil-works/pi-agent-core/node";

/**
 * 一条插件命令：template 复用 pi 的 PromptTemplate 形状（{name, description, content}），
 * 这样上层可直接用 formatPromptTemplateInvocation 做 `$1/$@/$ARGUMENTS` 替换；
 * argumentHint 是命令面板展示用的额外元数据（pi 的 PromptTemplate 不带这个字段）。
 */
export interface PluginCommand {
  template: PromptTemplate;
  argumentHint?: string;
}

interface PluginCommandMeta {
  name?: string;
  description?: string;
  argumentHint?: string;
  body: string;
}

/**
 * 解析插件 `commands/` 目录下的 *.md（非递归）。
 * Claude Code 命令以文件名为命令名（frontmatter 可覆盖 name），frontmatter 取 description/argument-hint，
 * 去掉 frontmatter 的正文作为模板内容。目录缺失返回空。
 */
export async function loadPluginCommands(root: string): Promise<PluginCommand[]> {
  const dir = join(root, "commands");
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const commands: PluginCommand[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) {
      continue;
    }
    const filePath = join(dir, entry.name);
    let raw: string;
    try {
      raw = await readFile(filePath, "utf8");
    } catch (error) {
      console.warn(`[plugin] 读取插件命令失败 path=${filePath}: ${String(error)}`);
      continue;
    }
    const meta = parsePluginCommandFile(raw);
    const name = meta.name ?? entry.name.replace(/\.md$/, "");
    if (!name) {
      continue;
    }
    commands.push({
      template: { name, description: meta.description ?? "", content: meta.body },
      argumentHint: meta.argumentHint
    });
  }
  return commands.sort((a, b) => a.template.name.localeCompare(b.template.name));
}

/** 轻量 frontmatter 解析：取 name/description/argument-hint，正文为去掉 frontmatter 的剩余内容。 */
function parsePluginCommandFile(content: string): PluginCommandMeta {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) {
    return { body: content.replace(/^\s+/, "") };
  }
  let name: string | undefined;
  let description: string | undefined;
  let argumentHint: string | undefined;
  for (const line of match[1].split(/\r?\n/)) {
    const field = line.match(/^(name|description|argument-hint):\s*(.+)$/);
    if (!field) {
      continue;
    }
    const value = unquote(field[2]);
    if (field[1] === "name") {
      name = value;
    } else if (field[1] === "description") {
      description = value;
    } else {
      argumentHint = value;
    }
  }
  return { name, description, argumentHint, body: content.slice(match[0].length).replace(/^\s+/, "") };
}

function unquote(value: string): string {
  const trimmed = value.trim();
  const quoted = trimmed.match(/^"(.*)"$|^'(.*)'$/);
  return (quoted?.[1] ?? quoted?.[2] ?? trimmed).trim();
}
