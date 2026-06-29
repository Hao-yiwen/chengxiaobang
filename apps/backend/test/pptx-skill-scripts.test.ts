import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const skillScripts = {
  "pptx-add-slide.mjs": new URL("../skills/pptx/scripts/pptx-add-slide.mjs", import.meta.url).href,
  "pptx-author.mjs": new URL("../skills/pptx/scripts/pptx-author.mjs", import.meta.url).href,
  "pptx-clean.mjs": new URL("../skills/pptx/scripts/pptx-clean.mjs", import.meta.url).href,
  "pptx-inspect.mjs": new URL("../skills/pptx/scripts/pptx-inspect.mjs", import.meta.url).href,
  "pptx-pack.mjs": new URL("../skills/pptx/scripts/pptx-pack.mjs", import.meta.url).href,
  "pptx-render-images.mjs": new URL("../skills/pptx/scripts/pptx-render-images.mjs", import.meta.url).href,
  "pptx-unpack.mjs": new URL("../skills/pptx/scripts/pptx-unpack.mjs", import.meta.url).href,
  "pptx-validate.mjs": new URL("../skills/pptx/scripts/pptx-validate.mjs", import.meta.url).href
} as const satisfies Record<string, string>;

async function loadScript<T>(name: string): Promise<T> {
  const script = skillScripts[name as keyof typeof skillScripts];
  if (!script) {
    throw new Error(`未知 PPTX 脚本: ${name}`);
  }
  return import(/* @vite-ignore */ script) as Promise<T>;
}

function isZip(buffer: Buffer): boolean {
  return buffer[0] === 0x50 && buffer[1] === 0x4b;
}

