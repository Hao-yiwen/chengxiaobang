#!/usr/bin/env node
import { copyFile, mkdir, readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import {
  CONTENT_TYPE_SLIDE,
  REL_NOTES,
  REL_SLIDE,
  nextSlideNumber,
  parseXml,
  readText,
  relationshipElements,
  serializeXml,
  slideNumberFromName,
  writeText
} from "./lib/pptx-ooxml.mjs";

export async function addSlide(unpackedDir, sourceSlideName) {
  console.info("[pptx-add-slide] 开始复制 slide", { unpackedDir, sourceSlideName });
  const slidesDir = join(unpackedDir, "ppt", "slides");
  const relsDir = join(slidesDir, "_rels");
  const source = join(slidesDir, sourceSlideName);
  const slideNames = (await readdir(slidesDir)).filter((name) => /^slide\d+\.xml$/u.test(name));
  if (!slideNames.includes(sourceSlideName)) {
    throw new Error(`源 slide 不存在: ${sourceSlideName}`);
  }
  const next = nextSlideNumber(slideNames);
  const destName = `slide${next}.xml`;
  await copyFile(source, join(slidesDir, destName));
  await mkdir(relsDir, { recursive: true });
  const sourceRels = join(relsDir, `${sourceSlideName}.rels`);
  const destRels = join(relsDir, `${destName}.rels`);
  try {
    await copyFile(sourceRels, destRels);
    await removeNotesRelationship(destRels);
  } catch {
    await writeText(destRels, `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`);
  }
  const rid = await addPresentationRelationship(unpackedDir, destName);
  const slideId = await nextPresentationSlideId(unpackedDir);
  await addContentType(unpackedDir, destName);
  const sldId = `<p:sldId id="${slideId}" r:id="${rid}"/>`;
  console.info("[pptx-add-slide] slide 复制完成", { destName, rid, slideId });
  console.log(`Created ${destName} from ${sourceSlideName}`);
  console.log(`Add to ppt/presentation.xml <p:sldIdLst>: ${sldId}`);
  return { destName, rid, slideId, sldId };
}

async function removeNotesRelationship(relsPath) {
  const dom = parseXml(await readText(relsPath));
  for (const rel of relationshipElements(dom)) {
    if (rel.getAttribute("Type") === REL_NOTES && rel.parentNode) {
      rel.parentNode.removeChild(rel);
    }
  }
  await writeText(relsPath, serializeXml(dom));
}

async function addPresentationRelationship(unpackedDir, destName) {
  const relsPath = join(unpackedDir, "ppt", "_rels", "presentation.xml.rels");
  const dom = parseXml(await readText(relsPath));
  const relationships = relationshipElements(dom);
  const nextRid =
    Math.max(0, ...relationships.map((rel) => Number(rel.getAttribute("Id").replace(/^rId/u, ""))).filter(Number.isFinite)) + 1;
  const rid = `rId${nextRid}`;
  const rel = dom.createElement("Relationship");
  rel.setAttribute("Id", rid);
  rel.setAttribute("Type", REL_SLIDE);
  rel.setAttribute("Target", `slides/${destName}`);
  dom.documentElement.appendChild(rel);
  await writeText(relsPath, serializeXml(dom));
  return rid;
}

async function nextPresentationSlideId(unpackedDir) {
  const path = join(unpackedDir, "ppt", "presentation.xml");
  const content = await readText(path);
  const ids = Array.from(content.matchAll(/<p:sldId[^>]*id="(\d+)"/gu)).map((match) => Number(match[1]));
  return Math.max(255, ...ids) + 1;
}

async function addContentType(unpackedDir, destName) {
  const path = join(unpackedDir, "[Content_Types].xml");
  const content = await readText(path);
  if (content.includes(`/ppt/slides/${destName}`)) {
    return;
  }
  const override = `<Override PartName="/ppt/slides/${destName}" ContentType="${CONTENT_TYPE_SLIDE}"/>`;
  await writeText(path, content.replace("</Types>", `${override}</Types>`));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , unpackedDir, source] = process.argv;
  if (!unpackedDir || !source || !slideNumberFromName(basename(source))) {
    console.error("用法: node pptx-add-slide.mjs <unpacked-dir> <slideN.xml>");
    process.exit(1);
  }
  await addSlide(unpackedDir, basename(source));
}
