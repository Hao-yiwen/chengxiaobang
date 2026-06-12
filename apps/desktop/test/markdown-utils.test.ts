import { describe, expect, it } from "vitest";
import {
  hastText,
  isNumericCellText,
  isSafeHref,
  languageFromClass,
  rehypeMarkCaretHost,
  rehypeMarkCodeBlocks,
  rehypeNumericTables,
  type HastNode
} from "../src/renderer/lib/markdown-utils";

describe("isSafeHref", () => {
  it("accepts http and https", () => {
    expect(isSafeHref("https://example.com")).toBe(true);
    expect(isSafeHref("http://example.com/path?a=1")).toBe(true);
    expect(isSafeHref("HTTPS://EXAMPLE.COM")).toBe(true);
  });

  it("rejects other protocols and empty strings", () => {
    expect(isSafeHref("javascript:alert(1)")).toBe(false);
    expect(isSafeHref("mailto:a@b.com")).toBe(false);
    expect(isSafeHref("file:///etc/passwd")).toBe(false);
    expect(isSafeHref("")).toBe(false);
    expect(isSafeHref("//example.com")).toBe(false);
  });
});

describe("hastText", () => {
  it("collects text across nested highlight spans", () => {
    const node: HastNode = {
      type: "element",
      tagName: "code",
      children: [
        {
          type: "element",
          tagName: "span",
          children: [{ type: "text", value: "const" }]
        },
        { type: "text", value: " x = " },
        {
          type: "element",
          tagName: "span",
          children: [{ type: "text", value: "1" }]
        },
        { type: "text", value: ";" }
      ]
    };
    expect(hastText(node)).toBe("const x = 1;");
  });

  it("returns empty string for undefined or empty nodes", () => {
    expect(hastText(undefined)).toBe("");
    expect(hastText({ type: "element", tagName: "code" })).toBe("");
  });
});

describe("languageFromClass", () => {
  it("reads hast class arrays", () => {
    expect(languageFromClass(["hljs", "language-ts"])).toBe("ts");
    expect(languageFromClass(["language-Python"])).toBe("python");
  });

  it("reads class strings", () => {
    expect(languageFromClass("hljs language-tsx")).toBe("tsx");
  });

  it("returns undefined when no language class is present", () => {
    expect(languageFromClass(["hljs"])).toBeUndefined();
    expect(languageFromClass(undefined)).toBeUndefined();
  });
});

describe("rehypeMarkCodeBlocks", () => {
  it("tags only code elements directly inside pre", () => {
    const inline: HastNode = { type: "element", tagName: "code", properties: {} };
    const block: HastNode = { type: "element", tagName: "code", properties: {} };
    const tree: HastNode = {
      type: "root",
      children: [
        { type: "element", tagName: "p", children: [inline] },
        { type: "element", tagName: "pre", children: [block] }
      ]
    };

    rehypeMarkCodeBlocks()(tree);

    expect(block.properties?.dataCodeBlock).toBe("");
    expect(inline.properties?.dataCodeBlock).toBeUndefined();
  });
});

describe("isNumericCellText", () => {
  it("matches integers, decimals, thousand separators, signs and percent", () => {
    expect(isNumericCellText("42")).toBe(true);
    expect(isNumericCellText("3.5")).toBe(true);
    expect(isNumericCellText("1,200")).toBe(true);
    expect(isNumericCellText("12,345,678.90")).toBe(true);
    expect(isNumericCellText("-42%")).toBe(true);
    expect(isNumericCellText("+5")).toBe(true);
    expect(isNumericCellText("  8080  ")).toBe(true);
  });

  it("rejects non-numeric text and empty cells", () => {
    expect(isNumericCellText("")).toBe(false);
    expect(isNumericCellText("x1")).toBe(false);
    expect(isNumericCellText("1 200")).toBe(false);
    expect(isNumericCellText("v1.2.3")).toBe(false);
    expect(isNumericCellText("端口")).toBe(false);
  });
});

function cell(tag: "td" | "th", text: string): HastNode {
  return {
    type: "element",
    tagName: tag,
    properties: {},
    children: [{ type: "text", value: text }]
  };
}

function row(cells: HastNode[]): HastNode {
  return { type: "element", tagName: "tr", children: cells };
}

/** GFM 形状的表：thead 一行 th + tbody 若干行 td。 */
function gfmTable(header: string[], body: string[][]): HastNode {
  return {
    type: "element",
    tagName: "table",
    children: [
      { type: "element", tagName: "thead", children: [row(header.map((h) => cell("th", h)))] },
      {
        type: "element",
        tagName: "tbody",
        children: body.map((cells) => row(cells.map((c) => cell("td", c))))
      }
    ]
  };
}

function bodyCell(table: HastNode, rowIndex: number, colIndex: number): HastNode {
  const tbody = (table.children ?? []).find((c) => c.tagName === "tbody")!;
  return (tbody.children ?? [])[rowIndex].children![colIndex];
}