describe("pptx skill scripts", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "cxb-pptx-skill-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("生成可编辑 PPTX，并能提取页数、标题和正文", async () => {
    const author = await loadScript<{
      createPresentation: (options: Record<string, unknown>) => any;
      addTitle: (slide: any, title: string, options?: Record<string, unknown>) => void;
      addBodyText: (slide: any, title: string, paragraphs: string[]) => void;
      savePresentation: (pptx: any, outputPath: string) => Promise<string>;
    }>("pptx-author.mjs");
    const inspect = await loadScript<{
      inspectPptx: (inputPath: string) => { slideCount: number; slides: Array<{ title: string; texts: string[] }> };
    }>("pptx-inspect.mjs");

    const pptx = author.createPresentation({ title: "能力迁移", author: "程小帮" });
    let slide = pptx.addSlide();
    author.addTitle(slide, "能力迁移", { subtitle: "PPTX Skill" });
    slide = pptx.addSlide();
    author.addBodyText(slide, "关键变化", ["从 JSON 固定布局迁移到可编辑 PPTX", "按模型能力启用视觉 QA"]);
    slide = pptx.addSlide();
    author.addBodyText(slide, "验证", ["文本 QA", "结构 QA"]);
    const target = await author.savePresentation(pptx, join(dir, "迁移方案.pptx"));

    expect(isZip(await readFile(target))).toBe(true);
    const result = inspect.inspectPptx(target);
    expect(result.slideCount).toBe(3);
    expect(result.slides.map((item) => item.title)).toContain("能力迁移");
    expect(result.slides.flatMap((item) => item.texts).join("\n")).toContain("按模型能力启用视觉 QA");
  });

  it("支持 unpack → add-slide → clean → pack → validate 模板编辑链路", async () => {
    const pptxPath = await createSamplePptx(join(dir, "template.pptx"));
    const unpack = await loadScript<{ unpackPptx: (input: string, output: string) => Promise<void> }>(
      "pptx-unpack.mjs"
    );
    const add = await loadScript<{
      addSlide: (input: string, source: string) => Promise<{ sldId: string; destName: string }>;
    }>("pptx-add-slide.mjs");
    const clean = await loadScript<{ cleanPptxDirectory: (input: string) => Promise<string[]> }>(
      "pptx-clean.mjs"
    );
    const pack = await loadScript<{ packPptx: (input: string, output: string) => Promise<string> }>(
      "pptx-pack.mjs"
    );
    const validate = await loadScript<{ validatePptxFile: (input: string) => { ok: boolean; slideCount: number } }>(
      "pptx-validate.mjs"
    );

    const unpacked = join(dir, "unpacked");
    await unpack.unpackPptx(pptxPath, unpacked);
    const added = await add.addSlide(unpacked, "slide2.xml");
    const presentationPath = join(unpacked, "ppt", "presentation.xml");
    const presentationXml = await readFile(presentationPath, "utf8");
    await writeFile(
      presentationPath,
      presentationXml.replace("</p:sldIdLst>", `${added.sldId}</p:sldIdLst>`),
      "utf8"
    );
    await clean.cleanPptxDirectory(unpacked);
    const output = await pack.packPptx(unpacked, join(dir, "output.pptx"));

    const validation = validate.validatePptxFile(output);
    expect(validation.ok).toBe(true);
    expect(validation.slideCount).toBe(3);
  });

  it("能报告断裂的 relationship 和占位符残留", async () => {
    const pptxPath = await createSamplePptx(join(dir, "broken.pptx"), "xxxx placeholder");
    const unpack = await loadScript<{ unpackPptx: (input: string, output: string) => Promise<void> }>(
      "pptx-unpack.mjs"
    );
    const validate = await loadScript<{
      validatePptxDirectory: (input: string) => Promise<{ ok: boolean; errors: string[] }>;
    }>("pptx-validate.mjs");
    const inspect = await loadScript<{ inspectPptx: (input: string) => { placeholderSlides: unknown[] } }>(
      "pptx-inspect.mjs"
    );

    const unpacked = join(dir, "broken-unpacked");
    await unpack.unpackPptx(pptxPath, unpacked);
    const relsPath = join(unpacked, "ppt", "_rels", "presentation.xml.rels");
    const relsXml = await readFile(relsPath, "utf8");
    await writeFile(relsPath, relsXml.replace("slides/slide2.xml", "slides/missing.xml"), "utf8");

    const validation = await validate.validatePptxDirectory(unpacked);
    expect(validation.ok).toBe(false);
    expect(validation.errors.join("\n")).toContain("slide 文件不存在");
    expect(inspect.inspectPptx(pptxPath).placeholderSlides.length).toBeGreaterThan(0);
  });

  it("缺少 LibreOffice 时渲染脚本给出 warning，不阻断 PPTX 生成", async () => {
    const pptxPath = await createSamplePptx(join(dir, "render.pptx"));
    const render = await loadScript<{
      renderPptxImages: (input: string, output?: string) => Promise<{ ok: boolean; warning?: string; images: string[] }>;
    }>("pptx-render-images.mjs");
    const originalPath = process.env.PATH;
    process.env.PATH = "";
    try {
      const result = await render.renderPptxImages(pptxPath, join(dir, "images"));
      expect(result.ok).toBe(false);
      expect(result.warning).toContain("缺少渲染依赖");
      expect(result.images).toEqual([]);
    } finally {
      process.env.PATH = originalPath;
    }
  });
});

async function createSamplePptx(target: string, secondSlideText = "第二页正文"): Promise<string> {
  const author = await loadScript<{
    createPresentation: (options: Record<string, unknown>) => any;
    addTitle: (slide: any, title: string, options?: Record<string, unknown>) => void;
    addBodyText: (slide: any, title: string, paragraphs: string[]) => void;
    savePresentation: (pptx: any, outputPath: string) => Promise<string>;
  }>("pptx-author.mjs");
  const pptx = author.createPresentation({ title: "模板测试", author: "程小帮" });
  let slide = pptx.addSlide();
  author.addTitle(slide, "模板测试");
  slide = pptx.addSlide();
  author.addBodyText(slide, "第二页", [secondSlideText]);
  return author.savePresentation(pptx, target);
}
