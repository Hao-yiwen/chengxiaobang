import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { buildPptx, type DeckSpec } from "./pptx-builder";
import { buildDocx, type DocSpec } from "./docx-builder";
import { buildXlsx, type WorkbookSpec } from "./xlsx-builder";
import { safeResolve } from "./workspace";
import { textResult } from "./tool-result";

const deckSchema = Type.Object(
  {
    title: Type.Optional(Type.String()),
    subtitle: Type.Optional(Type.String()),
    author: Type.Optional(Type.String()),
    theme: Type.Optional(
      Type.Object({
        primary: Type.Optional(Type.String({ description: "主色，十六进制如 2E5BFF" })),
        accent: Type.Optional(Type.String()),
        background: Type.Optional(Type.String()),
        text: Type.Optional(Type.String())
      })
    ),
    slides: Type.Optional(
      Type.Array(
        Type.Object({
          layout: Type.Optional(
            Type.Union([
              Type.Literal("title"),
              Type.Literal("section"),
              Type.Literal("bullets"),
              Type.Literal("content"),
              Type.Literal("two-column"),
              Type.Literal("quote")
            ])
          ),
          title: Type.Optional(Type.String()),
          subtitle: Type.Optional(Type.String()),
          bullets: Type.Optional(Type.Array(Type.String())),
          paragraphs: Type.Optional(Type.Array(Type.String())),
          columns: Type.Optional(
            Type.Array(
              Type.Object({
                title: Type.Optional(Type.String()),
                bullets: Type.Optional(Type.Array(Type.String()))
              })
            )
          ),
          quote: Type.Optional(Type.String()),
          attribution: Type.Optional(Type.String()),
          notes: Type.Optional(Type.String())
        })
      )
    )
  },
  { description: "演示文稿规格" }
);

const createPptxParams = Type.Object({
  path: Type.String({ description: "输出文件路径，需以 .pptx 结尾" }),
  deck: deckSchema
});

const documentSchema = Type.Object({
  title: Type.Optional(Type.String()),
  subtitle: Type.Optional(Type.String()),
  blocks: Type.Optional(
    Type.Array(
      Type.Object({
        type: Type.Optional(
          Type.Union([
            Type.Literal("heading"),
            Type.Literal("paragraph"),
            Type.Literal("bullets"),
            Type.Literal("ordered"),
            Type.Literal("quote")
          ])
        ),
        level: Type.Optional(Type.Number({ description: "标题级别 1-4" })),
        text: Type.Optional(Type.String()),
        items: Type.Optional(Type.Array(Type.String()))
      })
    )
  )
});

const createDocxParams = Type.Object({
  path: Type.String({ description: "输出文件路径，需以 .docx 结尾" }),
  document: documentSchema
});

const workbookSchema = Type.Object({
  sheets: Type.Optional(
    Type.Array(
      Type.Object({
        name: Type.Optional(Type.String({ description: "工作表名称" })),
        columns: Type.Optional(
          Type.Array(
            Type.Object({
              header: Type.String(),
              key: Type.Optional(Type.String()),
              width: Type.Optional(Type.Number())
            }),
            { description: "列定义（带表头）" }
          )
        ),
        rows: Type.Optional(
          Type.Array(Type.Unknown(), {
            description: "数据行；每行可以是数组（按列顺序）或对象（以列 key 为字段）"
          })
        )
      })
    )
  )
});

const createXlsxParams = Type.Object({
  path: Type.String({ description: "输出文件路径，需以 .xlsx 结尾" }),
  workbook: workbookSchema
});

function ensureExtension(target: string, ext: string): string {
  return target.toLowerCase().endsWith(ext) ? target : `${target}${ext}`;
}

export function createOfficeTools(workspacePath: string): AgentTool<any>[] {
  const createPptx: AgentTool<typeof createPptxParams> = {
    name: "create_pptx",
    label: "生成演示文稿",
    description:
      "根据结构化的 deck 规格生成一个真正的 .pptx 演示文稿文件并写入工作目录。优先使用本工具来“做 PPT / 制作幻灯片”。",
    parameters: createPptxParams,
    execute: async (_id, params) => {
      const target = ensureExtension(safeResolve(workspacePath, params.path), ".pptx");
      const deck = params.deck as DeckSpec;
      const buffer = await buildPptx(deck);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, buffer);
      return textResult(`已生成演示文稿 ${target}（共 ${deck.slides?.length ?? 1} 页）`);
    }
  };

  const createDocx: AgentTool<typeof createDocxParams> = {
    name: "create_docx",
    label: "生成 Word 文档",
    description:
      "根据结构化的文档规格生成一个真正的 .docx Word 文档并写入工作目录。用于“写文档 / 生成报告 / Word”。",
    parameters: createDocxParams,
    execute: async (_id, params) => {
      const target = ensureExtension(safeResolve(workspacePath, params.path), ".docx");
      const buffer = await buildDocx(params.document as DocSpec);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, buffer);
      return textResult(`已生成 Word 文档 ${target}`);
    }
  };

  const createXlsx: AgentTool<typeof createXlsxParams> = {
    name: "create_xlsx",
    label: "生成 Excel 表格",
    description:
      "根据结构化的工作簿规格生成一个真正的 .xlsx Excel 表格并写入工作目录。用于“做表格 / 数据整理 / Excel”。",
    parameters: createXlsxParams,
    execute: async (_id, params) => {
      const target = ensureExtension(safeResolve(workspacePath, params.path), ".xlsx");
      const workbook = params.workbook as WorkbookSpec;
      const buffer = await buildXlsx(workbook);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, buffer);
      return textResult(`已生成 Excel 表格 ${target}（${workbook.sheets?.length ?? 1} 个工作表）`);
    }
  };

  return [createPptx, createDocx, createXlsx];
}
