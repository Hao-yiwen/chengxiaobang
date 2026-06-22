import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export type DesktopThemeSource = "light" | "dark" | "system";

const THEME_SOURCES = new Set<DesktopThemeSource>(["light", "dark", "system"]);

export type ThemeSourceCacheReadResult =
  | { ok: true; path: string; source: DesktopThemeSource }
  | { ok: false; path: string; reason: "missing" | "invalid" | "read_failed"; error?: string };

export function isDesktopThemeSource(value: unknown): value is DesktopThemeSource {
  return typeof value === "string" && THEME_SOURCES.has(value as DesktopThemeSource);
}

export async function readThemeSourceCache(path: string): Promise<ThemeSourceCacheReadResult> {
  try {
    const raw = await readFile(path, "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, path, reason: "invalid", error: message };
    }
    if (!isThemeSourceCachePayload(parsed)) {
      return { ok: false, path, reason: "invalid" };
    }
    return { ok: true, path, source: parsed.source };
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return { ok: false, path, reason: "missing" };
    }
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, path, reason: "read_failed", error: message };
  }
}

export async function writeThemeSourceCache(
  path: string,
  source: DesktopThemeSource
): Promise<void> {
  // 主题缓存供下次启动页使用，必须在 renderer localStorage 可用前由 main 进程读取。
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify({ source }, null, 2)}\n`, "utf8");
}

export function resolveThemeSourceDark(
  source: DesktopThemeSource,
  systemShouldUseDarkColors: boolean
): boolean {
  if (source === "light") {
    return false;
  }
  if (source === "dark") {
    return true;
  }
  return systemShouldUseDarkColors;
}

function isThemeSourceCachePayload(value: unknown): value is { source: DesktopThemeSource } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  return isDesktopThemeSource((value as { source?: unknown }).source);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
