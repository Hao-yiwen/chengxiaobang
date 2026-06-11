import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { globFiles, safeResolve, searchFiles } from "./workspace";
import { textResult } from "./tool-result";

const listDirectoryParams = Type.Object({
  path: Type.Optional(Type.String({ description: "相对工作目录的路径，默认当前目录 '.'" }))
});

const readFileParams = Type.Object({
  path: Type.String({ description: "相对工作目录的文件路径" })
});

const writeFileParams = Type.Object({
  path: Type.String({ description: "相对工作目录的文件路径" }),
  content: Type.String({ description: "要写入的完整文本内容" })
});

const editFileParams = Type.Object({
  path: Type.String({ description: "相对工作目录的文件路径" }),
  oldText: Type.String({ description: "需要被替换的原文（需在文件中唯一可定位）" }),
  newText: Type.String({ description: "替换后的新文本" })
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
    description: "读取工作目录中某个文本文件的全部内容。",
    parameters: readFileParams,
    execute: async (_id, params) => {
      const target = safeResolve(workspacePath, params.path);
      return textResult(await readFile(target, "utf8"));
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
      const source = await readFile(target, "utf8");
      if (!source.includes(params.oldText)) {
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
