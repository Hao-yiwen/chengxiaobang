import { isAbsolute, win32 } from "node:path";
import type { ToolCallApproval } from "@chengxiaobang/shared";
import { isMutatingTool } from "./registry";
import { isPathOutsideWorkspace } from "./workspace";

export interface ToolApprovalAssessment {
  risk: ToolCallApproval["risk"];
  requiresGate: boolean;
  reason: string;
  smartVerdict?: ToolCallApproval["verdict"];
}

export interface ToolApprovalContext {
  workspacePath?: string;
  platform?: NodeJS.Platform;
}

export function assessToolApprovalRisk(
  toolName: string,
  args: Record<string, unknown>,
  context: ToolApprovalContext = {}
): ToolApprovalAssessment {
  if (!isMutatingTool(toolName)) {
    return {
      risk: "low",
      requiresGate: false,
      reason: "只读工具可直接执行。"
    };
  }

  if (toolName === "write_file" || toolName === "edit_file" || toolName === "make_directory") {
    const path = typeof args.path === "string" ? args.path : "";
    if (isSensitivePath(path)) {
      return {
        risk: "high",
        requiresGate: true,
        smartVerdict: "ask_user",
        reason: `工具会修改敏感文件 ${path || "（路径缺失）"}，需要你确认。`
      };
    }
    if (isExplicitOutsideWorkspace(path, context.workspacePath, context.platform)) {
      return {
        risk: "high",
        requiresGate: true,
        smartVerdict: "ask_user",
        reason: `工具会修改工作目录外的绝对路径 ${path}，需要你确认。`
      };
    }
    return {
      risk: "low",
      requiresGate: false,
      reason: "普通项目文件写入属于代码助手的基础操作，已自动放行。"
    };
  }

  if (toolName === "shell") {
    const command = typeof args.command === "string" ? args.command : "";
    const cwd = typeof args.cwd === "string" ? args.cwd : "";
    const dangerous = dangerousShellReason(command);
    if (dangerous) {
      return {
        risk: "high",
        requiresGate: true,
        smartVerdict: "deny",
        reason: dangerous
      };
    }
    const sensitive = sensitiveShellReason(command);
    if (sensitive) {
      return {
        risk: "high",
        requiresGate: true,
        smartVerdict: "ask_user",
        reason: sensitive
      };
    }
    if (isExplicitOutsideWorkspace(cwd, context.workspacePath, context.platform)) {
      return {
        risk: "high",
        requiresGate: true,
        smartVerdict: "ask_user",
        reason: `命令将在工作目录外的绝对路径 ${cwd} 中执行，需要你确认。`
      };
    }
    if (isLowRiskShellCommand(command)) {
      return {
        risk: "low",
        requiresGate: false,
        reason: "常规只读或验证类命令，已自动放行。"
      };
    }
    return {
      risk: "medium",
      requiresGate: true,
      smartVerdict: "allow",
      reason: "命令未命中危险或敏感规则，智能审批自动同意执行。"
    };
  }

  if (toolName === "feishu_send_message") {
    return {
      risk: "high",
      requiresGate: true,
      smartVerdict: "ask_user",
      reason: "工具会向外部飞书会话发送消息，需要你确认。"
    };
  }

  if (toolName === "schedule_create" || toolName === "schedule_cancel") {
    return {
      risk: "medium",
      requiresGate: true,
      smartVerdict: "ask_user",
      reason: "工具会改变后台定时任务，需要你确认。"
    };
  }

  if (toolName === "create_skill") {
    return {
      risk: "medium",
      requiresGate: true,
      smartVerdict: "ask_user",
      reason: "工具会安装或创建技能并改变后续可用能力，需要你确认。"
    };
  }

  return {
    risk: "medium",
    requiresGate: true,
    reason: "工具带有写入或副作用能力，需要进一步确认。"
  };
}

export function isSensitivePath(path: string): boolean {
  return /(^|[\\/])(?:\.env(?:$|[.\\/ -])|\.npmrc(?:$|[.\\/ -])|\.pypirc(?:$|[.\\/ -])|\.netrc(?:$|[.\\/ -])|id_rsa(?:$|[.\\/ -])|id_ed25519(?:$|[.\\/ -])|credentials?(?:$|[.\\/ -])|secrets?(?:$|[.\\/ -])|private[-_]?key(?:$|[.\\/ -]))/i.test(
    path
  );
}

function isExplicitOutsideWorkspace(
  path: string,
  workspacePath?: string,
  platform: NodeJS.Platform = process.platform
): boolean {
  const pathIsAbsolute = platform === "win32" ? win32.isAbsolute(path) : isAbsolute(path);
  if (!path || !pathIsAbsolute) {
    return false;
  }
  return workspacePath ? isPathOutsideWorkspace(workspacePath, path, platform) : true;
}

