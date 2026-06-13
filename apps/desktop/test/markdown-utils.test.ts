import { describe, expect, it } from "vitest";
import {
  hastText,
  isNumericCellText,
  rehypeNumericTables,
  type HastNode
} from "../src/renderer/lib/markdown-utils";

describe("hastText", () => {
  it("collects text across nested hast spans", () => {
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

    expect(bodyCell(table, 0, 1).properties?.dataNumericCol).toBe("");
    expect(bodyCell(table, 1, 1).properties?.dataNumericCol).toBe("");
    expect(bodyCell(table, 2, 1).properties?.dataNumericCol).toBe("");
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
