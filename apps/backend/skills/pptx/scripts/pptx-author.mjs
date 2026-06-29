#!/usr/bin/env node
import { dirname, resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import pptxgen from "pptxgenjs";

export const SLIDE_WIDE = { width: 13.333, height: 7.5 };

export function normalizeColor(value, fallback = "1F2937") {
  return String(value || fallback).replace(/^#/u, "").toUpperCase();
}

export function createPresentation(options = {}) {
  const pptx = new pptxgen();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = options.author ?? "程小帮";
  if (options.title) {
    pptx.title = options.title;
  }
  pptx.subject = options.subject ?? options.title ?? "演示文稿";
  pptx.company = options.company ?? "程小帮";
  console.info("[pptx-author] 已创建演示文稿", {
    title: pptx.title,
    author: pptx.author
  });
  return pptx;
}

export async function savePresentation(pptx, outputPath) {
  const target = resolve(process.cwd(), outputPath);
  await mkdir(dirname(target), { recursive: true });
  await pptx.writeFile({ fileName: target });
  console.info("[pptx-author] PPTX 写入完成", { target });
  return target;
}

export function addTitle(slide, title, options = {}) {
  const theme = normalizeTheme(options.theme);
  slide.background = { color: theme.primary };
  slide.addText(title, {
    x: 0.8,
    y: 2.35,
    w: 11.8,
    h: 1,
    margin: 0,
    fontFace: options.fontFace ?? "Microsoft YaHei",
    fontSize: options.fontSize ?? 42,
    bold: true,
    color: "FFFFFF",
    fit: "shrink"
  });
  if (options.subtitle) {
    slide.addText(options.subtitle, {
      x: 0.82,
      y: 3.62,
      w: 10.8,
      h: 0.55,
      margin: 0,
      fontFace: options.bodyFontFace ?? "Microsoft YaHei",
      fontSize: 18,
      color: theme.light,
      fit: "shrink"
    });
  }
  if (options.kicker) {
    slide.addText(options.kicker, {
      x: 0.84,
      y: 1.75,
      w: 8,
      h: 0.35,
      margin: 0,
      fontSize: 11,
      bold: true,
      charSpacing: 1.5,
      color: theme.accent
    });
  }
}

export function addSectionTitle(slide, title, options = {}) {
  const theme = normalizeTheme(options.theme);
  slide.background = { color: options.background ?? "F8FAFC" };
  slide.addShape("rect", {
    x: 0,
    y: 0,
    w: 0.28,
    h: SLIDE_WIDE.height,
    fill: { color: theme.accent },
    line: { transparency: 100 }
  });
  slide.addText(title, {
    x: 0.85,
    y: 2.75,
    w: 11.6,
    h: 0.85,
    margin: 0,
    fontSize: options.fontSize ?? 36,
    bold: true,
    color: theme.text,
    fit: "shrink"
  });
  if (options.subtitle) {
    slide.addText(options.subtitle, {
      x: 0.88,
      y: 3.8,
      w: 10.8,
      h: 0.5,
      margin: 0,
      fontSize: 16,
      color: theme.muted,
      fit: "shrink"
    });
  }
}

export function addBodyText(slide, title, paragraphs = [], options = {}) {
  const theme = normalizeTheme(options.theme);
  slide.addText(title, {
    x: options.x ?? 0.7,
    y: options.y ?? 0.55,
    w: options.w ?? 11.9,
    h: 0.55,
    margin: 0,
    fontSize: options.titleSize ?? 30,
    bold: true,
    color: theme.text,
    fit: "shrink"
  });
  const body = Array.isArray(paragraphs) ? paragraphs : [paragraphs];
  slide.addText(body.join("\n\n"), {
    x: options.x ?? 0.7,
    y: (options.y ?? 0.55) + 1,
    w: options.w ?? 7.4,
    h: options.h ?? 4.8,
    margin: 0.04,
    breakLine: false,
    fontSize: options.bodySize ?? 16,
    color: theme.text,
    valign: "top",
    fit: "shrink"
  });
}

export function addCard(slide, input) {
  const theme = normalizeTheme(input.theme);
  slide.addShape("roundRect", {
    x: input.x,
    y: input.y,
    w: input.w,
    h: input.h,
    rectRadius: 0.08,
    fill: { color: input.fill ?? "FFFFFF" },
    line: { color: input.line ?? "E5E7EB", transparency: input.line ? 0 : 30 },
    shadow: input.shadow === false ? undefined : { type: "outer", color: "000000", opacity: 0.12, blur: 2, angle: 45, offset: 1 }
  });
  if (input.title) {
    slide.addText(input.title, {
      x: input.x + 0.24,
      y: input.y + 0.22,
      w: input.w - 0.48,
      h: 0.36,
      margin: 0,
      fontSize: input.titleSize ?? 15,
      bold: true,
      color: input.titleColor ?? theme.text,
      fit: "shrink"
    });
  }
  if (input.text) {
    slide.addText(input.text, {
      x: input.x + 0.24,
      y: input.y + (input.title ? 0.74 : 0.24),
      w: input.w - 0.48,
      h: input.h - (input.title ? 0.96 : 0.48),
      margin: 0,
      fontSize: input.fontSize ?? 12.5,
      color: input.textColor ?? theme.text,
      valign: "top",
      fit: "shrink"
    });
  }
}

export function addStat(slide, input) {
  const theme = normalizeTheme(input.theme);
  slide.addText(input.value, {
    x: input.x,
    y: input.y,
    w: input.w,
    h: 0.7,
    margin: 0,
    fontSize: input.valueSize ?? 40,
    bold: true,
    color: input.color ?? theme.primary,
    fit: "shrink"
  });
  slide.addText(input.label, {
    x: input.x,
    y: input.y + 0.78,
    w: input.w,
    h: 0.35,
    margin: 0,
    fontSize: input.labelSize ?? 12,
    color: input.labelColor ?? theme.muted,
    fit: "shrink"
  });
}

export function addImageCover(slide, path, box, options = {}) {
  slide.addImage({
    path,
    x: box.x,
    y: box.y,
    w: box.w,
    h: box.h,
    sizing: { type: "cover", x: box.x, y: box.y, w: box.w, h: box.h },
    ...(options.altText ? { altText: options.altText } : {})
  });
}

function normalizeTheme(theme = {}) {
  return {
    primary: normalizeColor(theme.primary, "1F2937"),
    accent: normalizeColor(theme.accent, "14B8A6"),
    text: normalizeColor(theme.text, "111827"),
    muted: normalizeColor(theme.muted, "6B7280"),
    light: normalizeColor(theme.light, "E5E7EB")
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log("pptx-author.mjs 是生成 PPTX 的 helper 模块，请在一次性 .mjs 脚本中 import 使用。");
}
