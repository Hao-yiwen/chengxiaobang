import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, extname } from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { Type } from "@earendil-works/pi-ai";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { globFiles, resolveToolPath, type ToolPathResolution } from "./workspace";
import { buildToolFileChangeDetails, type ToolFileChangeDetails } from "./file-change";
import { textResult } from "./tool-result";

const lsParams = Type.Object({
  path: Type.Optional(
    Type.String({ description: "相对工作目录的路径，或显式绝对路径；默认当前目录 '.'" })
  )
});

const readParams = Type.Object({
  file_path: Type.String({ description: "相对工作目录的文件路径，或显式绝对路径" }),
  offset: Type.Optional(Type.Number({ description: "可选，起始行号，1 表示第一行" })),
  limit: Type.Optional(Type.Number({ description: "可选，最多读取多少行；默认和上限均为 2000" }))
});

const writeParams = Type.Object({
  file_path: Type.String({ description: "相对工作目录的文件路径，或显式绝对路径；请优先生成该字段" }),
  content: Type.String({ description: "要写入的完整文本内容" })
});

const editParams = Type.Object({
  file_path: Type.String({ description: "相对工作目录的文件路径，或显式绝对路径；请优先生成该字段" }),
  old_string: Type.String({ description: "需要被替换的原文，必须逐字精确匹配" }),
  new_string: Type.String({ description: "替换后的新文本" }),
  replace_all: Type.Optional(Type.Boolean({ description: "默认 false；true 时替换所有匹配" }))
});

const makeDirectoryParams = Type.Object({
  path: Type.String({ description: "相对工作目录的目录路径，或显式绝对路径" })
});

const globParams = Type.Object({
  pattern: Type.String({ description: "glob 通配符" }),
  path: Type.Optional(
    Type.String({ description: "可选，限定扫描根目录；可为相对工作目录路径或显式绝对路径" })
  )
});

const grepParams = Type.Object({
  pattern: Type.String({ description: "ripgrep 搜索表达式" }),
  path: Type.Optional(
    Type.String({ description: "可选，限定搜索根目录；可为相对工作目录路径或显式绝对路径" })
  ),
  glob: Type.Optional(Type.String({ description: "可选，rg --glob 过滤，例如 **/*.ts" })),
  output_mode: Type.Optional(
    Type.Union([Type.Literal("content"), Type.Literal("files_with_matches"), Type.Literal("count")], {
      description: "输出模式：content 返回匹配行，files_with_matches 只列文件，count 返回每文件匹配数"
    })
  ),
  "-A": Type.Optional(Type.Number({ description: "匹配行之后的上下文行数" })),
  "-B": Type.Optional(Type.Number({ description: "匹配行之前的上下文行数" })),
  "-C": Type.Optional(Type.Number({ description: "匹配行前后的上下文行数" })),
  context: Type.Optional(Type.Number({ description: "等同 -C" })),
  "-n": Type.Optional(Type.Boolean({ description: "是否显示行号；content 模式默认 true" })),
  "-i": Type.Optional(Type.Boolean({ description: "是否忽略大小写" })),
  type: Type.Optional(Type.String({ description: "rg --type 类型过滤，例如 ts、md、json" })),
  head_limit: Type.Optional(Type.Number({ description: "最多返回多少行输出，默认 200" })),
  offset: Type.Optional(Type.Number({ description: "跳过前多少行输出，默认 0" })),
  multiline: Type.Optional(Type.Boolean({ description: "是否启用 rg --multiline" }))
});

const DEFAULT_READ_LINE_LIMIT = 2000;
const MAX_READ_LINE_LIMIT = 2000;
const DEFAULT_GREP_HEAD_LIMIT = 200;
const MAX_GREP_HEAD_LIMIT = 2000;
const MAX_GREP_OUTPUT_BYTES = 512 * 1024;

const IMAGE_MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp"
};

