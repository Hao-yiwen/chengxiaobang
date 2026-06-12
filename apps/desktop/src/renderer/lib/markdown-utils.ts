/**
 * Pure helpers behind the Markdown renderer (components/Markdown.tsx).
 * Dependency-free and node-testable.
 */

/** Minimal structural view of a hast node, compatible with react-markdown's. */
export interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  children?: HastNode[];
  properties?: Record<string, unknown>;
}

/** Only http(s) links are linkified — the main process opens those externally. */
export function isSafeHref(href: string): boolean {
  return /^https?:\/\//i.test(href);
}

/** Concatenated text content of a hast subtree (e.g. highlighted code spans). */
export function hastText(node: HastNode | undefined): string {
  if (!node) {
    return "";
  }
  if (node.type === "text") {
    return node.value ?? "";
  }
  return (node.children ?? []).map(hastText).join("");
}

/** Extracts `x` from a `language-x` class, given a string or hast class list. */
export function languageFromClass(className: unknown): string | undefined {
  const classes = Array.isArray(className)
    ? className.map(String)
    : typeof className === "string"
      ? className.split(/\s+/)
      : [];
  const entry = classes.find((value) => value.startsWith("language-"));
  return entry ? entry.slice("language-".length).toLowerCase() : undefined;
}

/**
 * Rehype plugin tagging `pre > code` with `data-code-block` so the `code`
 * renderer can tell blocks from inline code — class names alone can't, since
 * rehype-highlight leaves language-less blocks untouched.
 */
export function rehypeMarkCodeBlocks() {
  return (tree: HastNode): void => {
    walk(tree);
  };
}

function walk(node: HastNode): void {
  for (const child of node.children ?? []) {
    if (node.tagName === "pre" && child.tagName === "code") {
      child.properties = { ...child.properties, dataCodeBlock: "" };
    }
    walk(child);
  }
}

/* ------------------------------------------------------------------------ *
 * 表格数字列启发式（UI-SPEC §5 table）：>60% 单元格匹配数字模式即右对齐 + tnum。
 * ------------------------------------------------------------------------ */

/** 「数字模式」：可选正负号，千分位或纯数字，可选小数，可选百分号。 */
export const NUMERIC_CELL_RE = /^[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?%?$/;

/** §5 阈值：严格大于 60% 的单元格匹配数字模式时该列右对齐。 */
export const NUMERIC_COLUMN_RATIO = 0.6;

export function isNumericCellText(text: string): boolean {
  return NUMERIC_CELL_RE.test(text.trim());
}

/**
 * Rehype plugin：按列内容启发式给数字列的 `td` 打 `data-numeric-col` 标记
 * （UI-SPEC §5：>60% 单元格匹配数字模式即右对齐 + tnum）。
 * 统计口径：以列内全部表体单元格为分母（空单元格不匹配、计入分母），
 * 仅标记 `td`——th 按规格恒左对齐。GFM 表无 colspan，列号即行内序。
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

/** 表体行 = thead 之外的所有 tr（直挂 table、tbody、tfoot 下均算）。 */
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

/* ------------------------------------------------------------------------ *
 * 流式墨点光标定位（UI-SPEC §4.1）：appendCaret 时找到尾块最后一个块级元素。
 * ------------------------------------------------------------------------ */

/** 视为「可继续下钻」的块级容器/宿主标签。 */
const CARET_BLOCK_TAGS = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
  "td",
  "th",
  "pre",
  "ul",
  "ol",
  "blockquote",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "hr"
]);

/**
 * Rehype plugin（仅在 Markdown 的 appendCaret=true 时挂载）：沿「最后一个块级
 * 子元素」一路下钻，给最终宿主打标——
 * - 普通文本块（p/h1–h4/li/td/blockquote…）打 `data-caret-host`，覆写组件在
 *   children 末尾行内追加 `.ink-caret`；
 * - `pre`（代码块尾块）打 `data-caret-block`，光标改挂代码块下一行行首，且
 *   CodeBlock 进入流式纯文本模式（§4.4）。
 */
export function rehypeMarkCaretHost() {
  return (tree: HastNode): void => {
    let node = lastElementChild(tree);
    if (!node) {
      return; // 空文档：无宿主，光标由调用方（StreamingMarkdown）自行兜底
    }
    for (;;) {
      const last = lastElementChild(node);
      if (last?.tagName !== undefined && CARET_BLOCK_TAGS.has(last.tagName)) {
        node = last;
        continue;
      }
      break;
    }
    const key = node.tagName === "pre" ? "dataCaretBlock" : "dataCaretHost";
    node.properties = { ...node.properties, [key]: "" };
  };
}

function lastElementChild(node: HastNode): HastNode | undefined {
  const children = node.children ?? [];
  for (let index = children.length - 1; index >= 0; index -= 1) {
    if (children[index].type === "element") {
      return children[index];
    }
  }
  return undefined;
}
