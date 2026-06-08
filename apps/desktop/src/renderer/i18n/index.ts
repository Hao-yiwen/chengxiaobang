import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import zh from "./locales/zh.json";
import en from "./locales/en.json";

export type Locale = "zh" | "en";
export const LOCALES: Locale[] = ["zh", "en"];
export const DEFAULT_LOCALE: Locale = "zh";

export const resources = {
  zh: { translation: zh },
  en: { translation: en }
} as const;

export function isLocale(value: unknown): value is Locale {
  return value === "zh" || value === "en";
}

/**
 * Initialize i18next once. The app's source of truth for the current language
 * is the persisted zustand store; `lng` is seeded from there at startup and
 * kept in sync via `useI18nController` (which calls `i18n.changeLanguage`).
 */
export function setupI18n(lng: Locale = DEFAULT_LOCALE): typeof i18n {
  if (!i18n.isInitialized) {
    void i18n.use(initReactI18next).init({
      resources,
      lng,
      fallbackLng: DEFAULT_LOCALE,
      interpolation: { escapeValue: false },
      returnNull: false
    });
  } else if (i18n.language !== lng) {
    void i18n.changeLanguage(lng);
  }
  return i18n;
}

// Auto-initialize on import (with the default locale) so any module that calls
// `i18n.t` or `useTranslation` works even outside the main entry — e.g. tests
// that render <App> directly. `main.tsx` re-seeds it with the persisted locale.
setupI18n();

export default i18n;
