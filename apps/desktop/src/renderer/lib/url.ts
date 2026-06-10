/**
 * Normalize address-bar input into a browsable http(s) URL.
 * - bare port ("5173") → local dev server on 127.0.0.1
 * - scheme-less ("example.com") → https
 * Returns undefined for empty or non-http(s) input.
 */
export function normalizeBrowserUrl(input: string): string | undefined {
  const trimmed = input.trim();
  if (!trimmed) {
    return undefined;
  }
  if (/^\d{2,5}$/.test(trimmed)) {
    return `http://127.0.0.1:${trimmed}/`;
  }
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
}
