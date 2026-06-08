import { describe, expect, it } from "vitest";
import { buildDocx } from "../src/tools/docx-builder";

function isZip(buffer: Buffer): boolean {
  return buffer[0] === 0x50 && buffer[1] === 0x4b; // "PK"
}

describe("buildDocx", () => {
  it("produces a docx buffer from a structured document", async () => {
    const buffer = await buildDocx({
      title: "周报",
      subtitle: "第 23 周",
      blocks: [
        { type: "heading", level: 1, text: "进展" },
        { type: "bullets", items: ["完成 A", "完成 B"] },
        { type: "ordered", items: ["步骤一", "步骤二"] },
        { type: "paragraph", text: "正文段落。" },
        { type: "quote", text: "一句引用。" }
      ]
    });
    expect(isZip(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(1000);
  });

  it("handles an empty document", async () => {
    const buffer = await buildDocx({});
    expect(isZip(buffer)).toBe(true);
  });
});
