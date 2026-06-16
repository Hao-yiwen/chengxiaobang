import type { DiffLine } from "@/lib/diff";

const HEADER_PREFIXES = [
  "diff --git ",
  "index ",
  "--- ",
  "+++ ",
  "new file mode",
  "deleted file mode",
  "old mode",
  "new mode",
  "similarity index",
  "rename from",
  "rename to",
  "copy from",
  "copy to",
  "Binary files",
  "\\ No newline"
];

/** 将 unified diff 映射成 DiffView 的行模型，同时保留可展示的新旧行号。 */
export function unifiedDiffToLines(diff: string): DiffLine[] {
  const lines: DiffLine[] = [];
  let oldLineNumber: number | undefined;
  let newLineNumber: number | undefined;
  for (const line of diff.split("\n")) {
    if (HEADER_PREFIXES.some((prefix) => line.startsWith(prefix))) {
      continue;
    }
    if (line.startsWith("@@")) {
      const hunk = parseHunkHeader(line);
      oldLineNumber = hunk?.oldStart;
      newLineNumber = hunk?.newStart;
      lines.push({ type: "context", text: line, hunk: true });
      continue;
    }
    if (line.startsWith("+")) {
      lines.push({ type: "added", text: line.slice(1), newLineNumber });
      newLineNumber = incrementLineNumber(newLineNumber);
    } else if (line.startsWith("-")) {
      lines.push({ type: "removed", text: line.slice(1), oldLineNumber });
      oldLineNumber = incrementLineNumber(oldLineNumber);
    } else if (line.startsWith(" ")) {
      lines.push({ type: "context", text: line.slice(1), oldLineNumber, newLineNumber });
      oldLineNumber = incrementLineNumber(oldLineNumber);
      newLineNumber = incrementLineNumber(newLineNumber);
    }
    // 其他空行分隔、shell 启动噪音等不属于 diff 内容，直接丢弃。
  }
  return lines;
}

export type GitStatusKind = "untracked" | "added" | "deleted" | "renamed" | "modified";

/** 将 porcelain XY 状态码收敛成 UI 标签类型。 */
export function gitStatusKind(status: string): GitStatusKind {
  if (status === "??") {
    return "untracked";
  }
  if (status.includes("A")) {
    return "added";
  }
  if (status.includes("D")) {
    return "deleted";
  }
  if (status.includes("R")) {
    return "renamed";
  }
  return "modified";
}

export interface GitChangeStats {
  additions: number;
  deletions: number;
}

/** 汇总多个文件 diff 的新增/删除行数，跳过 diff 头部元信息。 */
export function gitChangeStats(files: Array<{ diff: string }>): GitChangeStats {
  return files.reduce<GitChangeStats>(
    (stats, file) => {
      for (const line of file.diff.split("\n")) {
        if (line.startsWith("+++") || line.startsWith("---")) {
          continue;
        }
        if (line.startsWith("+")) {
          stats.additions += 1;
        } else if (line.startsWith("-")) {
          stats.deletions += 1;
        }
      }
      return stats;
    },
    { additions: 0, deletions: 0 }
  );
}

function parseHunkHeader(line: string): { oldStart: number; newStart: number } | undefined {
  const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/u.exec(line);
  if (!match) {
    return undefined;
  }
  return { oldStart: Number(match[1]), newStart: Number(match[2]) };
}

function incrementLineNumber(value: number | undefined): number | undefined {
  return value === undefined ? undefined : value + 1;
}
