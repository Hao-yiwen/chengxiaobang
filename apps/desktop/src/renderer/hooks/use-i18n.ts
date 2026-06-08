import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
import { useAppStore } from "@/store";

/**
 * Keeps i18next's active language in sync with the persisted store locale.
 * The store is the single source of truth; this drives `i18n.changeLanguage`
 * whenever the user switches language. Subscribing to `useTranslation` here
 * ensures the host component re-renders on `languageChanged`.
 */
export function useI18nController(): void {
  const locale = useAppStore((state) => state.locale);
  useTranslation();

  useEffect(() => {
    if (i18n.language !== locale) {
      void i18n.changeLanguage(locale);
    }
  }, [locale]);
}