describe("rehypeNumericTables", () => {
  it("marks td cells of columns where >60% match the numeric pattern", () => {
    const table = gfmTable(
      ["名称", "金额"],
      [
        ["a", "1,200"],
        ["b", "3.5"],
        ["c", "x"]
      ]
    );
    const tree: HastNode = { type: "root", children: [table] };

    rehypeNumericTables()(tree);

    // 金额列 2/3 ≈ 67% > 60%：整列 td 标记（含未匹配的 "x" 单元格）
    expect(bodyCell(table, 0, 1).properties?.dataNumericCol).toBe("");
    expect(bodyCell(table, 1, 1).properties?.dataNumericCol).toBe("");
    expect(bodyCell(table, 2, 1).properties?.dataNumericCol).toBe("");
    // 名称列 0/3：不标记
    expect(bodyCell(table, 0, 0).properties?.dataNumericCol).toBeUndefined();
  });

  it("requires strictly more than 60% — exactly 3/5 does not qualify", () => {
    const table = gfmTable(
      ["v"],
      [["1"], ["2"], ["3"], ["x"], ["y"]]
    );
    const tree: HastNode = { type: "root", children: [table] };

    rehypeNumericTables()(tree);

    expect(bodyCell(table, 0, 0).properties?.dataNumericCol).toBeUndefined();
  });

  it("counts empty cells against the column ratio", () => {
    const table = gfmTable(
      ["v"],
      [["1"], [""], [""]]
    );
    const tree: HastNode = { type: "root", children: [table] };

    rehypeNumericTables()(tree);

    expect(bodyCell(table, 0, 0).properties?.dataNumericCol).toBeUndefined();
  });

  it("never marks header cells, even above a numeric column", () => {
    const table = gfmTable(["2024"], [["1"], ["2"]]);
    const tree: HastNode = { type: "root", children: [table] };

    rehypeNumericTables()(tree);

    const thead = (table.children ?? []).find((c) => c.tagName === "thead")!;
    const th = thead.children![0].children![0];
    expect(th.properties?.dataNumericCol).toBeUndefined();
    expect(bodyCell(table, 0, 0).properties?.dataNumericCol).toBe("");
  });

  it("finds tables nested deeper in the tree", () => {
    const table = gfmTable(["n"], [["1"], ["2"]]);
    const tree: HastNode = {
      type: "root",
      children: [{ type: "element", tagName: "blockquote", children: [table] }]
    };

    rehypeNumericTables()(tree);

    expect(bodyCell(table, 0, 0).properties?.dataNumericCol).toBe("");
  });
});

function paragraph(text: string): HastNode {
  return {
    type: "element",
    tagName: "p",
    properties: {},
    children: [{ type: "text", value: text }]
  };
}

describe("rehypeMarkCaretHost", () => {
  it("marks the last paragraph, not earlier blocks", () => {
    const first = paragraph("one");
    const last = paragraph("two");
    const tree: HastNode = { type: "root", children: [first, last] };

    rehypeMarkCaretHost()(tree);

    expect(last.properties?.dataCaretHost).toBe("");
    expect(first.properties?.dataCaretHost).toBeUndefined();
  });

  it("descends into the last li of a list", () => {
    const li1: HastNode = {
      type: "element",
      tagName: "li",
      properties: {},
      children: [{ type: "text", value: "a" }]
    };
    const li2: HastNode = {
      type: "element",
      tagName: "li",
      properties: {},
      children: [{ type: "text", value: "b" }]
    };
    const tree: HastNode = {
      type: "root",
      children: [{ type: "element", tagName: "ul", children: [li1, li2] }]
    };

    rehypeMarkCaretHost()(tree);

    expect(li2.properties?.dataCaretHost).toBe("");
    expect(li1.properties?.dataCaretHost).toBeUndefined();
  });

  it("descends through blockquote into its last paragraph", () => {
    const inner = paragraph("quoted");
    const tree: HastNode = {
      type: "root",
      children: [{ type: "element", tagName: "blockquote", children: [paragraph("x"), inner] }]
    };

    rehypeMarkCaretHost()(tree);

    expect(inner.properties?.dataCaretHost).toBe("");
  });

  it("marks a trailing pre with data-caret-block instead", () => {
    const pre: HastNode = {
      type: "element",
      tagName: "pre",
      properties: {},
      children: [{ type: "element", tagName: "code", children: [{ type: "text", value: "x" }] }]
    };
    const tree: HastNode = { type: "root", children: [paragraph("intro"), pre] };

    rehypeMarkCaretHost()(tree);

    expect(pre.properties?.dataCaretBlock).toBe("");
    expect(pre.properties?.dataCaretHost).toBeUndefined();
  });

  it("stops at inline children — a paragraph ending in inline code hosts the caret itself", () => {
    const p: HastNode = {
      type: "element",
      tagName: "p",
      properties: {},
      children: [
        { type: "text", value: "run " },
        { type: "element", tagName: "code", children: [{ type: "text", value: "pnpm dev" }] }
      ]
    };
    const tree: HastNode = { type: "root", children: [p] };

    rehypeMarkCaretHost()(tree);

    expect(p.properties?.dataCaretHost).toBe("");
  });

  it("does nothing on an empty document", () => {
    const tree: HastNode = { type: "root", children: [] };
    expect(() => rehypeMarkCaretHost()(tree)).not.toThrow();
  });
});
