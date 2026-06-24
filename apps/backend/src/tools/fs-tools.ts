import { createReadStream, type Stats } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { Type } from "@earendil-works/pi-ai";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import type { ModelInputModality } from "@chengxiaobang/shared";
import { errorToLogFields, getLogger } from "../logging/logger";
import { globFiles, resolveToolPath, type ToolPathResolution } from "./workspace";
import { buildToolFileChangeDetails, type ToolFileChangeDetails } from "./file-change";
import { textResult } from "./tool-result";

const log = getLogger({ module: "fs-tools" });

const readParams = Type.Object({
  file_path: Type.String({ description: "相对工作目录的文件路径，或显式绝对路径；用于读取已有文件内容" }),
  offset: Type.Optional(Type.Number({ description: "可选，起始行号，1 表示第一行；用于分段读取长文件" })),
  limit: Type.Optional(Type.Number({ description: "可选，最多读取多少行；默认和上限均为 2000" }))
});

const writeParams = Type.Object({
  file_path: Type.String({
    description: "相对工作目录的文件路径，或显式绝对路径；调用时优先生成 file_path，便于界面尽早展示正在写入的文件"
  }),
  content: Type.String({ description: "要写入的完整文本内容；Write 会创建新文件或完整覆盖已有文本文件" })
});

