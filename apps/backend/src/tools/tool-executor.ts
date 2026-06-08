import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { nowIso, type ToolCall, type ToolName } from "@chengxiaobang/shared";
import { buildPptx, type DeckSpec } from "./pptx-builder";
import { buildDocx, type DocSpec } from "./docx-builder";
import { buildXlsx, type WorkbookSpec } from "./xlsx-builder";
import { requiresApproval } from "./tool-schemas";

export { requiresApproval } from "./tool-schemas";

export interface ToolRequest {
  name: ToolName;
  args: Record<string, unknown>;
}

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  "out",
  ".cache",
  ".turbo"
]);
const MAX_SEARCH_RESULTS = 200;
const MAX_GLOB_RESULTS = 500;

export function parseToolRequest(prompt: string): ToolRequest | undefined {
  const trimmed = prompt.trim();
  if (trimmed.startsWith("/ls")) {
    return { name: "list_directory", args: { path: trimmed.slice(3).trim() || "." } };
  }
  if (trimmed.startsWith("/read ")) {
    return { name: "read_file", args: { path: trimmed.slice(6).trim() } };
  }
  if (trimmed.startsWith("/write ")) {
    const [, targetAndContent = ""] = trimmed.split("/write ");
    const [target, ...contentLines] = targetAndContent.split("\n");
    return {
      name: "write_file",
      args: { path: target.trim(), content: contentLines.join("\n") }
    };
  }
  if (trimmed.startsWith("/shell ")) {
    return { name: "shell", args: { command: trimmed.slice(7).trim() } };
  }
  if (trimmed === "/git status") {
    return { name: "git_status", args: {} };
  }
  if (trimmed === "/git diff") {
    return { name: "git_diff", args: {} };
  }
  return undefined;
}

export class ToolExecutor {
  async execute(toolCall: ToolCall, basePath: string): Promise<ToolCall> {
    const result = await this.runTool(toolCall.name, toolCall.args, basePath);
    return {
      ...toolCall,
      status: "completed",
      result,
      updatedAt: nowIso()
    };
  }

  private async runTool(
    name: ToolName,
    args: Record<string, unknown>,
    basePath: string
  ): Promise<string> {
    if (name === "list_directory") {
      const target = safeResolve(basePath, stringArg(args.path, "."));
      const entries = await readdir(target, { withFileTypes: true });
      if (entries.length === 0) {
        return "（空目录）";
      }
      return entries
        .map((entry) => `${entry.isDirectory() ? "dir " : "file"} ${entry.name}`)
        .join("\n");
    }
    if (name === "read_file") {
      const target = safeResolve(basePath, stringArg(args.path));
      return readFile(target, "utf8");
    }
    if (name === "write_file") {
      const target = safeResolve(basePath, stringArg(args.path));
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, stringArg(args.content, ""), "utf8");
      return `已写入 ${target}`;
    }
    if (name === "edit_file") {
      const target = safeResolve(basePath, stringArg(args.path));
      const oldText = stringArg(args.oldText);
      const newText = stringArg(args.newText, "");
      const source = await readFile(target, "utf8");
      if (!source.includes(oldText)) {
        throw new Error("没有找到要替换的内容");
      }
      await writeFile(target, source.replace(oldText, newText), "utf8");
      return `已编辑 ${target}`;
    }
    if (name === "make_directory") {
      const target = safeResolve(basePath, stringArg(args.path));
      await mkdir(target, { recursive: true });
      return `已创建目录 ${target}`;
    }
    if (name === "glob") {
      return globFiles(basePath, stringArg(args.pattern));
    }
    if (name === "search") {
      const scope = typeof args.path === "string" && args.path ? args.path : ".";
      return searchFiles(basePath, safeResolve(basePath, scope), stringArg(args.query));
    }
    if (name === "fetch_url") {
      return fetchUrl(stringArg(args.url));
    }
    if (name === "git_status") {
      return runShell("git status --short --branch", basePath);
    }
    if (name === "git_diff") {
      return runShell("git diff --stat && git diff --check", basePath);
    }
    if (name === "shell") {
      return runShell(stringArg(args.command), basePath);
    }
    if (name === "create_pptx") {
      const target = ensureExtension(safeResolve(basePath, stringArg(args.path)), ".pptx");
      const deck = (args.deck ?? {}) as DeckSpec;
      const buffer = await buildPptx(deck);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, buffer);
      return `已生成演示文稿 ${target}（共 ${deck.slides?.length ?? 1} 页）`;
    }
    if (name === "create_docx") {
      const target = ensureExtension(safeResolve(basePath, stringArg(args.path)), ".docx");
      const document = (args.document ?? {}) as DocSpec;
      const buffer = await buildDocx(document);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, buffer);
      return `已生成 Word 文档 ${target}`;
    }
    if (name === "create_xlsx") {
      const target = ensureExtension(safeResolve(basePath, stringArg(args.path)), ".xlsx");
      const workbook = (args.workbook ?? {}) as WorkbookSpec;
      const buffer = await buildXlsx(workbook);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, buffer);
      return `已生成 Excel 表格 ${target}（${workbook.sheets?.length ?? 1} 个工作表）`;
    }
    throw new Error(`未知工具: ${name satisfies never}`);
  }
}

