#!/usr/bin/env node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";
import { unpackPptx } from "./pptx-unpack.mjs";
import {
  REL_SLIDE,
  parseXml,
  pathExists,
  readPptxZip,
  readText,
  relationshipElements,
  resolveRelationshipTarget,
  slideOrderFromPackage,
  zipEntryText
} from "./lib/pptx-ooxml.mjs";

export function validatePptxFile(inputPath) {
  console.info("[pptx-validate] 开始校验 PPTX 文件", { inputPath });
  const zip = readPptxZip(inputPath);
  const entries = new Set(zip.getEntries().filter((entry) => !entry.isDirectory).map((entry) => entry.entryName));
  const errors = [];
  const warnings = [];
  for (const required of ["[Content_Types].xml", "ppt/presentation.xml", "ppt/_rels/presentation.xml.rels"]) {
    if (!entries.has(required)) {
      errors.push(`缺少必要文件: ${required}`);
    }
  }
  const slides = slideOrderFromPackage(zip);
  if (slides.length === 0) {
    errors.push("presentation.xml 中没有有效 slide 引用");
  }
  const contentTypes = zipEntryText(zip, "[Content_Types].xml") ?? "";
  for (const slide of slides) {
    if (!entries.has(slide.path)) {
      errors.push(`slide 引用不存在: ${slide.path}`);
    }
    if (!contentTypes.includes(`/${slide.path}`)) {
      warnings.push(`Content_Types 缺少 slide override: ${slide.path}`);
    }
  }
  for (const entry of entries) {
    if (!entry.endsWith(".rels")) {
      continue;
    }
    const relsXml = zipEntryText(zip, entry);
    if (!relsXml) {
      continue;
    }
    const dom = parseXml(relsXml);
    for (const rel of relationshipElements(dom)) {
      const target = rel.getAttribute("Target");
      if (!target || target.includes("://") || rel.getAttribute("TargetMode") === "External") {
        continue;
      }
      const resolved = resolveRelationshipTarget(entry, target);
      if (!entries.has(resolved)) {
        errors.push(`关系目标不存在: ${entry} -> ${target} (${resolved})`);
      }
    }
  }
  const result = { ok: errors.length === 0, errors, warnings, slideCount: slides.length };
  console.info("[pptx-validate] PPTX 文件校验完成", result);
  return result;
}

export async function validatePptxDirectory(unpackedDir) {
  console.info("[pptx-validate] 开始校验 PPTX 解包目录", { unpackedDir });
  const errors = [];
  const warnings = [];
  for (const required of ["[Content_Types].xml", "ppt/presentation.xml", "ppt/_rels/presentation.xml.rels"]) {
    if (!(await pathExists(join(unpackedDir, required)))) {
      errors.push(`缺少必要文件: ${required}`);
    }
  }
  if (errors.length > 0) {
    return { ok: false, errors, warnings, slideCount: 0 };
  }
  const presXml = await readText(join(unpackedDir, "ppt", "presentation.xml"));
  const relsDom = parseXml(await readText(join(unpackedDir, "ppt", "_rels", "presentation.xml.rels")));
  const ridToTarget = new Map();
  for (const rel of relationshipElements(relsDom)) {
    if (rel.getAttribute("Type") === REL_SLIDE) {
      ridToTarget.set(rel.getAttribute("Id"), `ppt/${rel.getAttribute("Target")}`);
    }
  }
  const slideRids = Array.from(presXml.matchAll(/<p:sldId[^>]*r:id="([^"]+)"/gu)).map((match) => match[1]);
  if (slideRids.length === 0) {
    errors.push("presentation.xml 中没有 slide 引用");
  }
  const contentTypes = await readText(join(unpackedDir, "[Content_Types].xml"));
  for (const rid of slideRids) {
    const target = ridToTarget.get(rid);
    if (!target) {
      errors.push(`presentation.xml 引用了不存在的关系: ${rid}`);
      continue;
    }
    if (!(await pathExists(join(unpackedDir, target)))) {
      errors.push(`slide 文件不存在: ${target}`);
    }
    if (!contentTypes.includes(`/${posix.normalize(target)}`)) {
      warnings.push(`Content_Types 缺少 slide override: ${target}`);
    }
  }
  const result = { ok: errors.length === 0, errors, warnings, slideCount: slideRids.length };
  console.info("[pptx-validate] PPTX 解包目录校验完成", result);
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , input] = process.argv;
  if (!input) {
    console.error("用法: node pptx-validate.mjs <input.pptx|unpacked-dir>");
    process.exit(1);
  }
  let result;
  if (input.toLowerCase().endsWith(".pptx")) {
    result = validatePptxFile(input);
  } else {
    result = await validatePptxDirectory(input);
  }
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.ok ? 0 : 1;
}
