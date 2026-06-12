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

/** Maps a unified diff body to DiffView's line model; headers and noise drop. */
export function unifiedDiffToLines(diff: string): DiffLine[] {
  const lines: DiffLine[] = [];
  for (const line of diff.split("\n")) {
    if (HEADER_PREFIXES.some((prefix) => line.startsWith(prefix))) {
      continue;
    }
    if (line.startsWith("+")) {
      lines.push({ type: "added", text: line.slice(1) });
    } else if (line.startsWith("-")) {
      lines.push({ type: "removed", text: line.slice(1) });
    } else if (line.startsWith(" ")) {
      lines.push({ type: "context", text: line.slice(1) });
    } else if (line.startsWith("@@")) {
      lines.push({ type: "context", text: line });
    }
    // Anything else (blank separators between blocks, shell noise) drops.
  }
  return lines;
}

export type GitStatusKind = "untracked" | "added" | "deleted" | "renamed" | "modified";

/** Collapses a porcelain XY status code into a label kind for the changes list. */
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
