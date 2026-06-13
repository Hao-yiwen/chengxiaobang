#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { buildDocx } from "./lib/docx-builder.mjs";

function ensureExtension(target, ext) {
  return target.toLowerCase().endsWith(ext) ? target : `${target}${ext}`;
}

async function main() {
  const [, , inputPath, outputPath] = process.argv;
  if (!inputPath) {
    throw new Error("用法: node create-docx.mjs <document-json-path> [output-docx-path]");
  }
  const inputFile = resolve(process.cwd(), inputPath);
  console.info("[word-script] 开始读取 document 规格", { inputFile });
  const spec = JSON.parse(await readFile(inputFile, "utf8"));
  const document = spec.document ?? spec;
  const target = ensureExtension(resolve(process.cwd(), outputPath ?? spec.path ?? "文档.docx"), ".docx");
  console.info("[word-script] 开始生成 Word 文档", { target });
  const buffer = await buildDocx(document);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, buffer);
  console.info("[word-script] Word 文档生成完成", { target, bytes: buffer.length });
  console.log(`已生成 Word 文档 ${target}`);
}

main().catch((error) => {
  console.error("[word-script] Word 文档生成失败", {
    error: error instanceof Error ? error.message : String(error)
  });
  process.exitCode = 1;
});
