import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const scriptPath = resolve("apps/backend/skills/ppt/scripts/create-pptx.mjs");

function isZip(buffer: Buffer): boolean {
  return buffer[0] === 0x50 && buffer[1] === 0x4b;
}

describe("ppt skill script", () => {
  it("produces a non-trivial pptx file from a full deck spec", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cxb-ppt-script-"));
    try {
      await writeFile(
        join(dir, "deck.json"),
        JSON.stringify({
          path: "测试演示.pptx",
          deck: {
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
          }
        }),
        "utf8"
      );
      await execFileAsync("node", [scriptPath, "deck.json"], { cwd: dir });
      const buffer = await readFile(join(dir, "测试演示.pptx"));
      expect(isZip(buffer)).toBe(true);
      expect(buffer.length).toBeGreaterThan(2000);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("renders a default cover slide for an almost-empty deck", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cxb-ppt-script-empty-"));
    try {
      await writeFile(join(dir, "deck.json"), JSON.stringify({ title: "只有标题" }), "utf8");
      await execFileAsync("node", [scriptPath, "deck.json", "empty.pptx"], { cwd: dir });
      const buffer = await readFile(join(dir, "empty.pptx"));
      expect(isZip(buffer)).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
