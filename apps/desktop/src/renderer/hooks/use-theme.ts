import { useEffect, useRef } from "react";
import { useAppStore } from "@/store";

/** 主题切换过渡类（UI-SPEC §1.2）：仅颜色过渡 360ms，400ms 后摘除。 */
const THEME_SWITCH_CLASS = "theme-switching";
const THEME_SWITCH_DURATION_MS = 400;

/**
 * Resolves the chosen theme (light/dark/system) to a concrete appearance,
 * toggles the `.dark` class on <html>, and keeps the native Electron window
 * chrome (traffic lights / vibrancy) in sync via the preload bridge.
 *
 * On a real appearance flip (not the initial mount) it also mounts the
 * `theme-switching` class for 400ms so colors cross-fade (UI-SPEC §1.2).
 */
export function useThemeController(): void {
  const theme = useAppStore((state) => state.theme);
  const firstApplyRef = useRef(true);
  const switchTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const resolved = theme === "system" ? (media.matches ? "dark" : "light") : theme;
      const root = document.documentElement;
      const willBeDark = resolved === "dark";
      const isFlip = root.classList.contains("dark") !== willBeDark;
      if (!firstApplyRef.current && isFlip) {
        console.debug("[theme] appearance flip", { theme, resolved });
        root.classList.add(THEME_SWITCH_CLASS);
        if (switchTimerRef.current !== null) {
          window.clearTimeout(switchTimerRef.current);
        }
        switchTimerRef.current = window.setTimeout(() => {
          root.classList.remove(THEME_SWITCH_CLASS);
          switchTimerRef.current = null;
        }, THEME_SWITCH_DURATION_MS);
      }
      firstApplyRef.current = false;
      root.classList.toggle("dark", willBeDark);
      void window.chengxiaobang?.setThemeSource?.(theme);
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);
}
