import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { runCommand } from "./shell";
import { textResult } from "./tool-result";

const shellParams = Type.Object({
  command: Type.String({ description: "要执行的 shell 命令" })
});

const noParams = Type.Object({});

async function runShell(command: string, cwd: string): Promise<string> {
  const { output, exitCode } = await runCommand(command, cwd);
  if (exitCode !== 0) {
    throw new Error(output || `命令退出码 ${exitCode}`);
  }
  return output || "（命令无输出）";
}

export function createShellTools(workspacePath: string): AgentTool<any>[] {
  const shellTool: AgentTool<typeof shellParams> = {
    name: "shell",
    label: "执行命令",
    description: "在工作目录中执行一条 shell 命令并返回输出。用于构建、安装依赖、运行脚本等。",
    parameters: shellParams,
    execute: async (_id, params) => textResult(await runShell(params.command, workspacePath))
  };

  const gitStatus: AgentTool<typeof noParams> = {
    name: "git_status",
    label: "Git 状态",
    description: "查看工作目录的 git 状态摘要。",
    parameters: noParams,
    execute: async () => textResult(await runShell("git status --short --branch", workspacePath))
  };

  const gitDiff: AgentTool<typeof noParams> = {
    name: "git_diff",
    label: "Git 变更",
    description: "查看工作目录的 git 变更摘要与 diff 检查。",
    parameters: noParams,
    execute: async () =>
      textResult(await runShell("git diff --stat && git diff --check", workspacePath))
  };

  return [shellTool, gitStatus, gitDiff];
}
