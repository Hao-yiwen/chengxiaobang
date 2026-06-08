import { useEffect } from "react";
import { useAppStore } from "@/store";

/**
 * Resolves the chosen theme (light/dark/system) to a concrete appearance,
 * toggles the `.dark` class on <html>, and keeps the native Electron window
 * chrome (traffic lights / vibrancy) in sync via the preload bridge.
 */
export function useThemeController(): void {
  const theme = useAppStore((state) => state.theme);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const resolved = theme === "system" ? (media.matches ? "dark" : "light") : theme;
      document.documentElement.classList.toggle("dark", resolved === "dark");
      void window.chengxiaobang?.setThemeSource?.(theme);
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);
}
