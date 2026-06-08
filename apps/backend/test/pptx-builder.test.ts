import { describe, expect, it } from "vitest";
import { buildPptx } from "../src/tools/pptx-builder";

function isZip(buffer: Buffer): boolean {
  return buffer[0] === 0x50 && buffer[1] === 0x4b; // "PK"
}

describe("buildPptx", () => {
  it("produces a non-trivial pptx buffer from a full deck", async () => {
    const buffer = await buildPptx({
      title: "测试演示",
      subtitle: "副标题",
      theme: { primary: "#2E5BFF", accent: "00C2A8" },
      slides: [
        { layout: "title", title: "封面", subtitle: "副标题" },
        { layout: "bullets", title: "要点", bullets: ["第一点", "第二点", "第三点"] },
        { layout: "section", title: "章节" },
        {
          layout: "two-column",
          title: "对比",
          columns: [
            { title: "左", bullets: ["a", "b"] },
            { title: "右", bullets: ["c", "d"] }
          ]
        },
        { layout: "quote", quote: "一句话", attribution: "某人", notes: "备注" }
      ]
    });
    expect(isZip(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(2000);
  });

  it("renders a default cover slide for an almost-empty deck", async () => {
    const buffer = await buildPptx({ title: "只有标题" });
    expect(isZip(buffer)).toBe(true);
  });
});
