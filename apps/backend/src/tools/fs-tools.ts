import { createReadStream } from "node:fs";
import { mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { globFiles, safeResolve, searchFiles } from "./workspace";
import { textResult } from "./tool-result";

const listDirectoryParams = Type.Object({
  path: Type.Optional(Type.String({ description: "相对工作目录的路径，默认当前目录 '.'" }))
});

const readFileParams = Type.Object({
  path: Type.String({ description: "相对工作目录的文件路径" }),
  startLine: Type.Optional(Type.Number({ description: "可选，从第几行开始读取，1 表示第一行" })),
  lineLimit: Type.Optional(Type.Number({ description: "可选，最多读取多少行；用于分段查看大文件" }))
});

const writeFileParams = Type.Object({
  path: Type.String({ description: "相对工作目录的文件路径" }),
  content: Type.String({ description: "要写入的完整文本内容；传入 startLine 时作为行级插入/替换内容" }),
  startLine: Type.Optional(Type.Number({ description: "可选，从第几行开始写入，1 表示第一行" })),
  deleteLineCount: Type.Optional(
    Type.Number({ description: "可选，行级写入时从 startLine 起删除多少行；0 表示插入" })
  )
});

const editFileParams = Type.Object({
  path: Type.String({ description: "相对工作目录的文件路径" }),
  oldText: Type.Optional(Type.String({ description: "需要被替换的原文（未传 startLine 时必填）" })),
  newText: Type.String({ description: "替换后的新文本；行级编辑时作为插入/替换内容" }),
  startLine: Type.Optional(Type.Number({ description: "可选，从第几行开始编辑，1 表示第一行" })),
  deleteLineCount: Type.Optional(
    Type.Number({ description: "行级编辑时从 startLine 起删除多少行；0 表示插入" })
  )
});

const makeDirectoryParams = Type.Object({
  path: Type.String({ description: "相对工作目录的目录路径" })
});

const globParams = Type.Object({
  pattern: Type.String({ description: "glob 通配符" })
});

const searchParams = Type.Object({
  query: Type.String({ description: "要搜索的文本" }),
  path: Type.Optional(Type.String({ description: "可选，限定搜索的子目录" }))
});

const DEFAULT_READ_LINE_LIMIT = 200;
const MAX_READ_LINE_LIMIT = 1000;
const MAX_FULL_READ_BYTES = 256 * 1024;

export function createFsTools(workspacePath: string): AgentTool<any>[] {
  const listDirectory: AgentTool<typeof listDirectoryParams> = {
    name: "list_directory",
    label: "浏览目录",
    description: "列出工作目录中某个目录的文件与子目录。用于了解项目结构。",
    parameters: listDirectoryParams,
    execute: async (_id, params) => {
      const target = safeResolve(workspacePath, params.path || ".");
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

  const readFileTool: AgentTool<typeof readFileParams> = {
    name: "read_file",
    label: "读取文件",
    description: "读取工作目录中某个文本文件；可用 startLine/lineLimit 分段查看大文件。",
    parameters: readFileParams,
    execute: async (_id, params) => {
      const target = safeResolve(workspacePath, params.path);
      if (params.startLine === undefined && params.lineLimit === undefined) {
        return textResult(await readFullFileOrHint(params.path, target));
      }
      return textResult(await readLineRange(params.path, target, params.startLine, params.lineLimit));
    }
  };

  const writeFileTool: AgentTool<typeof writeFileParams> = {
    name: "write_file",
    label: "写入文件",
    description: "创建或覆盖工作目录中的一个文本文件，会自动创建所需的父目录。",
    parameters: writeFileParams,
    execute: async (_id, params) => {
      const target = safeResolve(workspacePath, params.path);
      await mkdir(dirname(target), { recursive: true });
      if (params.startLine !== undefined || params.deleteLineCount !== undefined) {
        const startLine = requirePositiveInteger(params.startLine, "write_file", "startLine", {
          path: params.path,
          deleteLineCount: params.deleteLineCount
        });
        const deleteLineCount = requireNonNegativeInteger(
          params.deleteLineCount ?? 0,
          "write_file",
          "deleteLineCount",
          { path: params.path, startLine }
        );
        console.info("[fs-tools] write_file 执行行级写入", {
          path: params.path,
          startLine,
          deleteLineCount,
          contentLength: params.content.length
        });
        const result = await rewriteLineRange({
          path: params.path,
          target,
          replacementText: params.content,
          startLine,
          deleteLineCount,
          allowCreateWhenMissing: true
        });
        return textResult(
          `已按行写入 ${target}（第 ${startLine} 行起，删除 ${deleteLineCount} 行，插入 ${result.insertedLineCount} 行）`
        );
      }
      await writeFile(target, params.content, "utf8");
      return textResult(`已写入 ${target}`);
    }
  };

  const editFileTool: AgentTool<typeof editFileParams> = {
    name: "edit_file",
    label: "编辑文件",
    description: "对已有文件做精确替换：把 oldText 第一次出现的位置替换为 newText。",
    parameters: editFileParams,
    execute: async (_id, params) => {
      const target = safeResolve(workspacePath, params.path);
      if (params.startLine !== undefined || params.deleteLineCount !== undefined) {
        const startLine = requirePositiveInteger(params.startLine, "edit_file", "startLine", {
          path: params.path,
          deleteLineCount: params.deleteLineCount
        });
        const deleteLineCount = requireNonNegativeInteger(
          params.deleteLineCount,
          "edit_file",
          "deleteLineCount",
          { path: params.path, startLine }
        );
        console.info("[fs-tools] edit_file 执行行级编辑", {
          path: params.path,
          startLine,
          deleteLineCount,
          newTextLength: params.newText.length
        });
        const result = await rewriteLineRange({
          path: params.path,
          target,
          replacementText: params.newText,
          startLine,
          deleteLineCount,
          allowCreateWhenMissing: false
        });
        return textResult(
          `已按行编辑 ${target}（第 ${startLine} 行起，删除 ${deleteLineCount} 行，插入 ${result.insertedLineCount} 行）`
        );
      }
      if (typeof params.oldText !== "string" || params.oldText.length === 0) {
        console.warn("[fs-tools] edit_file 缺少 oldText", { path: params.path });
        throw new Error("edit_file 需要 oldText/newText，或 startLine/deleteLineCount/newText");
      }
      const source = await readFile(target, "utf8");
      if (!source.includes(params.oldText)) {
        console.warn("[fs-tools] edit_file 未找到要替换的内容", {
          path: params.path,
          oldTextLength: params.oldText.length
        });
        throw new Error("没有找到要替换的内容");
      }
      await writeFile(target, source.replace(params.oldText, params.newText), "utf8");
      return textResult(`已编辑 ${target}`);
    }
  };

  const makeDirectoryTool: AgentTool<typeof makeDirectoryParams> = {
    name: "make_directory",
    label: "创建目录",
    description: "在工作目录中创建一个目录（含多级父目录）。",
    parameters: makeDirectoryParams,
    execute: async (_id, params) => {
      const target = safeResolve(workspacePath, params.path);
      await mkdir(target, { recursive: true });
      return textResult(`已创建目录 ${target}`);
    }
  };

  const globTool: AgentTool<typeof globParams> = {
    name: "glob",
    label: "查找文件",
    description: "按通配符在工作目录中递归查找文件，例如 '**/*.ts' 或 'src/**/*.md'。",
    parameters: globParams,
    execute: async (_id, params) => textResult(await globFiles(workspacePath, params.pattern))
  };

  const searchTool: AgentTool<typeof searchParams> = {
    name: "search",
    label: "搜索内容",
    description: "在工作目录的文本文件中搜索包含指定字符串的行（不区分大小写）。",
    parameters: searchParams,
    execute: async (_id, params) => {
      const scope = safeResolve(workspacePath, params.path || ".");
      return textResult(await searchFiles(workspacePath, scope, params.query));
    }
  };

  return [
    listDirectory,
    readFileTool,
    writeFileTool,
    editFileTool,
    makeDirectoryTool,
    globTool,
    searchTool
  ];
}

async function readFullFileOrHint(path: string, target: string): Promise<string> {
  const info = await stat(target);
  if (info.size > MAX_FULL_READ_BYTES) {
    console.info("[fs-tools] read_file 完整读取文件过大，已提示分段读取", {
      path,
      sizeBytes: info.size,
      maxFullReadBytes: MAX_FULL_READ_BYTES
    });
    return [
      `${path} 大小为 ${formatBytes(info.size)}，超过完整读取上限 ${formatBytes(MAX_FULL_READ_BYTES)}。`,
      "请使用 startLine/lineLimit 分段读取，例如：",
      `{"path":"${path}","startLine":1,"lineLimit":${DEFAULT_READ_LINE_LIMIT}}`
    ].join("\n");
  }
  return readFile(target, "utf8");
}

async function readLineRange(
  path: string,
  target: string,
  requestedStartLine: number | undefined,
  requestedLineLimit: number | undefined
): Promise<string> {
  const startLine = requestedStartLine ?? 1;
  const rawLineLimit = requestedLineLimit ?? DEFAULT_READ_LINE_LIMIT;
  if (
    !Number.isInteger(startLine) ||
    !Number.isInteger(rawLineLimit) ||
    startLine < 1 ||
    rawLineLimit < 1
  ) {
    console.warn("[fs-tools] read_file 分段读取参数非法", {
      path,
      requestedStartLine,
      requestedLineLimit
    });
    throw new Error("read_file 的 startLine 与 lineLimit 必须是正整数");
  }
  const lineLimit = Math.min(rawLineLimit, MAX_READ_LINE_LIMIT);
  if (rawLineLimit > MAX_READ_LINE_LIMIT) {
    console.info("[fs-tools] read_file 分段读取行数过大，已按上限裁剪", {
      path,
      requestedLineLimit: rawLineLimit,
      lineLimit
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
    if (totalLines >= startLine && selected.length < lineLimit) {
      selected.push(line);
    }
  }
  if (startLine > totalLines) {
    console.debug("[fs-tools] read_file 分段读取超出文件行数", {
      path,
      startLine,
      totalLines
    });
    return `${path} 的第 ${startLine} 行之后没有内容（共 ${totalLines} 行）`;
  }
  const endLine = startLine + selected.length - 1;
  const hasMore = endLine < totalLines;
  console.debug("[fs-tools] read_file 分段读取完成", {
    path,
    startLine,
    endLine,
    lineLimit,
    totalLines
  });
  return [
    `${path} 的第 ${startLine}-${endLine} 行（共 ${totalLines} 行）：`,
    withLineNumbers(selected, startLine),
    ...(hasMore ? [`（内容未读完；下一段可从 startLine=${endLine + 1} 继续读取）`] : [])
  ].join("\n");
}

function withLineNumbers(lines: string[], startLine: number): string {
  return lines
    .map((line, index) => `${String(startLine + index).padStart(6, " ")}\t${line}`)
    .join("\n");
}

interface RewriteLineRangeOptions {
  path: string;
  target: string;
  replacementText: string;
  startLine: number;
  deleteLineCount: number;
  allowCreateWhenMissing: boolean;
}

interface RewriteLineRangeResult {
  insertedLineCount: number;
  totalLinesBefore: number;
  totalLinesAfter: number;
}

async function rewriteLineRange(options: RewriteLineRangeOptions): Promise<RewriteLineRangeResult> {
  const replacementLines = splitReplacementLines(options.replacementText);
  const existingInfo = await stat(options.target).catch((error: unknown) => {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  });
  if (!existingInfo) {
    if (!options.allowCreateWhenMissing || options.startLine !== 1 || options.deleteLineCount !== 0) {
      console.warn("[fs-tools] 行级写入目标文件不存在或行参数非法", {
        path: options.path,
        startLine: options.startLine,
        deleteLineCount: options.deleteLineCount,
        allowCreateWhenMissing: options.allowCreateWhenMissing
      });
      throw new Error("目标文件不存在，只有 write_file 在 startLine=1 且 deleteLineCount=0 时可以创建文件");
    }
    await mkdir(dirname(options.target), { recursive: true });
    await writeFile(options.target, replacementLines.join("\n"), "utf8");
    console.info("[fs-tools] 行级写入创建新文件", {
      path: options.path,
      insertedLineCount: replacementLines.length
    });
    return {
      insertedLineCount: replacementLines.length,
      totalLinesBefore: 0,
      totalLinesAfter: replacementLines.length
    };
  }

  const tempPath = join(
    dirname(options.target),
    `.${basename(options.target)}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`
  );
  let tempHandle: Awaited<ReturnType<typeof open>> | undefined;
  let reader: ReturnType<typeof createInterface> | undefined;
  let totalLinesBefore = 0;
  let totalLinesAfter = 0;
  let skippedLineCount = 0;
  let inserted = false;

  const writeOutputLine = async (line: string) => {
    if (!tempHandle) {
      throw new Error("临时文件尚未打开");
    }
    if (totalLinesAfter > 0) {
      await tempHandle.writeFile("\n", "utf8");
    }
    await tempHandle.writeFile(line, "utf8");
    totalLinesAfter += 1;
  };
  const insertReplacement = async () => {
    if (inserted) return;
    for (const line of replacementLines) {
      await writeOutputLine(line);
    }
    inserted = true;
  };

  try {
    tempHandle = await open(tempPath, "w");
    reader = createInterface({
      input: createReadStream(options.target, { encoding: "utf8" }),
      crlfDelay: Infinity
    });
    for await (const line of reader) {
      totalLinesBefore += 1;
      if (totalLinesBefore === options.startLine) {
        await insertReplacement();
      }
      if (
        totalLinesBefore >= options.startLine &&
        totalLinesBefore < options.startLine + options.deleteLineCount
      ) {
        skippedLineCount += 1;
        continue;
      }
      await writeOutputLine(line);
    }

    if (options.startLine === totalLinesBefore + 1) {
      await insertReplacement();
    }
    if (options.startLine > totalLinesBefore + 1) {
      console.warn("[fs-tools] 行级写入 startLine 超出可编辑范围", {
        path: options.path,
        startLine: options.startLine,
        totalLines: totalLinesBefore
      });
      throw new Error(`startLine 超出文件范围：${options.startLine}，当前文件共 ${totalLinesBefore} 行`);
    }
    if (skippedLineCount < options.deleteLineCount) {
      console.warn("[fs-tools] 行级写入 deleteLineCount 超出文件范围", {
        path: options.path,
        startLine: options.startLine,
        deleteLineCount: options.deleteLineCount,
        skippedLineCount,
        totalLines: totalLinesBefore
      });
      throw new Error(
        `deleteLineCount 超出文件范围：从第 ${options.startLine} 行起只能删除 ${skippedLineCount} 行`
      );
    }

    await tempHandle.close();
    tempHandle = undefined;
    await rename(tempPath, options.target);
    console.info("[fs-tools] 行级写入完成", {
      path: options.path,
      startLine: options.startLine,
      deleteLineCount: options.deleteLineCount,
      insertedLineCount: replacementLines.length,
      totalLinesBefore,
      totalLinesAfter
    });
    return {
      insertedLineCount: replacementLines.length,
      totalLinesBefore,
      totalLinesAfter
    };
  } catch (error) {
    reader?.close();
    if (tempHandle) {
      await tempHandle.close().catch(() => undefined);
    }
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

function splitReplacementLines(text: string): string[] {
  if (text.length === 0) {
    return [];
  }
  return text.replace(/\r?\n$/, "").split(/\r?\n/);
}

function requirePositiveInteger(
  value: unknown,
  toolName: string,
  fieldName: string,
  context: Record<string, unknown>
): number {
  if (!Number.isInteger(value) || typeof value !== "number" || value < 1) {
    console.warn(`[fs-tools] ${toolName} 行参数非法`, {
      ...context,
      fieldName,
      value
    });
    throw new Error(`${toolName} 的 ${fieldName} 必须是正整数`);
  }
  return value;
}

function requireNonNegativeInteger(
  value: unknown,
  toolName: string,
  fieldName: string,
  context: Record<string, unknown>
): number {
  if (!Number.isInteger(value) || typeof value !== "number" || value < 0) {
    console.warn(`[fs-tools] ${toolName} 行参数非法`, {
      ...context,
      fieldName,
      value
    });
    throw new Error(`${toolName} 的 ${fieldName} 必须是非负整数`);
  }
  return value;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
