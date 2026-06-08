import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { nowIso, type ToolCall, type ToolName } from "@chengxiaobang/shared";

export interface ToolRequest {
  name: ToolName;
  args: Record<string, unknown>;
}

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

export function requiresApproval(name: ToolName): boolean {
  return name === "write_file" || name === "edit_file" || name === "shell";
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
    if (name === "git_status") {
      return runShell("git status --short --branch", basePath);
    }
    if (name === "git_diff") {
      return runShell("git diff --stat && git diff --check", basePath);
    }
    if (name === "shell") {
      return runShell(stringArg(args.command), basePath);
    }
    throw new Error(`未知工具: ${name satisfies never}`);
  }
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
    }, 30_000);

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
        resolvePromise(output);
      } else {
        reject(new Error(output || `命令退出码 ${code}`));
      }
    });
  });
}
