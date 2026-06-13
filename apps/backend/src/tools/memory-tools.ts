import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { textResult } from "./tool-result";

/** 模型可见的记忆虚拟根目录，对齐 Anthropic memory tool 的 /memories 约定。 */
export const MEMORY_ROOT = "/memories";

/** 单个记忆文件 view 输出的字符上限，超出截断并提示用 view_range 分段读取。 */
const MAX_VIEW_CHARS = 32 * 1024;
/** 目录快照最多列出的条目数，防止记忆目录失控时撑爆系统提示。 */
const MAX_LISTING_ENTRIES = 50;

const memoryParams = Type.Object({
  command: Type.Union(
    [
      Type.Literal("view"),
      Type.Literal("create"),
      Type.Literal("str_replace"),
      Type.Literal("insert"),
      Type.Literal("delete"),
      Type.Literal("rename")
    ],
    { description: "要执行的记忆操作" }
  ),
  path: Type.Optional(
    Type.String({ description: "目标路径，必须以 /memories 开头，如 /memories/notes.md" })
  ),
  file_text: Type.Optional(Type.String({ description: "create：要写入的完整文件内容" })),
  view_range: Type.Optional(
    Type.Array(Type.Number(), {
      description: "view：可选的 [起始行, 结束行]（1 起始，含端点），只看文件的一段"
    })
  ),
  old_str: Type.Optional(Type.String({ description: "str_replace：要被替换的原文（需在文件中唯一）" })),
  new_str: Type.Optional(Type.String({ description: "str_replace：替换后的新文本" })),
  insert_line: Type.Optional(
    Type.Number({ description: "insert：插入位置的行号（0 表示文件开头）" })
  ),
  insert_text: Type.Optional(Type.String({ description: "insert：要插入的文本" })),
  old_path: Type.Optional(Type.String({ description: "rename：原路径" })),
  new_path: Type.Optional(Type.String({ description: "rename：新路径" }))
});

type MemoryParams = {
  command: "view" | "create" | "str_replace" | "insert" | "delete" | "rename";
  path?: string;
  file_text?: string;
  view_range?: number[];
  old_str?: string;
  new_str?: string;
  insert_line?: number;
  insert_text?: string;
  old_path?: string;
  new_path?: string;
};

/**
 * 把 /memories 虚拟路径解析为 memoryDir 下的真实路径。
 * 必须以 /memories 开头，且解析后不得逃出 memoryDir（防路径穿越）。
 */