const editParams = Type.Object({
  file_path: Type.String({
    description: "相对工作目录的文件路径，或显式绝对路径；调用时优先生成 file_path，便于界面尽早展示正在编辑的文件"
  }),
  old_string: Type.String({
    description: "需要被替换的原文，必须逐字精确匹配；不要包含 Read 输出里的行号前缀"
  }),
  new_string: Type.String({ description: "替换后的新文本" }),
  replace_all: Type.Optional(
    Type.Boolean({ description: "默认 false，要求 old_string 唯一匹配；true 时替换所有匹配" })
  )
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
    Type.String({
      description: "可选，限定搜索范围；可传目录或单个文件，目录会递归搜索，文件只搜索该文件"
    })
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
const MAX_TEXT_READ_BYTES = 10 * 1024 * 1024;
const MAX_TEXT_MUTATION_BYTES = 8 * 1024 * 1024;
const BINARY_SAMPLE_BYTES = 4096;

const BINARY_TEXT_BLOCK_EXTENSIONS = new Set([
  ".7z",
  ".app",
  ".bin",
  ".bmp",
  ".class",
  ".dmg",
  ".doc",
  ".docx",
  ".exe",
  ".gif",
  ".gz",
  ".ico",
  ".jar",
  ".jpeg",
  ".jpg",
  ".mov",
  ".mp3",
  ".mp4",
  ".o",
  ".pdf",
  ".png",
  ".ppt",
  ".pptx",
  ".pyc",
  ".so",
  ".wasm",
  ".webp",
  ".xls",
  ".xlsx",
  ".zip"
]);

const IMAGE_MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp"
};

export interface FsToolOptions {
  modelInputModalities?: readonly ModelInputModality[];
}

export function createFsTools(workspacePath: string, options: FsToolOptions = {}): AgentTool<any>[] {
  const readFileState = new Map<string, FsReadState>();
  const supportsImageInput =
    !options.modelInputModalities || options.modelInputModalities.includes("image");

  const readTool: AgentTool<typeof readParams> = {
    name: "Read",
    label: "读取文件",
    description:
      "读取工作目录或显式绝对路径中的文件。先用它了解现状再修改文件；文本默认最多 2000 行并带行号，可用 offset/limit 分段读取；当前模型支持图片输入时，PNG/JPG/GIF/WEBP 图片会以 image content 返回。",
    parameters: readParams,
    execute: async (_id, params) => {
      const target = resolveFsToolPath(workspacePath, "Read", params.file_path, false);
      const info = await statExistingPathForTool(workspacePath, "Read", params.file_path, target);
      if (info.isDirectory()) {
        throw new Error(`Read 只能读取文件，收到目录：${params.file_path}`);
      }
      assertRegularFile("Read", params.file_path, target, info);
      const mimeType = imageMimeForPath(target);
      if (mimeType) {
        if (!supportsImageInput) {
          log.info("Read 拒绝向文本模型返回图片内容", {
            action: "fs.read_image_blocked_for_text_model",
            toolName: "Read",
            path: params.file_path,
            target,
            mimeType,
            modelInputModalities: options.modelInputModalities ?? []
          });
          return textResult(
            [
              `当前模型不支持图片原生输入，不能直接读取图片内容：${params.file_path}`,
              `文件类型：${mimeType}，大小：${formatBytes(info.size)}。`,
              "如果需要理解图片内容，请改用支持图片输入的模型；或对截图/PDF 等素材使用 OCR/文本检查链路。"
            ].join("\n")
          );
        }
        return imageResult(await readFile(target), mimeType);
      }
      await assertTextFileCanBeRead("Read", params.file_path, target, info.size);
      if (info.size === 0) {
        recordReadState(readFileState, {
          path: params.file_path,
          target,
          content: "",
          mtimeMs: info.mtimeMs,
          fullRead: true,
          offset: 1,
          limit: 0
        });
        return textResult(`${params.file_path} 文件为空`);
      }
      const range = await readLineRange(params.file_path, target, params.offset, params.limit);
      if (range.offset <= range.totalLines) {
        const stateContent = range.fullRead ? await readFile(target, "utf8") : range.selectedText;
        const latestInfo = await stat(target);
        recordReadState(readFileState, {
          path: params.file_path,
          target,
          content: stateContent,
          mtimeMs: latestInfo.mtimeMs,
          fullRead: range.fullRead,
          offset: range.offset,
          limit: range.limit
        });
      }
      return textResult(range.text);
    }
  };

  const writeTool: AgentTool<typeof writeParams> = {
    name: "Write",
    label: "写入文件",
    description:
      "创建或完整覆盖工作目录或显式绝对路径中的一个文本文件，会自动创建父目录。新文件可直接创建；覆盖已有文件前必须先用 Read 完整读取当前内容。已有文件的小范围改动优先使用 Edit，完整重写才使用 Write。",
    parameters: writeParams,
    execute: async (_id, params) => {
      const target = await resolveFsWritablePath(workspacePath, "Write", params.file_path, true);
      assertTextPathExtension("Write", params.file_path, target);
      assertTextContentSize("Write", params.file_path, Buffer.byteLength(params.content, "utf8"));
      const before = await readTextSnapshotBeforeWrite(params.file_path, target);
      if (before.exists) {
        validateFullReadBeforeWrite(readFileState, {
          toolName: "Write",
          path: params.file_path,
          target,
          currentContent: before.content,
          currentMtimeMs: before.mtimeMs
        });
      }
      await writeFile(target, params.content, "utf8");
      await refreshReadStateAfterWrite(readFileState, {
        toolName: "Write",
        path: params.file_path,
        target,
        content: params.content
      });
      const fileChange = buildToolFileChangeDetails({
        path: params.file_path,
        operation: "write",
        before: before.content,
        after: params.content
      });
      log.info("Write 写入完成", {
        action: "fs.write_completed",
        toolName: "Write",
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
      "对已有文本文件做精确字符串替换。编辑前必须先用 Read 读取该文件；old_string 不要包含 Read 输出里的行号前缀。默认 old_string 必须唯一匹配；replace_all=true 仅用于确实要替换全部匹配。文件在 Read 后变化会要求重新读取。",
    parameters: editParams,
    execute: async (_id, params) => {
      if (params.old_string.length === 0) {
        throw new Error("Edit 的 old_string 不能为空");
      }
      const target = await resolveFsWritablePath(workspacePath, "Edit", params.file_path, false);
      const currentInfo = await statExistingPathForTool(workspacePath, "Edit", params.file_path, target);
      if (currentInfo.isDirectory()) {
        throw new Error(`Edit 只能编辑文件，收到目录：${params.file_path}`);
      }
      assertRegularFile("Edit", params.file_path, target, currentInfo);
      await assertTextFileCanBeMutated("Edit", params.file_path, target, currentInfo.size);
      const source = await readFile(target, "utf8");
      validateReadBeforeEdit(readFileState, {
        path: params.file_path,
        target,
        currentContent: source,
        currentMtimeMs: currentInfo.mtimeMs
      });
      const occurrences = countOccurrences(source, params.old_string);
      if (occurrences === 0) {
        log.warn("Edit 未找到要替换的内容", {
          action: "fs.edit_missing_old_string",
          toolName: "Edit",
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
      await refreshReadStateAfterWrite(readFileState, {
        toolName: "Edit",
        path: params.file_path,
        target,
        content: next
      });
      const fileChange = buildToolFileChangeDetails({
        path: params.file_path,
        operation: "edit",
        before: source,
        after: next
      });
      log.info("Edit 编辑完成", {
        action: "fs.edit_completed",
        toolName: "Edit",
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

  const globTool: AgentTool<typeof globParams> = {
    name: "Glob",
    label: "查找文件",
    description:
      "按通配符在工作目录或指定目录中递归查找文件，例如 '**/*.ts' 或 'src/**/*.md'。查找文件名或结构时优先用它，不要用 shell 拼等价命令。",
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
    description:
      "使用 ripgrep 在工作目录、显式绝对路径目录或单个文件中搜索内容；path 可传目录或单个文件，搜索文件内容时优先用它，不要用 shell 拼等价命令。",
    parameters: grepParams,
    execute: async (_id, params, signal) => {
      const path = params.path || ".";
      const target = await resolveGrepSearchTarget(workspacePath, path);
      return textResult(await runGrep(target.cwd, target.targetArg, params, signal));
    }
  };

  return [readTool, writeTool, editTool, globTool, grepTool];
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

interface FsReadState {
  path: string;
  target: string;
  content: string;
  mtimeMs: number;
  fullRead: boolean;
  offset: number;
  limit: number;
}

interface ReadLineRangeResult {
  text: string;
  selectedText: string;
  offset: number;
  limit: number;
  fullRead: boolean;
  totalLines: number;
}

interface TextSnapshot {
  exists: boolean;
  content: string;
  mtimeMs?: number;
}

function recordReadState(
  readFileState: Map<string, FsReadState>,
  state: FsReadState
): void {
  readFileState.set(state.target, state);
  log.info("Read 已记录文件读取状态", {
    action: "fs.read_state_recorded",
    toolName: "Read",
    path: state.path,
    target: state.target,
    fullRead: state.fullRead,
    offset: state.offset,
    limit: state.limit,
    mtimeMs: state.mtimeMs,
    contentLength: state.content.length
  });
}

async function refreshReadStateAfterWrite(
  readFileState: Map<string, FsReadState>,
  input: {
    toolName: "Write" | "Edit";
    path: string;
    target: string;
    content: string;
  }
): Promise<void> {
  const info = await stat(input.target);
  readFileState.set(input.target, {
    path: input.path,
    target: input.target,
    content: input.content,
    mtimeMs: info.mtimeMs,
    fullRead: true,
    offset: 1,
    limit: lineCountForState(input.content)
  });
  log.info("文件写入后已刷新读取状态", {
    action: "fs.read_state_refreshed_after_write",
    toolName: input.toolName,
    path: input.path,
    target: input.target,
    mtimeMs: info.mtimeMs,
    contentLength: input.content.length
  });
}

function validateFullReadBeforeWrite(
  readFileState: Map<string, FsReadState>,
  input: {
    toolName: "Write";
    path: string;
    target: string;
    currentContent: string;
    currentMtimeMs?: number;
  }
): void {
  const state = readFileState.get(input.target);
  if (!state) {
    log.warn("Write 覆盖已有文件前缺少读取状态", {
      action: "fs.write_without_read",
      toolName: input.toolName,
      path: input.path,
      target: input.target,
      currentMtimeMs: input.currentMtimeMs
    });
    throw new Error("覆盖已有文件前必须先用 Read 完整读取该文件");
  }
  if (!state.fullRead) {
    log.warn("Write 覆盖已有文件前只读过部分内容", {
      action: "fs.write_after_partial_read",
      toolName: input.toolName,
      path: input.path,
      target: input.target,
      readOffset: state.offset,
      readLimit: state.limit,
      readMtimeMs: state.mtimeMs,
      currentMtimeMs: input.currentMtimeMs
    });
    throw new Error("覆盖已有文件前必须先用 Read 完整读取该文件，当前只读过部分内容");
  }
  if (input.currentContent !== state.content) {
    log.warn("Write 覆盖已有文件前检测到文件已变化", {
      action: "fs.write_stale_read",
      toolName: input.toolName,
      path: input.path,
      target: input.target,
      readMtimeMs: state.mtimeMs,
      currentMtimeMs: input.currentMtimeMs,
      readLength: state.content.length,
      currentLength: input.currentContent.length
    });
    throw new Error("文件在 Read 后已被修改，请重新 Read 后再写入");
  }
  if (input.currentMtimeMs !== undefined && input.currentMtimeMs !== state.mtimeMs) {
    log.info("Write 检测到 mtime 变化但内容未变，允许继续", {
      action: "fs.write_mtime_changed_content_same",
      toolName: input.toolName,
      path: input.path,
      target: input.target,
      readMtimeMs: state.mtimeMs,
      currentMtimeMs: input.currentMtimeMs
    });
  }
}

function validateReadBeforeEdit(
  readFileState: Map<string, FsReadState>,
  input: {
    path: string;
    target: string;
    currentContent: string;
    currentMtimeMs: number;
  }
): void {
  const state = readFileState.get(input.target);
  if (!state) {
    log.warn("Edit 前缺少读取状态", {
      action: "fs.edit_without_read",
      toolName: "Edit",
      path: input.path,
      target: input.target,
      currentMtimeMs: input.currentMtimeMs
    });
    throw new Error("编辑已有文件前必须先用 Read 读取该文件");
  }
  if (state.fullRead) {
    if (input.currentContent !== state.content) {
      log.warn("Edit 前检测到完整读取后的文件内容已变化", {
        action: "fs.edit_stale_full_read",
        toolName: "Edit",
        path: input.path,
        target: input.target,
        readMtimeMs: state.mtimeMs,
        currentMtimeMs: input.currentMtimeMs,
        readLength: state.content.length,
        currentLength: input.currentContent.length
      });
      throw new Error("文件在 Read 后已被修改，请重新 Read 后再编辑");
    }
    return;
  }
  if (input.currentMtimeMs !== state.mtimeMs) {
    log.warn("Edit 前检测到局部读取后的文件 mtime 已变化", {
      action: "fs.edit_stale_partial_read",
      toolName: "Edit",
      path: input.path,
      target: input.target,
      readOffset: state.offset,
      readLimit: state.limit,
      readMtimeMs: state.mtimeMs,
      currentMtimeMs: input.currentMtimeMs
    });
    throw new Error("文件在 Read 后已被修改，请重新 Read 后再编辑");
  }
}

async function readTextSnapshotBeforeWrite(path: string, target: string): Promise<TextSnapshot> {
  try {
    const info = await stat(target);
    if (info.isDirectory()) {
      throw new Error(`Write 不能覆盖目录：${path}`);
    }
    assertRegularFile("Write", path, target, info);
    await assertTextFileCanBeMutated("Write", path, target, info.size);
    const content = await readFile(target, "utf8");
    return { exists: true, content, mtimeMs: info.mtimeMs };
  } catch (error) {
    if (isMissingPathError(error)) {
      return { exists: false, content: "" };
    }
    log.warn("Write 读取写入前内容失败", {
      action: "fs.read_before_write_failed",
      toolName: "Write",
      target,
      ...errorToLogFields(error)
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
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

function resolveFsToolPath(
  workspacePath: string,
  toolName: FsToolName,
  path: string,
  mutating: boolean
): string {
  return resolveFsToolPathWithMeta(workspacePath, toolName, path, mutating).target;
}

type FsToolName = "Read" | "Write" | "Edit" | "Glob" | "Grep";

interface GrepSearchTarget {
  cwd: string;
  targetArg: string;
  kind: "directory" | "file";
}

async function resolveGrepSearchTarget(workspacePath: string, path: string): Promise<GrepSearchTarget> {
  const toolName = "Grep";
  const resolved = resolveFsToolPathWithMeta(workspacePath, toolName, path, false);
  let info: Stats;
  try {
    info = await stat(resolved.target);
  } catch (error) {
    if (!isMissingPathError(error)) {
      throw error;
    }
    log.warn("Grep 搜索路径不存在", {
      action: "fs.grep_path_missing",
      toolName,
      workspacePath,
      path,
      target: resolved.target
    });
    throw new Error(`${toolName} 找不到搜索路径：${path}`);
  }
  if (info.isDirectory()) {
    return {
      cwd: resolved.target,
      targetArg: ".",
      kind: "directory"
    };
  }
  if (info.isFile()) {
    log.debug("Grep 在单个文件内搜索", {
      action: "fs.grep_single_file",
      toolName,
      workspacePath,
      path,
      target: resolved.target
    });
    return {
      cwd: dirname(resolved.target),
      targetArg: basename(resolved.target),
      kind: "file"
    };
  }
  log.warn("Grep 搜索路径不是目录或普通文件", {
    action: "fs.grep_path_not_searchable",
    toolName,
    workspacePath,
    path,
    target: resolved.target,
    isBlockDevice: info.isBlockDevice(),
    isCharacterDevice: info.isCharacterDevice(),
    isFIFO: info.isFIFO(),
    isSocket: info.isSocket()
  });
  throw new Error(`${toolName} 只能在目录或普通文件中搜索，收到非目录非普通文件路径：${path}`);
}

function resolveFsToolPathWithMeta(
  workspacePath: string,
  toolName: FsToolName,
  path: string,
  mutating: boolean
): ToolPathResolution {
  const resolved = resolveToolPath(workspacePath, path);
  if (resolved.outsideWorkspace) {
    log.info("工具访问工作目录外绝对路径", {
      action: "fs.outside_workspace",
      toolName,
      path,
      target: resolved.target,
      mutating
    });
  }
  return resolved;
}

async function statExistingPathForTool(
  workspacePath: string,
  toolName: "Read" | "Edit",
  path: string,
  target: string
): Promise<Stats> {
  try {
    return await stat(target);
  } catch (error) {
    if (!isMissingPathError(error)) {
      throw error;
    }
    const suggestion = await suggestSimilarPath(target);
    log.warn("文件工具路径不存在", {
      action: "fs.path_missing",
      toolName,
      workspacePath,
      path,
      target,
      ...(suggestion ? { suggestion } : {})
    });
    throw new Error(
      suggestion
        ? `${toolName} 找不到文件：${path}。你是不是要访问 ${suggestion}？`
        : `${toolName} 找不到文件：${path}`
    );
  }
}

function assertRegularFile(
  toolName: "Read" | "Write" | "Edit",
  path: string,
  target: string,
  info: Stats
): void {
  if (info.isFile()) {
    return;
  }
  log.warn("文件工具拒绝非普通文件", {
    action: "fs.reject_non_regular_file",
    toolName,
    path,
    target,
    isBlockDevice: info.isBlockDevice(),
    isCharacterDevice: info.isCharacterDevice(),
    isFIFO: info.isFIFO(),
    isSocket: info.isSocket()
  });
  throw new Error(`${toolName} 只能处理普通文件，拒绝设备文件、管道或 socket：${path}`);
}

async function assertTextFileCanBeRead(
  toolName: "Read",
  path: string,
  target: string,
  size: number
): Promise<void> {
  assertTextContentSize(toolName, path, size, MAX_TEXT_READ_BYTES);
  assertTextPathExtension(toolName, path, target);
  await assertNoBinarySample(toolName, path, target);
}

async function assertTextFileCanBeMutated(
  toolName: "Write" | "Edit",
  path: string,
  target: string,
  size: number
): Promise<void> {
  assertTextContentSize(toolName, path, size, MAX_TEXT_MUTATION_BYTES);
  assertTextPathExtension(toolName, path, target);
  await assertNoBinarySample(toolName, path, target);
}

function assertTextPathExtension(
  toolName: "Read" | "Write" | "Edit",
  path: string,
  target: string
): void {
  const ext = extname(target).toLowerCase();
  if (!BINARY_TEXT_BLOCK_EXTENSIONS.has(ext)) {
    return;
  }
  log.warn("文件工具拒绝疑似二进制扩展名", {
    action: "fs.reject_binary_extension",
    toolName,
    path,
    target,
    ext
  });
  throw new Error(`${toolName} 只支持文本文件，拒绝疑似二进制文件：${path}`);
}

function assertTextContentSize(
  toolName: "Read" | "Write" | "Edit",
  path: string,
  size: number,
  limit = MAX_TEXT_MUTATION_BYTES
): void {
  if (size <= limit) {
    return;
  }
  log.warn("文件工具拒绝超大文本操作", {
    action: "fs.reject_oversized_text",
    toolName,
    path,
    size,
    limit
  });
  throw new Error(`${toolName} 拒绝处理超大文本文件：${path}（${formatBytes(size)}，上限 ${formatBytes(limit)}）`);
}

async function assertNoBinarySample(
  toolName: "Read" | "Write" | "Edit",
  path: string,
  target: string
): Promise<void> {
  const sample = await readBinarySample(target);
  if (!sample.includes(0)) {
    return;
  }
  log.warn("文件工具拒绝包含 NUL 字节的文件", {
    action: "fs.reject_binary_sample",
    toolName,
    path,
    target,
    sampleBytes: sample.length
  });
  throw new Error(`${toolName} 只支持文本文件，检测到二进制内容：${path}`);
}

async function readBinarySample(target: string): Promise<Buffer> {
  const content = await readFile(target);
  return content.subarray(0, BINARY_SAMPLE_BYTES);
}

async function suggestSimilarPath(target: string): Promise<string | undefined> {
  try {
    const dir = dirname(target);
    const requested = basename(target);
    const entries = await readdir(dir);
    const normalizedRequested = normalizePathNameForSuggestion(requested);
    const scored = entries
      .map((entry) => ({
        entry,
        score: pathSuggestionScore(normalizedRequested, normalizePathNameForSuggestion(entry))
      }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || a.entry.localeCompare(b.entry));
    const best = scored[0];
    return best ? join(dir, best.entry) : undefined;
  } catch {
    return undefined;
  }
}

function normalizePathNameForSuggestion(name: string): string {
  return name.toLowerCase().replace(/[-_.\s]+/g, "");
}

function pathSuggestionScore(requested: string, candidate: string): number {
  if (!requested || !candidate) {
    return 0;
  }
  if (requested === candidate) {
    return 100;
  }
  if (candidate.includes(requested) || requested.includes(candidate)) {
    return 80;
  }
  const commonPrefix = [...requested].findIndex((char, index) => char !== candidate[index]);
  const prefixLength = commonPrefix === -1 ? Math.min(requested.length, candidate.length) : commonPrefix;
  return prefixLength >= Math.min(4, requested.length) ? prefixLength : 0;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${Math.round(bytes / 1024 / 1024)}MB`;
  }
  return `${Math.round(bytes / 1024)}KB`;
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
): Promise<ReadLineRangeResult> {
  const offset = requestedOffset ?? 1;
  const rawLimit = requestedLimit ?? DEFAULT_READ_LINE_LIMIT;
  if (!Number.isInteger(offset) || !Number.isInteger(rawLimit) || offset < 1 || rawLimit < 1) {
    log.warn("Read 分段读取参数非法", {
      action: "fs.read_invalid_range",
      toolName: "Read",
      path,
      requestedOffset,
      requestedLimit
    });
    throw new Error("Read 的 offset 与 limit 必须是正整数");
  }
  const limit = Math.min(rawLimit, MAX_READ_LINE_LIMIT);
  if (rawLimit > MAX_READ_LINE_LIMIT) {
    log.info("Read 读取行数过大，已按上限裁剪", {
      action: "fs.read_limit_clamped",
      toolName: "Read",
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
    return {
      text: `${path} 的第 ${offset} 行之后没有内容（共 ${totalLines} 行）`,
      selectedText: "",
      offset,
      limit,
      fullRead: false,
      totalLines
    };
  }
  const endLine = offset + selected.length - 1;
  const hasMore = endLine < totalLines;
  const selectedText = selected.join("\n");
  return {
    text: [
      `${path} 的第 ${offset}-${endLine} 行（共 ${totalLines} 行）：`,
      withLineNumbers(selected, offset),
      ...(hasMore ? [`（内容未读完；下一段可从 offset=${endLine + 1} 继续读取）`] : [])
    ].join("\n"),
    selectedText,
    offset,
    limit,
    fullRead: offset === 1 && !hasMore,
    totalLines
  };
}

function lineCountForState(content: string): number {
  if (content.length === 0) {
    return 0;
  }
  return content.split("\n").length;
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
  targetArg: string,
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
  const args = buildRgArgs(params, targetArg);
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

function buildRgArgs(
  params: {
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
  },
  targetArg: string
): string[] {
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
  args.push("--", params.pattern, targetArg);
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
          `Grep 无法启动 ripgrep 运行时 command=${command} cwd=${cwd}：${error.message}。请确认搜索根路径是目录、打包资源中包含 rg，或设置 CHENGXIAOBANG_RG_PATH。`
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
