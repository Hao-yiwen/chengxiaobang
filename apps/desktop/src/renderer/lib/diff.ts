export interface DiffLine {
  type: "context" | "added" | "removed";
  text: string;
  oldLineNumber?: number;
  newLineNumber?: number;
  hunk?: boolean;
}

/** 超过这个 DP 单元数后，降级为先全删再全增，避免 UI 被大 diff 卡住。 */
const MAX_LCS_CELLS = 100_000;

/**
 * 基于 LCS 的行级 diff，用于展示 Edit / Write 工具结果。
 * 替换会先展示删除行再展示新增行；过大的输入会降级成较粗但正确的展示。
 */
export function diffLines(oldText: string, newText: string): DiffLine[] {
  const oldLines = splitLines(oldText);
  const newLines = splitLines(newText);
  if (oldLines.length === 0) {
    return newLines.map((text) => ({ type: "added" as const, text }));
  }
  if (newLines.length === 0) {
    return oldLines.map((text) => ({ type: "removed" as const, text }));
  }
  if (oldLines.length * newLines.length > MAX_LCS_CELLS) {
    return [
      ...oldLines.map((text) => ({ type: "removed" as const, text })),
      ...newLines.map((text) => ({ type: "added" as const, text }))
    ];
  }

  const rows = oldLines.length;
  const cols = newLines.length;
  const dp = new Uint32Array((rows + 1) * (cols + 1));
  const at = (i: number, j: number) => i * (cols + 1) + j;
  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = cols - 1; j >= 0; j -= 1) {
      dp[at(i, j)] =
        oldLines[i] === newLines[j]
          ? dp[at(i + 1, j + 1)] + 1
          : Math.max(dp[at(i + 1, j)], dp[at(i, j + 1)]);
    }
  }

  const result: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < rows && j < cols) {
    if (oldLines[i] === newLines[j]) {
      result.push({ type: "context", text: oldLines[i] });
      i += 1;
      j += 1;
    } else if (dp[at(i + 1, j)] >= dp[at(i, j + 1)]) {
      result.push({ type: "removed", text: oldLines[i] });
      i += 1;
    } else {
      result.push({ type: "added", text: newLines[j] });
      j += 1;
    }
  }
  while (i < rows) {
    result.push({ type: "removed", text: oldLines[i] });
    i += 1;
  }
  while (j < cols) {
    result.push({ type: "added", text: newLines[j] });
    j += 1;
  }
  return result;
}

function splitLines(text: string): string[] {
  return text === "" ? [] : text.split("\n");
}
