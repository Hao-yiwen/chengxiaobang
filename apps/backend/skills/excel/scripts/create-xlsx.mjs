#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { buildXlsx } from "./lib/xlsx-builder.mjs";

function ensureExtension(target, ext) {
  return target.toLowerCase().endsWith(ext) ? target : `${target}${ext}`;
}

async function main() {
  const [, , inputPath, outputPath] = process.argv;
  if (!inputPath) {
    throw new Error("用法: node create-xlsx.mjs <workbook-json-path> [output-xlsx-path]");
  }
  const inputFile = resolve(process.cwd(), inputPath);
  console.info("[excel-script] 开始读取 workbook 规格", { inputFile });
  const spec = JSON.parse(await readFile(inputFile, "utf8"));
  const workbook = spec.workbook ?? spec;
  const target = ensureExtension(resolve(process.cwd(), outputPath ?? spec.path ?? "表格.xlsx"), ".xlsx");
  console.info("[excel-script] 开始生成 Excel 表格", {
    target,
    sheets: Array.isArray(workbook.sheets) ? workbook.sheets.length : 1
  });
  const buffer = await buildXlsx(workbook);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, buffer);
  console.info("[excel-script] Excel 表格生成完成", { target, bytes: buffer.length });
  console.log(`已生成 Excel 表格 ${target}（${Array.isArray(workbook.sheets) ? workbook.sheets.length : 1} 个工作表）`);
}

main().catch((error) => {
  console.error("[excel-script] Excel 表格生成失败", {
    error: error instanceof Error ? error.message : String(error)
  });
  process.exitCode = 1;
});
