#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdir, readdir } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

export async function renderPptxImages(inputPath, outputDir = "pptx-rendered") {
  const pptxPath = resolve(process.cwd(), inputPath);
  const targetDir = resolve(process.cwd(), outputDir);
  await mkdir(targetDir, { recursive: true });
  const office = findCommand(["soffice", "libreoffice"]);
  const pdftoppm = findCommand(["pdftoppm"]);
  if (!office || !pdftoppm) {
    const missing = [office ? "" : "soffice/libreoffice", pdftoppm ? "" : "pdftoppm"].filter(Boolean);
    const message = `缺少渲染依赖：${missing.join("、")}。已跳过 slide 图片导出，PPTX 生成本身不受影响。`;
    console.warn("[pptx-render-images] " + message, { inputPath: pptxPath, outputDir: targetDir });
    return { ok: false, warning: message, images: [] };
  }
  console.info("[pptx-render-images] 开始转换 PPTX 为 PDF", { pptxPath, targetDir, office });
  const convert = spawnSync(
    office,
    ["--headless", "--convert-to", "pdf", "--outdir", targetDir, pptxPath],
    { encoding: "utf8" }
  );
  if (convert.status !== 0) {
    const message = convert.stderr || convert.stdout || `LibreOffice 退出码 ${convert.status}`;
    console.warn("[pptx-render-images] PDF 转换失败", { message });
    return { ok: false, warning: `PDF 转换失败：${message}`, images: [] };
  }
  const pdfPath = join(targetDir, `${basename(pptxPath, ".pptx")}.pdf`);
  const prefix = join(targetDir, "slide");
  console.info("[pptx-render-images] 开始转换 PDF 为图片", { pdfPath, pdftoppm });
  const ppm = spawnSync(pdftoppm, ["-jpeg", "-r", "150", pdfPath, prefix], { encoding: "utf8" });
  if (ppm.status !== 0) {
    const message = ppm.stderr || ppm.stdout || `pdftoppm 退出码 ${ppm.status}`;
    console.warn("[pptx-render-images] 图片转换失败", { message });
    return { ok: false, warning: `图片转换失败：${message}`, images: [] };
  }
  const images = (await readdir(dirname(prefix)))
    .filter((name) => /^slide-\d+\.jpg$/u.test(name))
    .sort()
    .map((name) => join(dirname(prefix), name));
  console.info("[pptx-render-images] 图片导出完成", { count: images.length, outputDir: targetDir });
  return { ok: true, images };
}

function findCommand(candidates) {
  for (const command of candidates) {
    const result = spawnSync(command, ["--version"], { encoding: "utf8" });
    if (result.status === 0) {
      return command;
    }
  }
  return undefined;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , input, outputDir] = process.argv;
  if (!input) {
    console.error("用法: node pptx-render-images.mjs <input.pptx> [output-dir]");
    process.exit(1);
  }
  const result = await renderPptxImages(input, outputDir);
  console.log(JSON.stringify(result, null, 2));
}
