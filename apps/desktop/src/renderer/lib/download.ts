/**
 * Saves `text` as `filename` via a Blob link. Electron's default
 * will-download behaviour shows the native save dialog; browser preview
 * downloads normally. No-op where object URLs are unavailable (jsdom).
 */
export function downloadTextFile(filename: string, text: string): void {
  if (typeof URL.createObjectURL !== "function") {
    return;
  }
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
