#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { buildPptx } from "./lib/pptx-builder.mjs";

function ensureExtension(target, ext) {
  return target.toLowerCase().endsWith(ext) ? target : `${target}${ext}`;
}

async function main() {
  const [, , inputPath, outputPath] = process.argv;
  if (!inputPath) {
    throw new Error("用法: node create-pptx.mjs <deck-json-path> [output-pptx-path]");
  }
  const inputFile = resolve(process.cwd(), inputPath);
  console.info("[ppt-script] 开始读取 deck 规格", { inputFile });
  const spec = JSON.parse(await readFile(inputFile, "utf8"));
  const deck = spec.deck ?? spec;
  const target = ensureExtension(resolve(process.cwd(), outputPath ?? spec.path ?? "演示文稿.pptx"), ".pptx");
  console.info("[ppt-script] 开始生成 PPT", {
    target,
    slides: Array.isArray(deck.slides) ? deck.slides.length : 1
  });
  const buffer = await buildPptx(deck);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, buffer);
  console.info("[ppt-script] PPT 生成完成", { target, bytes: buffer.length });
  console.log(`已生成演示文稿 ${target}（共 ${Array.isArray(deck.slides) ? deck.slides.length : 1} 页）`);
}

main().catch((error) => {
  console.error("[ppt-script] PPT 生成失败", {
    error: error instanceof Error ? error.message : String(error)
  });
  process.exitCode = 1;
});
