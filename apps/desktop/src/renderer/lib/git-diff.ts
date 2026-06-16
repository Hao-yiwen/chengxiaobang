import type { GitChangeScope } from "@chengxiaobang/shared";

export type GitStatusKind = "untracked" | "added" | "deleted" | "renamed" | "modified";

/** 将 porcelain XY 状态码收敛成 UI 标签类型。 */
export function gitStatusKind(status: string, scope?: GitChangeScope): GitStatusKind {
  if (status === "??") {
    return "untracked";
  }
  const code =
    scope === "staged" ? status[0] : scope === "unstaged" ? status[1] : status;
  if (code.includes("A")) {
    return "added";
  }
  if (code.includes("D")) {
    return "deleted";
  }
  if (code.includes("R")) {
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