export function resolveMemoryPath(memoryDir: string, virtualPath: string): string {
  const normalized = virtualPath.trim();
  if (normalized !== MEMORY_ROOT && !normalized.startsWith(`${MEMORY_ROOT}/`)) {
    throw new Error(`路径必须以 ${MEMORY_ROOT} 开头，收到：${virtualPath}`);
  }
  const base = resolve(memoryDir);
  const target = resolve(base, `.${normalized.slice(MEMORY_ROOT.length)}`);
  if (target !== base && !target.startsWith(`${base}${sep}`)) {
    console.warn(`[memory-tools] 拒绝越界的记忆路径 path=${virtualPath}`);
    throw new Error(`路径越出了 ${MEMORY_ROOT} 目录范围：${virtualPath}`);
  }
  return target;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes}B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)}K`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
}

/**
 * 记忆目录最多两层的清单（大小 + 虚拟路径），跳过隐藏文件。
 * 目录为空或不存在时返回 undefined；同时供 memory view 和系统提示快照使用。
 */
export async function renderMemoryListing(
  memoryDir: string,
  virtualRoot: string = MEMORY_ROOT
): Promise<string | undefined> {
  const lines: string[] = [];
  const walk = async (realDir: string, virtualDir: string, depth: number): Promise<void> => {
    let entries;
    try {
      entries = await readdir(realDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith(".") || lines.length >= MAX_LISTING_ENTRIES) {
        continue;
      }
      const realPath = join(realDir, entry.name);
      const virtualPath = `${virtualDir}/${entry.name}`;
      if (entry.isDirectory()) {
        lines.push(`dir\t${virtualPath}/`);
        if (depth < 2) {
          await walk(realPath, virtualPath, depth + 1);
        }
      } else if (entry.isFile()) {
        const info = await stat(realPath).catch(() => undefined);
        lines.push(`${info ? formatSize(info.size) : "?"}\t${virtualPath}`);
      }
    }
  };
  await walk(memoryDir, virtualRoot, 1);
  if (lines.length >= MAX_LISTING_ENTRIES) {
    lines.push(`（条目过多已截断，完整列表请用 memory view 查看子目录）`);
  }
  return lines.length > 0 ? lines.join("\n") : undefined;
}

function requireParam<T>(value: T | undefined, name: string, command: string): T {
  if (value === undefined) {
    throw new Error(`${command} 命令缺少必需参数 ${name}`);
  }
  return value;
}

async function statOrUndefined(path: string) {
  return stat(path).catch(() => undefined);
}

/** 带行号渲染文件内容：6 位右对齐行号 + 制表符，与 Anthropic 规范一致。 */
function withLineNumbers(lines: string[], startLine: number): string {
  return lines
    .map((line, index) => `${String(startLine + index).padStart(6, " ")}\t${line}`)
    .join("\n");
}

async function viewCommand(memoryDir: string, params: MemoryParams): Promise<string> {
  const virtualPath = params.path ?? MEMORY_ROOT;
  const target = resolveMemoryPath(memoryDir, virtualPath);
  const info = await statOrUndefined(target);
  if (!info) {
    if (virtualPath === MEMORY_ROOT) {
      return "（记忆目录为空）";
    }
    throw new Error(`路径 ${virtualPath} 不存在`);
  }
  if (info.isDirectory()) {
    const listing = await renderMemoryListing(target, virtualPath.replace(/\/+$/, ""));
    return listing ?? `（${virtualPath} 目录为空）`;
  }
  const content = await readFile(target, "utf8");
  const lines = content.split("\n");
  let startLine = 1;
  let selected = lines;
  if (params.view_range) {
    const [start, end] = params.view_range;
    if (
      params.view_range.length !== 2 ||
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 1 ||
      end < start
    ) {
      throw new Error(`view_range 不合法：应为 [起始行, 结束行] 且 1 <= 起始行 <= 结束行`);
    }
    startLine = start;
    selected = lines.slice(start - 1, end);
  }
  let rendered = withLineNumbers(selected, startLine);
  if (rendered.length > MAX_VIEW_CHARS) {
    rendered = `${rendered.slice(0, MAX_VIEW_CHARS)}\n（内容过长已截断，请用 view_range 分段读取）`;
  }
  return `${virtualPath} 的内容（带行号）：\n${rendered}`;
}

async function createCommand(memoryDir: string, params: MemoryParams): Promise<string> {
  const virtualPath = requireParam(params.path, "path", "create");
  const fileText = requireParam(params.file_text, "file_text", "create");
  const target = resolveMemoryPath(memoryDir, virtualPath);
  if (await statOrUndefined(target)) {
    throw new Error(`文件 ${virtualPath} 已存在；修改请用 str_replace，重写请先 delete 再 create`);
  }
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, fileText, "utf8");
  console.info(`[memory-tools] 已创建记忆文件 path=${virtualPath} chars=${fileText.length}`);
  return `已创建记忆文件 ${virtualPath}`;
}

async function strReplaceCommand(memoryDir: string, params: MemoryParams): Promise<string> {
  const virtualPath = requireParam(params.path, "path", "str_replace");
  const oldStr = requireParam(params.old_str, "old_str", "str_replace");
  const newStr = params.new_str ?? "";
  const target = resolveMemoryPath(memoryDir, virtualPath);
  const info = await statOrUndefined(target);
  if (!info || !info.isFile()) {
    throw new Error(`路径 ${virtualPath} 不存在或不是文件`);
  }
  const content = await readFile(target, "utf8");
  const occurrences = content.split(oldStr).length - 1;
  if (occurrences === 0) {
    throw new Error(`没有替换：old_str 没有在 ${virtualPath} 中逐字出现`);
  }
  if (occurrences > 1) {
    const matchedLines = content
      .split("\n")
      .map((line, index) => (line.includes(oldStr) ? index + 1 : 0))
      .filter((line) => line > 0);
    throw new Error(
      `没有替换：old_str 在 ${virtualPath} 中出现了 ${occurrences} 次（行 ${matchedLines.join(", ")}），请提供唯一片段`
    );
  }
  await writeFile(target, content.replace(oldStr, newStr), "utf8");
  console.info(`[memory-tools] 已编辑记忆文件 path=${virtualPath}`);
  return `已更新记忆文件 ${virtualPath}`;
}

async function insertCommand(memoryDir: string, params: MemoryParams): Promise<string> {
  const virtualPath = requireParam(params.path, "path", "insert");
  const insertLine = requireParam(params.insert_line, "insert_line", "insert");
  const insertText = requireParam(params.insert_text, "insert_text", "insert");
  const target = resolveMemoryPath(memoryDir, virtualPath);
  const info = await statOrUndefined(target);
  if (!info || !info.isFile()) {
    throw new Error(`路径 ${virtualPath} 不存在或不是文件`);
  }
  const lines = (await readFile(target, "utf8")).split("\n");
  if (!Number.isInteger(insertLine) || insertLine < 0 || insertLine > lines.length) {
    throw new Error(`insert_line 不合法：${insertLine}，应在 [0, ${lines.length}] 范围内`);
  }
  lines.splice(insertLine, 0, ...insertText.replace(/\n$/, "").split("\n"));
  await writeFile(target, lines.join("\n"), "utf8");
  console.info(`[memory-tools] 已向记忆文件插入内容 path=${virtualPath} line=${insertLine}`);
  return `已向 ${virtualPath} 第 ${insertLine} 行后插入内容`;
}

async function deleteCommand(memoryDir: string, params: MemoryParams): Promise<string> {
  const virtualPath = requireParam(params.path, "path", "delete");
  if (virtualPath.trim() === MEMORY_ROOT) {
    throw new Error(`不能删除记忆根目录 ${MEMORY_ROOT}`);
  }
  const target = resolveMemoryPath(memoryDir, virtualPath);
  if (!(await statOrUndefined(target))) {
    throw new Error(`路径 ${virtualPath} 不存在`);
  }
  await rm(target, { recursive: true });
  console.info(`[memory-tools] 已删除记忆 path=${virtualPath}`);
  return `已删除 ${virtualPath}`;
}

async function renameCommand(memoryDir: string, params: MemoryParams): Promise<string> {
  const oldVirtual = requireParam(params.old_path, "old_path", "rename");
  const newVirtual = requireParam(params.new_path, "new_path", "rename");
  const source = resolveMemoryPath(memoryDir, oldVirtual);
  const destination = resolveMemoryPath(memoryDir, newVirtual);
  if (!(await statOrUndefined(source))) {
    throw new Error(`路径 ${oldVirtual} 不存在`);
  }
  if (await statOrUndefined(destination)) {
    throw new Error(`目标 ${newVirtual} 已存在，不能覆盖`);
  }
  await mkdir(dirname(destination), { recursive: true });
  await rename(source, destination);
  console.info(`[memory-tools] 已重命名记忆 from=${oldVirtual} to=${newVirtual}`);
  return `已把 ${oldVirtual} 重命名为 ${newVirtual}`;
}

/** 跨会话长期记忆工具：六个命令读写 memoryDir 映射的 /memories 目录。 */
export function createMemoryTools(memoryDir: string): AgentTool<any>[] {
  const memoryTool: AgentTool<typeof memoryParams> = {
    name: "memory",
    label: "长期记忆",
    description:
      "读写你的跨会话长期记忆（/memories 目录）。command：view 查看目录或文件（可带 view_range）、create 新建文件（path + file_text）、str_replace 精确替换（path + old_str + new_str）、insert 按行插入（path + insert_line + insert_text）、delete 删除文件或目录（path）、rename 重命名或移动（old_path + new_path）。",
    parameters: memoryParams,
    execute: async (_id, params) => {
      const input = params as MemoryParams;
      switch (input.command) {
        case "view":
          return textResult(await viewCommand(memoryDir, input));
        case "create":
          return textResult(await createCommand(memoryDir, input));
        case "str_replace":
          return textResult(await strReplaceCommand(memoryDir, input));
        case "insert":
          return textResult(await insertCommand(memoryDir, input));
        case "delete":
          return textResult(await deleteCommand(memoryDir, input));
        case "rename":
          return textResult(await renameCommand(memoryDir, input));
        default:
          throw new Error(`未知的记忆命令: ${String(input.command)}`);
      }
    }
  };
  return [memoryTool];
}
