#!/usr/bin/env node
import { createRequire } from "node:module";
import { addFolderToZip, ensurePptxExtension } from "./lib/pptx-ooxml.mjs";
import { validatePptxDirectory, validatePptxFile } from "./pptx-validate.mjs";

const require = createRequire(import.meta.url);
const AdmZip = require("adm-zip");

export async function packPptx(inputDir, outputPath, options = {}) {
  const target = ensurePptxExtension(outputPath);
  console.info("[pptx-pack] 开始打包 PPTX", { inputDir, target });
  const dirValidation = await validatePptxDirectory(inputDir);
  if (dirValidation.errors.length > 0 && options.validate !== false) {
    console.error("[pptx-pack] 解包目录校验失败", { inputDir, errors: dirValidation.errors });
    throw new Error(`解包目录校验失败:\n${dirValidation.errors.join("\n")}`);
  }
  const zip = new AdmZip();
  await addFolderToZip(zip, inputDir);
  zip.writeZip(target);
  const fileValidation = validatePptxFile(target);
  if (fileValidation.errors.length > 0 && options.validate !== false) {
    console.error("[pptx-pack] 打包后校验失败", { target, errors: fileValidation.errors });
    throw new Error(`打包后校验失败:\n${fileValidation.errors.join("\n")}`);
  }
  console.info("[pptx-pack] PPTX 打包完成", { inputDir, target, warnings: fileValidation.warnings.length });
  return target;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , inputDir, outputPath] = process.argv;
  if (!inputDir || !outputPath) {
    console.error("用法: node pptx-pack.mjs <unpacked-dir> <output.pptx>");
    process.exit(1);
  }
  await packPptx(inputDir, outputPath);
}
