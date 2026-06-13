/**
 * Markdown 渲染层保留的纯函数工具。
 *
 * Streamdown 已接管代码块、链接、未闭合 Markdown 修复和流式分块；这里仅保留
 * 项目侧仍需要的表格数字列启发式，便于用 DESIGN token 做右对齐和等宽数字。
 */

/** 与 Streamdown/rehype 兼容的最小 hast 节点视图。 */
export interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  children?: HastNode[];
  properties?: Record<string, unknown>;
}

/** 拼接 hast 子树里的纯文本内容，用于表格单元格内容统计。 */
export function hastText(node: HastNode | undefined): string {
  if (!node) {
    return "";
  }
  if (node.type === "text") {
    return node.value ?? "";
  }
  return (node.children ?? []).map(hastText).join("");
}

/** 数字单元格：可选正负号，千分位或纯数字，可选小数，可选百分号。 */
export const NUMERIC_CELL_RE = /^[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?%?$/;

/** 严格超过 60% 的表体单元格匹配数字模式时，该列视为数字列。 */
export const NUMERIC_COLUMN_RATIO = 0.6;

export function isNumericCellText(text: string): boolean {
  return NUMERIC_CELL_RE.test(text.trim());
}

/**
 * Rehype 插件：给数字列的 td 打 `data-numeric-col` 标记。
 *
 * 统计口径：只统计表体行，空单元格计入分母但不匹配；只标记 td，不标记 th。
 */
export function rehypeNumericTables() {
  return (tree: HastNode): void => {
    walkTables(tree);
  };
}

function walkTables(node: HastNode): void {
  if (node.tagName === "table") {
    markNumericColumns(node);
  }
  for (const child of node.children ?? []) {
    walkTables(child);
  }
}

function markNumericColumns(table: HastNode): void {
  const bodyRows = tableBodyRows(table);
  const cellsPerRow = bodyRows.map((row) =>
    (row.children ?? []).filter((cell) => cell.tagName === "td" || cell.tagName === "th")
  );
  const columnCount = Math.max(0, ...cellsPerRow.map((cells) => cells.length));

  for (let column = 0; column < columnCount; column += 1) {
    const cells = cellsPerRow
      .map((rowCells) => rowCells[column])
      .filter((cell): cell is HastNode => cell !== undefined);
    if (cells.length === 0) {
      continue;
    }

    const numeric = cells.filter((cell) => isNumericCellText(hastText(cell))).length;
    if (numeric / cells.length > NUMERIC_COLUMN_RATIO) {
      for (const cell of cells) {
        if (cell.tagName === "td") {
          cell.properties = { ...cell.properties, dataNumericCol: "" };
        }
      }
    }
  }
}

/** 表体行 = thead 之外的 tr，兼容 table 直挂、tbody 和 tfoot 三种形状。 */
function tableBodyRows(table: HastNode): HastNode[] {
  const rows: HastNode[] = [];
  for (const section of table.children ?? []) {
    if (section.tagName === "tr") {
      rows.push(section);
    } else if (section.tagName === "tbody" || section.tagName === "tfoot") {
      rows.push(...(section.children ?? []).filter((child) => child.tagName === "tr"));
    }
  }
  return rows;
}