export function createFsTools(workspacePath: string): AgentTool<any>[] {
  const lsTool: AgentTool<typeof lsParams> = {
    name: "LS",
    label: "浏览目录",
    description: "列出工作目录或显式绝对路径中的某个目录的文件与子目录。",
    parameters: lsParams,
    execute: async (_id, params) => {
      const path = params.path || ".";
      const target = resolveFsToolPath(workspacePath, "LS", path, false);
      const entries = await readdir(target, { withFileTypes: true });
      if (entries.length === 0) {
        return textResult("（空目录）");
      }
      return textResult(
        entries
          .map((entry) => `${entry.isDirectory() ? "dir " : "file"} ${entry.name}`)
          .join("\n")
      );
    }
  };

  const readTool: AgentTool<typeof readParams> = {
    name: "Read",
    label: "读取文件",
    description:
      "读取工作目录或显式绝对路径中的文件。文本默认最多 2000 行并带行号；PNG/JPG/GIF/WEBP 图片会以 image content 返回。",
    parameters: readParams,
    execute: async (_id, params) => {
      const target = resolveFsToolPath(workspacePath, "Read", params.file_path, false);
      const info = await stat(target);
      if (info.isDirectory()) {
        throw new Error(`Read 只能读取文件，收到目录：${params.file_path}`);
      }
      const mimeType = imageMimeForPath(target);
      if (mimeType) {
        return imageResult(await readFile(target), mimeType);
      }
      if (info.size === 0) {
        return textResult(`${params.file_path} 文件为空`);
      }
      return textResult(await readLineRange(params.file_path, target, params.offset, params.limit));
    }
  };

  const writeTool: AgentTool<typeof writeParams> = {
    name: "Write",
    label: "写入文件",
    description:
      "创建或完整覆盖工作目录或显式绝对路径中的一个文本文件，会自动创建父目录。调用时优先生成 file_path，便于界面尽早展示正在写入的文件。",
    parameters: writeParams,
    execute: async (_id, params) => {
      const target = await resolveFsWritablePath(workspacePath, "Write", params.file_path, true);
      const before = await readTextBeforeWrite(target);
      await writeFile(target, params.content, "utf8");
      const fileChange = buildToolFileChangeDetails({
        path: params.file_path,
        operation: "write",
        before,
        after: params.content
      });
      console.info("[fs-tools] Write 写入完成", {
        path: params.file_path,
        target,
        contentLength: params.content.length,
        hasFileChange: Boolean(fileChange)
      });
      return fileChangeResult(`已写入 ${target}`, fileChange);
    }
  };

  const editTool: AgentTool<typeof editParams> = {
    name: "Edit",
    label: "编辑文件",
    description:
      "对已有文本文件做精确字符串替换。默认 old_string 必须唯一匹配；replace_all=true 时替换全部匹配。调用时优先生成 file_path，便于界面尽早展示正在编辑的文件。",
    parameters: editParams,
    execute: async (_id, params) => {
      if (params.old_string.length === 0) {
        throw new Error("Edit 的 old_string 不能为空");
      }
      const target = await resolveFsWritablePath(workspacePath, "Edit", params.file_path, false);
      const source = await readFile(target, "utf8");
      const occurrences = countOccurrences(source, params.old_string);
      if (occurrences === 0) {
        console.warn("[fs-tools] Edit 未找到要替换的内容", {
          path: params.file_path,
          oldStringLength: params.old_string.length
        });
        throw new Error("没有找到要替换的内容");
      }
      if (!params.replace_all && occurrences > 1) {
        const lines = matchedLineNumbers(source, params.old_string);
        throw new Error(
          `old_string 出现了 ${occurrences} 次（行 ${lines.join(", ")}），默认必须唯一匹配；如需全部替换请设置 replace_all=true`
        );
      }
      const next = params.replace_all
        ? source.split(params.old_string).join(params.new_string)
        : source.replace(params.old_string, params.new_string);
      await writeFile(target, next, "utf8");
      const fileChange = buildToolFileChangeDetails({
        path: params.file_path,
        operation: "edit",
        before: source,
        after: next
      });
      console.info("[fs-tools] Edit 编辑完成", {
        path: params.file_path,
        target,
        occurrences,
        replaceAll: Boolean(params.replace_all),
        hasFileChange: Boolean(fileChange)
      });
      return fileChangeResult(
        params.replace_all
          ? `已编辑 ${target}，替换 ${occurrences} 处`
          : `已编辑 ${target}`,
        fileChange
      );
    }
  };

  const makeDirectoryTool: AgentTool<typeof makeDirectoryParams> = {
    name: "MakeDirectory",
    label: "创建目录",
    description: "在工作目录或显式绝对路径中创建一个目录（含多级父目录）。",
    parameters: makeDirectoryParams,
    execute: async (_id, params) => {
      const target = resolveFsToolPath(workspacePath, "MakeDirectory", params.path, true);
      await mkdir(target, { recursive: true });
      return textResult(`已创建目录 ${target}`);
    }
  };

  const globTool: AgentTool<typeof globParams> = {
    name: "Glob",
    label: "查找文件",
    description: "按通配符在工作目录或指定目录中递归查找文件，例如 '**/*.ts' 或 'src/**/*.md'。",
    parameters: globParams,
    execute: async (_id, params) => {
      const path = params.path || ".";
      const target = resolveFsToolPath(workspacePath, "Glob", path, false);
      return textResult(await globFiles(target, params.pattern));
    }
  };

  const grepTool: AgentTool<typeof grepParams> = {
    name: "Grep",
    label: "搜索内容",
    description: "使用 ripgrep 在工作目录或显式绝对路径目录中搜索内容，支持输出模式、上下文和过滤参数。",
    parameters: grepParams,
    execute: async (_id, params, signal) => {
      const path = params.path || ".";
      const resolved = resolveFsToolPathWithMeta(workspacePath, "Grep", path, false);
      return textResult(await runGrep(resolved.target, params, signal));
    }
  };

  return [lsTool, readTool, writeTool, editTool, makeDirectoryTool, globTool, grepTool];
}

