import { lstat, mkdir, readFile, readdir, realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, posix, relative, resolve, sep, win32 } from "node:path";
import type { ProjectFileEntry } from "@chengxiaobang/shared";

import { getLogger } from "../logging/logger";

const log = getLogger({ module: "tools/workspace" });

/** Build-output and dependency dirs that file walks always skip. */
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

interface PathTools {
  resolve(...paths: string[]): string;
  isAbsolute(path: string): boolean;
  sep: string;
}

function pathToolsFor(platform: NodeJS.Platform = process.platform): PathTools {
  return platform === "win32" ? win32 : posix;
}

function normalizeForContainment(path: string, platform: NodeJS.Platform): string {
  const trimmed = path.replace(/[\\/]+$/u, "");
  return platform === "win32" ? trimmed.toLowerCase() : trimmed;
}

/** 判断 target 是否等于 base 或位于 base 之下；Windows 文件系统路径按大小写不敏感处理。 */
export function isSameOrChildPath(
  basePath: string,
  targetPath: string,
  platform: NodeJS.Platform = process.platform
): boolean {
  const tools = pathToolsFor(platform);
  const base = normalizeForContainment(tools.resolve(basePath), platform);
  const target = normalizeForContainment(tools.resolve(targetPath), platform);
  return target === base || target.startsWith(`${base}${tools.sep}`);
}

/** 解析工作区相对路径，并拒绝越界访问。 */
export function safeResolve(
  basePath: string,
  targetPath: string,
  platform: NodeJS.Platform = process.platform
): string {
  const tools = pathToolsFor(platform);
  const base = tools.resolve(basePath);
  const target = tools.resolve(base, targetPath);
  if (!isSameOrChildPath(base, target, platform)) {
    throw new Error("路径超出当前项目范围");
  }
  return target;
}

export interface ToolPathResolution {
  target: string;
  outsideWorkspace: boolean;
}

export function isPathOutsideWorkspace(
  basePath: string,
  targetPath: string,
  platform: NodeJS.Platform = process.platform
): boolean {
  const tools = pathToolsFor(platform);
  const base = tools.resolve(basePath);
  const target = tools.isAbsolute(targetPath)
    ? tools.resolve(targetPath)
    : tools.resolve(base, targetPath);
  return !isSameOrChildPath(base, target, platform);
}

/** 解析工具路径：相对路径仍限定在工作目录内，显式绝对路径允许操作。 */
export function resolveToolPath(
  basePath: string,
  targetPath: string,
  platform: NodeJS.Platform = process.platform
): ToolPathResolution {
  const tools = pathToolsFor(platform);
  const base = tools.resolve(basePath);
  if (tools.isAbsolute(targetPath)) {
    const target = tools.resolve(targetPath);
    return {
      target,
      outsideWorkspace: isPathOutsideWorkspace(base, target, platform)
    };
  }
  try {
    return { target: safeResolve(base, targetPath, platform), outsideWorkspace: false };
  } catch (error) {
    log.warn("[workspace] 拒绝越界的相对工具路径", { basePath: base, targetPath });
    throw error;
  }
}

export async function resolveExistingWorkspacePath(
  basePath: string,
  targetPath: string
): Promise<string> {
  const base = await realpath(resolve(basePath));
  if (isAbsolute(targetPath)) {
    log.warn("[workspace] 拒绝工具访问显式绝对路径", { basePath: base, targetPath });
    throw new Error("路径超出当前项目范围");
  }
  const target = safeResolve(base, targetPath);
  const resolvedTarget = await realpath(target);
  if (!isSameOrChildPath(base, resolvedTarget)) {
    log.warn("[workspace] 拒绝访问真实路径超出工作目录的目标", {
      basePath: base,
      targetPath,
      resolvedTarget
    });
    throw new Error("路径超出当前项目范围");
  }
  return resolvedTarget;
}

export async function resolveWritableWorkspacePath(
  basePath: string,
  targetPath: string,
  options: { createParentDirs?: boolean } = {}
): Promise<string> {
  const base = await realpath(resolve(basePath));
  if (isAbsolute(targetPath)) {
    log.warn("[workspace] 拒绝工具写入显式绝对路径", { basePath: base, targetPath });
    throw new Error("路径超出当前项目范围");
  }
  const target = safeResolve(base, targetPath);
  const parent = dirname(target);
  await assertNearestExistingAncestorInside(base, parent);
  if (options.createParentDirs) {
    await mkdir(parent, { recursive: true });
  }
  try {
    const resolvedTarget = await realpath(target);
    if (!isSameOrChildPath(base, resolvedTarget)) {
      log.warn("[workspace] 拒绝写入真实路径超出工作目录的目标", {
        basePath: base,
        targetPath,
        resolvedTarget
      });
      throw new Error("路径超出当前项目范围");
    }
  } catch (error) {
    if (!isMissingPathError(error)) {
      throw error;
    }
  }
  const resolvedParent = await realpath(parent);
  if (!isSameOrChildPath(base, resolvedParent)) {
    log.warn("[workspace] 拒绝写入真实父目录超出工作目录的目标", {
      basePath: base,
      targetPath,
      resolvedParent
    });
    throw new Error("路径超出当前项目范围");
  }
  return target;
}