function ensureExtension(target: string, ext: string): string {
  return target.toLowerCase().endsWith(ext) ? target : `${target}${ext}`;
}

function stringArg(value: unknown, fallback?: string): string {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  if (fallback !== undefined) {
    return fallback;
  }
  throw new Error("缺少工具参数");
}

function safeResolve(basePath: string, targetPath: string): string {
  const base = resolve(basePath);
  const target = resolve(base, targetPath);
  if (target !== base && !target.startsWith(`${base}${sep}`)) {
    throw new Error("路径超出当前项目范围");
  }
  return target;
}

async function walkFiles(
  root: string,
  current: string,
  onFile: (absolutePath: string) => void,
  budget: { count: number }
): Promise<void> {
  if (budget.count <= 0) {
    return;
  }
  let entries;
  try {
    entries = await readdir(current, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (budget.count <= 0) {
      return;
    }
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) {
        continue;
      }
      await walkFiles(root, join(current, entry.name), onFile, budget);
    } else if (entry.isFile()) {
      onFile(join(current, entry.name));
      budget.count -= 1;
    }
  }
}

function globToRegExp(pattern: string): RegExp {
  let regex = "";
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];
    if (char === "*") {
      if (pattern[i + 1] === "*") {
        regex += ".*";
        i += 1;
        if (pattern[i + 1] === "/") {
          i += 1;
        }
      } else {
        regex += "[^/]*";
      }
    } else if (char === "?") {
      regex += "[^/]";
    } else if (".+^${}()|[]\\".includes(char)) {
      regex += `\\${char}`;
    } else {
      regex += char;
    }
  }
  return new RegExp(`^${regex}$`);
}

async function globFiles(basePath: string, pattern: string): Promise<string> {
  const root = resolve(basePath);
  const matcher = globToRegExp(pattern);
  const matches: string[] = [];
  const budget = { count: MAX_GLOB_RESULTS * 8 };
  await walkFiles(root, root, (absolutePath) => {
    const rel = relative(root, absolutePath).split(sep).join("/");
    if (matcher.test(rel) && matches.length < MAX_GLOB_RESULTS) {
      matches.push(rel);
    }
  }, budget);
  if (matches.length === 0) {
    return `没有匹配 ${pattern} 的文件`;
  }
  return matches.sort().join("\n");
}

function looksBinary(sample: Buffer): boolean {
  const slice = sample.subarray(0, 4096);
  for (const byte of slice) {
    if (byte === 0) {
      return true;
    }
  }
  return false;
}

async function searchFiles(
  basePath: string,
  scope: string,
  query: string
): Promise<string> {
  const root = resolve(basePath);
  const needle = query.toLowerCase();
  const results: string[] = [];
  const budget = { count: 20_000 };
  const files: string[] = [];
  await walkFiles(root, scope, (absolutePath) => files.push(absolutePath), budget);
  for (const file of files) {
    if (results.length >= MAX_SEARCH_RESULTS) {
      break;
    }
    let buffer: Buffer;
    try {
      const info = await stat(file);
      if (info.size > 1_000_000) {
        continue;
      }
      buffer = await readFile(file);
    } catch {
      continue;
    }
    if (looksBinary(buffer)) {
      continue;
    }
    const rel = relative(root, file).split(sep).join("/");
    const lines = buffer.toString("utf8").split("\n");
    for (let i = 0; i < lines.length; i += 1) {
      if (lines[i].toLowerCase().includes(needle)) {
        results.push(`${rel}:${i + 1}: ${lines[i].trim().slice(0, 200)}`);
        if (results.length >= MAX_SEARCH_RESULTS) {
          break;
        }
      }
    }
  }
  if (results.length === 0) {
    return `没有找到包含 "${query}" 的内容`;
  }
  return results.join("\n");
}

const MAX_FETCH_CHARS = 20_000;

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function fetchUrl(url: string): Promise<string> {
  if (!/^https?:\/\//i.test(url)) {
    throw new Error("仅支持 http(s) 地址");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "chengxiaobang/0.1 (+local-agent)" }
    });
    if (!response.ok) {
      throw new Error(`请求失败 ${response.status} ${response.statusText}`);
    }
    const contentType = response.headers.get("content-type") ?? "";
    const raw = await response.text();
    const text = /html/i.test(contentType) ? htmlToText(raw) : raw.trim();
    return text.length > MAX_FETCH_CHARS
      ? `${text.slice(0, MAX_FETCH_CHARS)}\n…（内容已截断，共 ${text.length} 字）`
      : text || "（无内容）";
  } finally {
    clearTimeout(timeout);
  }
}

async function runShell(command: string, cwd: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.env.SHELL ?? "/bin/zsh", ["-lc", command], {
      cwd,
      env: process.env
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("命令执行超时"));
    }, 120_000);

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      const output = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");
      if (code === 0) {
        resolvePromise(output || "（命令无输出）");
      } else {
        reject(new Error(output || `命令退出码 ${code}`));
      }
    });
  });
}
