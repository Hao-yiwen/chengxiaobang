import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const scriptPath = resolve("apps/backend/skills/excel/scripts/create-xlsx.mjs");

function isZip(buffer: Buffer): boolean {
  return buffer[0] === 0x50 && buffer[1] === 0x4b;
}

describe("excel skill script", () => {
  it("produces an xlsx file from a structured workbook spec", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cxb-excel-script-"));
    try {
      await writeFile(
        join(dir, "workbook.json"),
        JSON.stringify({
          path: "预算表.xlsx",
          workbook: {
            sheets: [
              {
                name: "预算",
                columns: [
                  { header: "项目", key: "item", width: 24 },
                  { header: "金额", key: "amount", width: 12 }
                ],
                rows: [
                  { item: "房租", amount: 4500 },
                  { item: "餐饮", amount: 2000 }
                ]
              }
            ]
          }
        }),
        "utf8"
      );
      await execFileAsync("node", [scriptPath, "workbook.json"], { cwd: dir });
      const buffer = await readFile(join(dir, "预算表.xlsx"));
      expect(isZip(buffer)).toBe(true);
      expect(buffer.length).toBeGreaterThan(1000);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
