#!/usr/bin/env node
import { readPptxZip, slideOrderFromPackage, textContentFromXml, zipEntryText, placeholderHits } from "./lib/pptx-ooxml.mjs";

export function inspectPptx(inputPath) {
  console.info("[pptx-inspect] 开始分析 PPTX", { inputPath });
  const zip = readPptxZip(inputPath);
  const slides = slideOrderFromPackage(zip).map((slide) => {
    const xml = zipEntryText(zip, slide.path) ?? "";
    const texts = textContentFromXml(xml);
    const joined = texts.join("\n");
    const notes = extractNotes(zip, slide.path);
    return {
      index: slide.index,
      id: slide.id,
      path: slide.path,
      hidden: slide.hidden,
      title: texts[0] ?? "",
      texts,
      notes,
      placeholderHits: placeholderHits(`${joined}\n${notes.join("\n")}`)
    };
  });
  const result = {
    path: inputPath,
    slideCount: slides.length,
    slides,
    placeholderSlides: slides
      .filter((slide) => slide.placeholderHits.length > 0)
      .map((slide) => ({ index: slide.index, title: slide.title, hits: slide.placeholderHits }))
  };
  console.info("[pptx-inspect] PPTX 分析完成", {
    inputPath,
    slideCount: result.slideCount,
    placeholderSlides: result.placeholderSlides.length
  });
  return result;
}

function extractNotes(zip, slidePath) {
  const relsPath = slidePath.replace(/^ppt\/slides\//u, "ppt/slides/_rels/") + ".rels";
  const relsXml = zipEntryText(zip, relsPath);
  if (!relsXml) {
    return [];
  }
  const match = relsXml.match(/Type="[^"]*\/notesSlide"[^>]*Target="([^"]+)"/u);
  if (!match) {
    return [];
  }
  const notesPath = `ppt/notesSlides/${match[1].split("/").at(-1)}`;
  const notesXml = zipEntryText(zip, notesPath);
  return notesXml ? textContentFromXml(notesXml) : [];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const input = process.argv[2];
  if (!input) {
    console.error("用法: node pptx-inspect.mjs <input.pptx>");
    process.exit(1);
  }
  console.log(JSON.stringify(inspectPptx(input), null, 2));
}
