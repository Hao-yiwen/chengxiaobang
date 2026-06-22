import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  isDesktopThemeSource,
  readThemeSourceCache,
  resolveThemeSourceDark,
  writeThemeSourceCache
} from "../src/main/theme-source";

const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "cxb-theme-source-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("theme source cache", () => {
  it("reports a missing cache without throwing", async () => {
    const path = join(await createTempDir(), "theme-source.json");

    await expect(readThemeSourceCache(path)).resolves.toEqual({
      ok: false,
      path,
      reason: "missing"
    });
  });

  it("reads a valid cached theme source", async () => {
    const path = join(await createTempDir(), "theme-source.json");
    await writeFile(path, JSON.stringify({ source: "light" }), "utf8");

    await expect(readThemeSourceCache(path)).resolves.toEqual({
      ok: true,
      path,
      source: "light"
    });
  });

  it("rejects invalid cached theme sources", async () => {
    const path = join(await createTempDir(), "theme-source.json");
    await writeFile(path, JSON.stringify({ source: "blue" }), "utf8");

    await expect(readThemeSourceCache(path)).resolves.toEqual({
      ok: false,
      path,
      reason: "invalid"
    });
  });

  it("rejects malformed cache JSON", async () => {
    const path = join(await createTempDir(), "theme-source.json");
    await writeFile(path, "{bad", "utf8");

    const result = await readThemeSourceCache(path);
    expect(result).toMatchObject({
      ok: false,
      path,
      reason: "invalid"
    });
    expect(result.ok ? undefined : result.error).toContain("JSON");
  });

  it("writes the theme source cache and creates parent directories", async () => {
    const path = join(await createTempDir(), "nested", "theme-source.json");

    await writeThemeSourceCache(path, "dark");

    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ source: "dark" });
    await expect(readThemeSourceCache(path)).resolves.toEqual({
      ok: true,
      path,
      source: "dark"
    });
  });

  it("validates the theme source primitive", () => {
    expect(isDesktopThemeSource("light")).toBe(true);
    expect(isDesktopThemeSource("dark")).toBe(true);
    expect(isDesktopThemeSource("system")).toBe(true);
    expect(isDesktopThemeSource("blue")).toBe(false);
    expect(isDesktopThemeSource(undefined)).toBe(false);
  });

  it("resolves startup darkness from cached source and system appearance", () => {
    expect(resolveThemeSourceDark("light", true)).toBe(false);
    expect(resolveThemeSourceDark("dark", false)).toBe(true);
    expect(resolveThemeSourceDark("system", true)).toBe(true);
    expect(resolveThemeSourceDark("system", false)).toBe(false);
  });
});
