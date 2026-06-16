import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { bundledLanguages, codeToTokensWithThemes, type BundledLanguage } from "shiki";
import type { CodePreviewSettings } from "@/lib/code-preview-settings";
import { normalizeCodeLanguage } from "@/lib/code-language-icons";

const SHIKI_LANGUAGE_ALIASES: Record<string, string> = {
  cjs: "javascript",
  js: "javascript",
  jsx: "jsx",
  mjs: "javascript",
  ts: "typescript",
  tsx: "tsx",
  yml: "yaml"
};

export type HighlightTokenVariant = {
  color?: string;
  fontStyle?: number;
};

export type HighlightToken = {
  content: string;
  variants?: Record<string, HighlightTokenVariant | undefined>;
};

export type HighlightLine = HighlightToken[];

export function useShikiHighlight(
  text: string,
  languageOrExtension: string | undefined,
  settings: CodePreviewSettings,
  source = "code-preview"
): { language: string; lines?: HighlightLine[] } {
  const shikiLanguage = useMemo(
    () => resolveShikiLanguage(languageOrExtension),
    [languageOrExtension]
  );
  const displayLanguage = shikiLanguage ?? normalizeCodeLanguage(languageOrExtension);
  const [lines, setLines] = useState<HighlightLine[] | undefined>();

  useEffect(() => {
    if (!shikiLanguage) {
      setLines(undefined);
      return;
    }
    let cancelled = false;
    setLines(undefined);
    void codeToTokensWithThemes(text, {
      lang: shikiLanguage,
      themes: {
        light: settings.lightTheme,
        dark: settings.darkTheme
      }
    }).then(
      (tokens) => {
        if (!cancelled) {
          setLines(tokens as HighlightLine[]);
        }
      },
      (error) => {
        if (!cancelled) {
          console.warn("[code-highlight] 代码高亮失败，回退纯文本预览", {
            source,
            language: shikiLanguage,
            error: error instanceof Error ? error.message : String(error)
          });
          setLines(undefined);
        }
      }
    );
    return () => {
      cancelled = true;
    };
  }, [settings.darkTheme, settings.lightTheme, shikiLanguage, source, text]);

  return { language: displayLanguage, lines };
}

export function codePreviewInlineStyle(settings: CodePreviewSettings): CSSProperties {
  const fontSize = `${settings.fontSize}px`;
  const lineHeight = `${settings.fontSize + 8}px`;
  return {
    "--cxb-code-font-size": fontSize,
    "--cxb-code-line-height": lineHeight,
    fontSize,
    lineHeight
  } as CSSProperties;
}

export function shikiTokenStyle(token: HighlightToken): CSSProperties {
  const light = token.variants?.light;
  const dark = token.variants?.dark;
  const fontStyle = light?.fontStyle ?? dark?.fontStyle ?? 0;
  return {
    "--cxb-shiki-light": light?.color ?? "inherit",
    "--cxb-shiki-dark": dark?.color ?? light?.color ?? "inherit",
    fontStyle: fontStyle & 1 ? "italic" : undefined,
    fontWeight: fontStyle & 2 ? 600 : undefined,
    textDecorationLine: fontStyle & 4 ? "underline" : undefined
  } as CSSProperties;
}

export function normalizeCodePreviewText(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

export function splitCodePreviewLines(text: string): string[] {
  return text.split("\n");
}

function resolveShikiLanguage(value: string | undefined): BundledLanguage | undefined {
  const normalized = normalizeCodeLanguage(value);
  const candidate = SHIKI_LANGUAGE_ALIASES[normalized] ?? normalized;
  return isBundledLanguage(candidate) ? candidate : undefined;
}

function isBundledLanguage(language: string): language is BundledLanguage {
  return Object.prototype.hasOwnProperty.call(bundledLanguages, language);
}