export async function createWorkspaceDirectory(
  basePath: string,
  targetPath: string
): Promise<string> {
  const base = await realpath(resolve(basePath));
  if (isAbsolute(targetPath)) {
    log.warn("[workspace] 拒绝工具创建显式绝对路径目录", { basePath: base, targetPath });
    throw new Error("路径超出当前项目范围");
  }
  const target = safeResolve(base, targetPath);
  await assertNearestExistingAncestorInside(base, target);
  await mkdir(target, { recursive: true });
  const resolvedTarget = await realpath(target);
  if (!isSameOrChildPath(base, resolvedTarget)) {
    log.warn("[workspace] 拒绝创建真实路径超出工作目录的目录", {
      basePath: base,
      targetPath,
      resolvedTarget
    });
    throw new Error("路径超出当前项目范围");
  }
  return target;
}

async function assertNearestExistingAncestorInside(base: string, target: string): Promise<void> {
  let current = target;
  for (;;) {
    try {
      await lstat(current);
      const resolved = await realpath(current);
      if (!isSameOrChildPath(base, resolved)) {
        log.warn("[workspace] 拒绝穿过真实路径超出工作目录的父级", {
          basePath: base,
          target,
          ancestor: current,
          resolved
        });
        throw new Error("路径超出当前项目范围");
      }
      return;
    } catch (error) {
      if (!isMissingPathError(error)) {
        throw error;
      }
      const next = dirname(current);
      if (next === current) {
        throw error;
      }
      current = next;
    }
  }
}

function isMissingPathError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    ((error as NodeJS.ErrnoException).code === "ENOENT" ||
      (error as NodeJS.ErrnoException).code === "ENOTDIR")
  );
}

/**
 * Relative project file paths for the composer's @-mention autocomplete.
 * Case-insensitive substring match on the posix-style relative path;
 * basename-prefix matches rank first, then shorter paths.
 */
export async function listProjectFiles(
  basePath: string,
  query: string,
  limit = 50
): Promise<string[]> {
  const root = await realpath(resolve(basePath));
  const needle = query.trim().toLowerCase();
  const cappedLimit = Math.max(1, Math.min(limit, 200));
  const files: string[] = [];
  await walkFiles(
    root,
    root,
    (absolutePath) => {
      files.push(relative(root, absolutePath).split(sep).join("/"));
    },
    { count: 10_000 }
  );
  const matches = needle
    ? files.filter((file) => file.toLowerCase().includes(needle))
    : files;
  const rank = (file: string) =>
    needle && basename(file).toLowerCase().startsWith(needle) ? 0 : 1;
  return matches
    .sort((left, right) => {
      const byRank = rank(left) - rank(right);
      if (byRank !== 0) {
        return byRank;
      }
      if (left.length !== right.length) {
        return left.length - right.length;
      }
      return left.localeCompare(right);
    })
    .slice(0, cappedLimit);
}

/** Direct children for the project file tree. Directories are listed before files. */
export async function listProjectDirectoryEntries(
  basePath: string,
  directory = "."
): Promise<ProjectFileEntry[]> {
  const root = await realpath(resolve(basePath));
  const current = await resolveExistingWorkspacePath(root, directory || ".");
  const info = await stat(current);
  if (!info.isDirectory()) {
    throw new Error("路径不是目录");
  }
  const entries = await readdir(current, { withFileTypes: true });
  return entries
    .filter((entry) => {
      if (entry.isDirectory()) {
        return !IGNORED_DIRS.has(entry.name);
      }
      return entry.isFile();
    })
    .map((entry) => {
      const absolutePath = join(current, entry.name);
      return {
        name: entry.name,
        path: relative(root, absolutePath).split(sep).join("/"),
        type: entry.isDirectory() ? "directory" as const : "file" as const
      };
    })
    .sort((left, right) => {
      if (left.type !== right.type) {
        return left.type === "directory" ? -1 : 1;
      }
      return left.name.localeCompare(right.name);
    });
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

export async function globFiles(basePath: string, pattern: string): Promise<string> {
  const root = await realpath(resolve(basePath));
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

export async function searchFiles(
  basePath: string,
  scope: string,
  query: string
): Promise<string> {
  const root = await realpath(resolve(basePath));
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