async function resolveFsWritablePath(
  workspacePath: string,
  toolName: "Write" | "Edit",
  path: string,
  createParentDirs: boolean
): Promise<string> {
  const target = resolveFsToolPath(workspacePath, toolName, path, true);
  if (createParentDirs) {
    await mkdir(dirname(target), { recursive: true });
  }
  return target;
}

async function readTextBeforeWrite(target: string): Promise<string> {
  try {
    return await readFile(target, "utf8");
  } catch (error) {
    if (isMissingPathError(error)) {
      return "";
    }
    console.warn("[fs-tools] Write 读取写入前内容失败", {
      target,
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}

function fileChangeResult(
  text: string,
  fileChange: ToolFileChangeDetails | undefined
): AgentToolResult<ToolFileChangeDetails | undefined> {
  return {
    content: [{ type: "text", text }],
    details: fileChange
  };
}

function isMissingPathError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "ENOENT";
}

function resolveFsToolPath(
  workspacePath: string,
  toolName: FsToolName,
  path: string,
  mutating: boolean
): string {
  return resolveFsToolPathWithMeta(workspacePath, toolName, path, mutating).target;
}

type FsToolName = "LS" | "Read" | "Write" | "Edit" | "MakeDirectory" | "Glob" | "Grep";

function resolveFsToolPathWithMeta(
  workspacePath: string,
  toolName: FsToolName,
  path: string,
  mutating: boolean
): ToolPathResolution {
  const resolved = resolveToolPath(workspacePath, path);
  if (resolved.outsideWorkspace) {
    console.info("[fs-tools] 工具访问工作目录外绝对路径", {
      toolName,
      path,
      target: resolved.target,
      mutating
    });
  }
  return resolved;
}

function imageMimeForPath(path: string): string | undefined {
  return IMAGE_MIME_BY_EXT[extname(path).toLowerCase()];
}

function imageResult(data: Buffer, mimeType: string): AgentToolResult<undefined> {
  return {
    content: [{ type: "image", data: data.toString("base64"), mimeType }],
    details: undefined
  };
}

async function readLineRange(
  path: string,
  target: string,
  requestedOffset: number | undefined,
  requestedLimit: number | undefined
): Promise<string> {
  const offset = requestedOffset ?? 1;
  const rawLimit = requestedLimit ?? DEFAULT_READ_LINE_LIMIT;
  if (!Number.isInteger(offset) || !Number.isInteger(rawLimit) || offset < 1 || rawLimit < 1) {
    console.warn("[fs-tools] Read 分段读取参数非法", {
      path,
      requestedOffset,
      requestedLimit
    });
    throw new Error("Read 的 offset 与 limit 必须是正整数");
  }
  const limit = Math.min(rawLimit, MAX_READ_LINE_LIMIT);
  if (rawLimit > MAX_READ_LINE_LIMIT) {
    console.info("[fs-tools] Read 读取行数过大，已按上限裁剪", {
      path,
      requestedLimit: rawLimit,
      limit
    });
  }

  const selected: string[] = [];
  let totalLines = 0;
  const reader = createInterface({
    input: createReadStream(target, { encoding: "utf8" }),
    crlfDelay: Infinity
  });
  for await (const line of reader) {
    totalLines += 1;
    if (totalLines >= offset && selected.length < limit) {
      selected.push(line);
    }
  }

  if (offset > totalLines) {
    return `${path} 的第 ${offset} 行之后没有内容（共 ${totalLines} 行）`;
  }
  const endLine = offset + selected.length - 1;
  const hasMore = endLine < totalLines;
  return [
    `${path} 的第 ${offset}-${endLine} 行（共 ${totalLines} 行）：`,
    withLineNumbers(selected, offset),
    ...(hasMore ? [`（内容未读完；下一段可从 offset=${endLine + 1} 继续读取）`] : [])
  ].join("\n");
}

function withLineNumbers(lines: string[], startLine: number): string {
  return lines
    .map((line, index) => `${String(startLine + index).padStart(6, " ")}\t${line}`)
    .join("\n");
}

function countOccurrences(source: string, needle: string): number {
  let count = 0;
  let index = 0;
  while (true) {
    const found = source.indexOf(needle, index);
    if (found === -1) {
      return count;
    }
    count += 1;
    index = found + needle.length;
  }
}

function matchedLineNumbers(source: string, needle: string): number[] {
  return source
    .split("\n")
    .map((line, index) => (line.includes(needle) ? index + 1 : 0))
    .filter((line) => line > 0);
}

async function runGrep(
  cwd: string,
  params: {
    pattern: string;
    path?: string;
    glob?: string;
    output_mode?: "content" | "files_with_matches" | "count";
    "-A"?: number;
    "-B"?: number;
    "-C"?: number;
    context?: number;
    "-n"?: boolean;
    "-i"?: boolean;
    type?: string;
    head_limit?: number;
    offset?: number;
    multiline?: boolean;
  },
  signal?: AbortSignal
): Promise<string> {
  const args = buildRgArgs(params);
  const output = await spawnAndCollect(resolveRgCommand(), args, cwd, signal);
  const lines = output.split(/\r?\n/).filter((line) => line.length > 0);
  const offset = normalizeNonNegativeInteger(params.offset ?? 0, "offset");
  const headLimit = Math.min(
    normalizePositiveInteger(params.head_limit ?? DEFAULT_GREP_HEAD_LIMIT, "head_limit"),
    MAX_GREP_HEAD_LIMIT
  );
  const selected = lines.slice(offset, offset + headLimit);
  if (selected.length === 0) {
    return "没有找到匹配内容";
  }
  const truncated = offset + selected.length < lines.length;
  return [...selected, ...(truncated ? [`（输出已截断，共 ${lines.length} 行）`] : [])].join("\n");
}

function buildRgArgs(params: {
  pattern: string;
  glob?: string;
  output_mode?: "content" | "files_with_matches" | "count";
  "-A"?: number;
  "-B"?: number;
  "-C"?: number;
  context?: number;
  "-n"?: boolean;
  "-i"?: boolean;
  type?: string;
  multiline?: boolean;
}): string[] {
  const args = ["--color=never"];
  if (params.output_mode === "files_with_matches") {
    args.push("--files-with-matches");
  } else if (params.output_mode === "count") {
    args.push("--count");
  } else if (params["-n"] !== false) {
    args.push("--line-number", "--with-filename");
  }
  if (params.context !== undefined) {
    args.push("-C", String(normalizeNonNegativeInteger(params.context, "context")));
  } else if (params["-C"] !== undefined) {
    args.push("-C", String(normalizeNonNegativeInteger(params["-C"], "-C")));
  } else {
    if (params["-A"] !== undefined) {
      args.push("-A", String(normalizeNonNegativeInteger(params["-A"], "-A")));
    }
    if (params["-B"] !== undefined) {
      args.push("-B", String(normalizeNonNegativeInteger(params["-B"], "-B")));
    }
  }
  if (params["-i"]) {
    args.push("--ignore-case");
  }
  if (params.glob) {
    args.push("--glob", params.glob);
  }
  if (params.type) {
    args.push("--type", params.type);
  }
  if (params.multiline) {
    args.push("--multiline");
  }
  // 用 -- 终止选项解析,使以 "-" 开头的检索词(如 "-foo")被当作 pattern 而非未知 flag。
  args.push("--", params.pattern, ".");
  return args;
}

export function resolveRgCommand(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.CHENGXIAOBANG_RG_PATH?.trim();
  return configured || "rg";
}

function spawnAndCollect(
  command: string,
  args: string[],
  cwd: string,
  signal?: AbortSignal
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, signal, windowsHide: true });
    let stdout = "";
    let stderr = "";
    let truncated = false;

    const append = (chunk: Buffer) => {
      if (stdout.length >= MAX_GREP_OUTPUT_BYTES) {
        truncated = true;
        return;
      }
      stdout += chunk.toString("utf8").slice(0, MAX_GREP_OUTPUT_BYTES - stdout.length);
    };
    child.stdout.on("data", append);
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      reject(
        new Error(
          `Grep 无法启动 ripgrep 运行时（${command}）：${error.message}。请确认打包资源中包含 rg，或设置 CHENGXIAOBANG_RG_PATH。`
        )
      );
    });
    child.on("close", (code) => {
      if (code === 0 || code === 1) {
        resolve(truncated ? `${stdout}\n（输出过长已截断）` : stdout);
        return;
      }
      reject(new Error(stderr.trim() || `${command} 退出码 ${code}`));
    });
  });
}

function normalizePositiveInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`Grep 的 ${field} 必须是正整数`);
  }
  return value;
}

function normalizeNonNegativeInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Grep 的 ${field} 必须是非负整数`);
  }
  return value;
}
