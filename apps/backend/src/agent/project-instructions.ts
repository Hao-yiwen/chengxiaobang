import { readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Message as PiMessage } from "@earendil-works/pi-ai";

/** 项目指令文件名,按优先级:AGENTS.md 优先,缺失再用 CLAUDE.md(同目录二选一,不合并)。 */
const INSTRUCTION_FILE_NAMES = ["AGENTS.md", "CLAUDE.md"] as const;

/** 项目指令注入上限;过大文件截断,避免撑爆上下文。 */
const MAX_INSTRUCTION_BYTES = 100 * 1024;

export interface ProjectInstructionFile {
  filePath: string;
  content: string;
  truncated: boolean;
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * 从 startDir 逐级向上查找项目指令文件:每层先 AGENTS.md 后 CLAUDE.md,
 * 命中最近一层即返回;遇到 Git 仓库根(存在 .git)或文件系统根即停止向上。
 */
export async function findInstructionFile(
  startDir: string
): Promise<ProjectInstructionFile | undefined> {
  let dir = startDir;
  for (;;) {
    for (const name of INSTRUCTION_FILE_NAMES) {
      const candidate = join(dir, name);
      if (await isFile(candidate)) {
        console.info("[project-instructions] 命中项目指令文件", { filePath: candidate });
        return readInstructionFile(candidate);
      }
    }
    // 指令文件应在仓库范围内:到达仓库根后不再越界向上。
    if (await isDirectory(join(dir, ".git"))) {
      console.debug("[project-instructions] 到达 Git 仓库根,停止向上查找", { dir });
      break;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break; // 文件系统根
    }
    dir = parent;
  }
  console.debug("[project-instructions] 未找到项目指令文件", { startDir });
  return undefined;
}

async function readInstructionFile(filePath: string): Promise<ProjectInstructionFile> {
  const raw = await readFile(filePath, "utf8");
  if (Buffer.byteLength(raw, "utf8") <= MAX_INSTRUCTION_BYTES) {
    return { filePath, content: raw, truncated: false };
  }
  const truncated = Buffer.from(raw, "utf8").subarray(0, MAX_INSTRUCTION_BYTES).toString("utf8");
  console.warn("[project-instructions] 项目指令文件过大,已截断", {
    filePath,
    maxBytes: MAX_INSTRUCTION_BYTES
  });
  return { filePath, content: `${truncated}\n\n（文件已截断）`, truncated: true };
}

/**
 * 构造一条不落库的 user system-reminder 消息,把项目指令以高优先级注入对话最前。
 * 文案对齐 ZCode/Claude Code 的 claudeMd 通道:强调这些指令优先于默认行为。
 */
export function buildProjectInstructionMessage(file: ProjectInstructionFile): PiMessage {
  const content = [
    "<system-reminder>",
    "# 项目指令",
    "以下是代码库与用户的指令,请务必遵守。重要:这些指令优先于默认行为,你必须严格遵照执行。",
    "",
    `${file.filePath} 的内容(项目指令,已纳入代码库):`,
    "",
    file.content,
    "</system-reminder>"
  ].join("\n");
  return { role: "user", content, timestamp: Date.now() };
}
