#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { readPptxZip, removePath } from "./lib/pptx-ooxml.mjs";

export async function unpackPptx(inputPath, outputDir) {
  console.info("[pptx-unpack] 开始解包 PPTX", { inputPath, outputDir });
  await removePath(outputDir);
  await mkdir(outputDir, { recursive: true });
  const zip = readPptxZip(inputPath);
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) {
      continue;
    }
    const target = join(outputDir, entry.entryName);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, entry.getData());
  }
  console.info("[pptx-unpack] PPTX 解包完成", { inputPath, outputDir, files: zip.getEntries().length });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , input, output = "unpacked-pptx"] = process.argv;
  if (!input) {
    console.error("用法: node pptx-unpack.mjs <input.pptx> [output-dir]");
    process.exit(1);
  }
  await unpackPptx(input, output);
}
