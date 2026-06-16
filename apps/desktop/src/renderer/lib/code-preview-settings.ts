import type { BundledTheme } from "shiki";

export const CODE_PREVIEW_FONT_SIZE_MIN = 11;
export const CODE_PREVIEW_FONT_SIZE_MAX = 16;

export const CODE_PREVIEW_THEME_OPTIONS = [
  { id: "github-light", label: "GitHub Light" },
  { id: "github-dark", label: "GitHub Dark" },
  { id: "vitesse-light", label: "Vitesse Light" },
  { id: "vitesse-dark", label: "Vitesse Dark" },
  { id: "min-light", label: "Minimal Light" },
  { id: "min-dark", label: "Minimal Dark" },
  { id: "github-light-high-contrast", label: "GitHub HC Light" },
  { id: "github-dark-high-contrast", label: "GitHub HC Dark" },
  { id: "catppuccin-latte", label: "Catppuccin Latte" },
  { id: "catppuccin-mocha", label: "Catppuccin Mocha" }
] as const satisfies ReadonlyArray<{ id: BundledTheme; label: string }>;

export type CodePreviewThemeId = (typeof CODE_PREVIEW_THEME_OPTIONS)[number]["id"];

export interface CodePreviewSettings {
  lightTheme: CodePreviewThemeId;
  darkTheme: CodePreviewThemeId;
  wrapLongLines: boolean;
  fontSize: number;
}

export const DEFAULT_CODE_PREVIEW_SETTINGS: CodePreviewSettings = {
  lightTheme: "github-light",
  darkTheme: "github-dark",
  wrapLongLines: false,
  fontSize: 12
};

const CODE_PREVIEW_THEME_IDS = new Set<CodePreviewThemeId>(
  CODE_PREVIEW_THEME_OPTIONS.map((option) => option.id)
);

export function codePreviewThemeLabel(id: CodePreviewThemeId): string {
  return CODE_PREVIEW_THEME_OPTIONS.find((option) => option.id === id)?.label ?? id;
}

export function sanitizeCodePreviewSettings(value: unknown): CodePreviewSettings {
  if (!value || typeof value !== "object") {
    return DEFAULT_CODE_PREVIEW_SETTINGS;
  }
  const input = value as Partial<CodePreviewSettings>;
  return {
    lightTheme: isCodePreviewThemeId(input.lightTheme)
      ? input.lightTheme
      : DEFAULT_CODE_PREVIEW_SETTINGS.lightTheme,
    darkTheme: isCodePreviewThemeId(input.darkTheme)
      ? input.darkTheme
      : DEFAULT_CODE_PREVIEW_SETTINGS.darkTheme,
    wrapLongLines: typeof input.wrapLongLines === "boolean"
      ? input.wrapLongLines
      : DEFAULT_CODE_PREVIEW_SETTINGS.wrapLongLines,
    fontSize: clampCodePreviewFontSize(input.fontSize)
  };
}

export function clampCodePreviewFontSize(value: unknown): number {
  const numeric = typeof value === "number" && Number.isFinite(value)
    ? Math.round(value)
    : DEFAULT_CODE_PREVIEW_SETTINGS.fontSize;
  return Math.min(CODE_PREVIEW_FONT_SIZE_MAX, Math.max(CODE_PREVIEW_FONT_SIZE_MIN, numeric));
}

function isCodePreviewThemeId(value: unknown): value is CodePreviewThemeId {
  return typeof value === "string" && CODE_PREVIEW_THEME_IDS.has(value as CodePreviewThemeId);
}
