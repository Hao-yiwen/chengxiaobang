#!/usr/bin/env node
import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { parseXml, readText, relationshipElements, serializeXml, writeText } from "./lib/pptx-ooxml.mjs";

export async function cleanPptxDirectory(unpackedDir) {
  console.info("[pptx-clean] 开始清理 PPTX 解包目录", { unpackedDir });
  const referenced = await referencedSlides(unpackedDir);
  const slidesDir = join(unpackedDir, "ppt", "slides");
  const relsDir = join(slidesDir, "_rels");
  const removed = [];
  for (const name of await readdir(slidesDir)) {
    if (!/^slide\d+\.xml$/u.test(name) || referenced.has(name)) {
      continue;
    }
    await rm(join(slidesDir, name), { force: true });
    await rm(join(relsDir, `${name}.rels`), { force: true });
    removed.push(`ppt/slides/${name}`);
  }
  if (removed.length > 0) {
    await cleanContentTypes(unpackedDir, removed);
  }
  console.info("[pptx-clean] 清理完成", { unpackedDir, removed });
  console.log(`已清理 ${removed.length} 个未引用 slide。`);
  return removed;
}

async function referencedSlides(unpackedDir) {
  const presXml = await readText(join(unpackedDir, "ppt", "presentation.xml"));
  const relsDom = parseXml(await readText(join(unpackedDir, "ppt", "_rels", "presentation.xml.rels")));
  const ridToSlide = new Map();
  for (const rel of relationshipElements(relsDom)) {
    if (rel.getAttribute("Type").endsWith("/slide")) {
      ridToSlide.set(rel.getAttribute("Id"), rel.getAttribute("Target").replace(/^slides\//u, ""));
    }
  }
  return new Set(
    Array.from(presXml.matchAll(/<p:sldId[^>]*r:id="([^"]+)"/gu))
      .map((match) => ridToSlide.get(match[1]))
      .filter(Boolean)
  );
}

async function cleanContentTypes(unpackedDir, removed) {
  const path = join(unpackedDir, "[Content_Types].xml");
  const dom = parseXml(await readText(path));
  for (const override of Array.from(dom.getElementsByTagName("Override"))) {
    const partName = override.getAttribute("PartName").replace(/^\//u, "");
    if (removed.includes(partName) && override.parentNode) {
      override.parentNode.removeChild(override);
    }
  }
  await writeText(path, serializeXml(dom));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , unpackedDir] = process.argv;
  if (!unpackedDir) {
    console.error("用法: node pptx-clean.mjs <unpacked-dir>");
    process.exit(1);
  }
  await cleanPptxDirectory(unpackedDir);
}