export function dangerousShellReason(command: string): string | undefined {
  const normalized = normalizeCommand(command);
  if (/\brm\s+[^;&|]*-(?:[a-z]*r[a-z]*f|[a-z]*f[a-z]*r|[a-z]*r)\b/.test(normalized)) {
    return "命令包含递归删除，智能审批已拒绝。";
  }
  if (/\b(?:mkfs|diskutil|shutdown|reboot)\b/.test(normalized)) {
    return "命令包含系统级破坏或重启操作，智能审批已拒绝。";
  }
  if (/\bdd\s+[^;&|]*\b(?:if|of)=/.test(normalized)) {
    return "命令包含 dd 设备写入/读取操作，智能审批已拒绝。";
  }
  if (/\bgit\s+reset\s+--hard\b/.test(normalized)) {
    return "命令会硬重置 Git 工作区，智能审批已拒绝。";
  }
  if (/\bgit\s+clean\s+-[a-z]*[fdx][a-z]*/.test(normalized)) {
    return "命令会清理未跟踪文件，智能审批已拒绝。";
  }
  if (/\bgit\s+checkout\s+--\b/.test(normalized)) {
    return "命令会丢弃工作区文件改动，智能审批已拒绝。";
  }
  if (/\bgit\s+push\b[^;&|]*\s--force(?:-with-lease)?\b/.test(normalized)) {
    return "命令包含强制推送，智能审批已拒绝。";
  }
  if (/\bsecurity\s+delete\b/.test(normalized)) {
    return "命令会删除钥匙串内容，智能审批已拒绝。";
  }
  if (/(^|[;&|]\s*)(?:del|erase)\b[^;&|]*\/s\b/.test(normalized)) {
    return "命令包含递归删除文件，智能审批已拒绝。";
  }
  if (/(^|[;&|]\s*)(?:rd|rmdir)\b[^;&|]*\/s\b/.test(normalized)) {
    return "命令包含递归删除目录，智能审批已拒绝。";
  }
  if (/(^|[;&|]\s*)format(?:\.com)?(?:\s|$)/.test(normalized)) {
    return "命令包含格式化磁盘操作，智能审批已拒绝。";
  }
  if (/(^|[;&|]\s*)reg(?:\.exe)?\s+delete\b/.test(normalized)) {
    return "命令会删除 Windows 注册表项，智能审批已拒绝。";
  }
  if (
    /\b(?:powershell|pwsh)(?:\.exe)?\b[^;&|]*\bremove-item\b[^;&|]*(?:-(?:r|recurse|force)\b)/.test(
      normalized
    )
  ) {
    return "命令包含 PowerShell 递归或强制删除，智能审批已拒绝。";
  }
  return undefined;
}

export function sensitiveShellReason(command: string): string | undefined {
  const normalized = normalizeCommand(command);
  if (/(?:curl|wget)[^|;&]+[|]\s*(?:sh|bash|zsh)\b/.test(normalized)) {
    return "命令会执行远程下载脚本，需要你确认。";
  }
  if (/\bsudo\b/.test(normalized)) {
    return "命令需要 sudo 权限，需要你确认。";
  }
  if (/\b(?:killall|pkill)\b/.test(normalized)) {
    return "命令会终止进程，需要你确认。";
  }
  if (/\b(?:taskkill|stop-process|stop-service)\b/.test(normalized)) {
    return "命令会终止 Windows 进程或服务，需要你确认。";
  }
  if (/(^|[;&|]\s*)(?:net|sc)(?:\.exe)?\s+stop\b/.test(normalized)) {
    return "命令会停止 Windows 服务，需要你确认。";
  }
  if (/\bchmod\s+(?:-r\s+)?777\b/.test(normalized) || /\b(?:chmod|chown)\s+-r\b/.test(normalized)) {
    return "命令会批量修改权限或归属，需要你确认。";
  }
  if (/\b(?:npm|pnpm|bun)\s+publish\b/.test(normalized)) {
    return "命令会发布包到外部仓库，需要你确认。";
  }
  return undefined;
}

function isLowRiskShellCommand(command: string): boolean {
  const normalized = normalizeCommand(command);
  if (!normalized || /[>|`$()]/.test(normalized) || /\|\s*(?:sh|bash|zsh)\b/.test(normalized)) {
    return false;
  }
  return normalized
    .split(/\s+&&\s+/)
    .every((part) => LOW_RISK_SHELL_PATTERNS.some((pattern) => pattern.test(part)));
}

function normalizeCommand(command: string): string {
  return command.toLowerCase().replace(/\s+/g, " ").trim();
}

const LOW_RISK_SHELL_PATTERNS = [
  /^pwd$/,
  /^ls(?:\s|$)/,
  /^find(?:\s|$)/,
  /^rg(?:\s|$)/,
  /^grep(?:\s|$)/,
  /^cat(?:\s|$)/,
  /^sed\s+-n(?:\s|$)/,
  /^head(?:\s|$)/,
  /^tail(?:\s|$)/,
  /^wc(?:\s|$)/,
  /^dir(?:\s|$)/,
  /^type\s+[^;&|>]+$/,
  /^where(?:\.exe)?(?:\s|$)/,
  /^findstr(?:\s|$)/,
  /^ver$/,
  /^git\s+(?:status|diff|show|log|branch|rev-parse|ls-files)(?:\s|$)/,
  /^(?:pnpm|npm|bun)\s+(?:test|run\s+test|typecheck|run\s+typecheck|lint|run\s+lint|build|run\s+build|dev|run\s+dev|start|run\s+start|preview|run\s+preview|storybook|run\s+storybook)(?:\s|$)/,
  /^bun\s+test(?:\s|$)/,
  /^vitest(?:\s|$)/,
  /^tsc\s+--noemit(?:\s|$)/,
  /^(?:node|pnpm|npm|bun)\s+--version$/,
  /^echo\s+[^;&|]+$/
];
