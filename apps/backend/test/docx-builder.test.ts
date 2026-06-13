import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const scriptPath = resolve("apps/backend/skills/word/scripts/create-docx.mjs");

function isZip(buffer: Buffer): boolean {
  return buffer[0] === 0x50 && buffer[1] === 0x4b;
}

describe("word skill script", () => {
  it("produces a docx file from a structured document spec", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cxb-word-script-"));
    try {
      await writeFile(
        join(dir, "document.json"),
        JSON.stringify({
          path: "周报.docx",
          document: {
            title: "周报",
            subtitle: "第 23 周",
            blocks: [
              { type: "heading", level: 1, text: "进展" },
              { type: "bullets", items: ["完成 A", "完成 B"] },
              { type: "ordered", items: ["步骤一", "步骤二"] },
              { type: "paragraph", text: "正文段落。" },
              { type: "quote", text: "一句引用。" }
            ]
          }
        }),
        "utf8"
      );
      await execFileAsync("node", [scriptPath, "document.json"], { cwd: dir });
      const buffer = await readFile(join(dir, "周报.docx"));
      expect(isZip(buffer)).toBe(true);
      expect(buffer.length).toBeGreaterThan(1000);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("handles an empty document", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cxb-word-script-empty-"));
    try {
      await writeFile(join(dir, "document.json"), JSON.stringify({}), "utf8");
      await execFileAsync("node", [scriptPath, "document.json", "empty.docx"], { cwd: dir });
      const buffer = await readFile(join(dir, "empty.docx"));
      expect(isZip(buffer)).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
