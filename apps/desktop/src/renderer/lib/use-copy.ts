import { useState } from "react";

/** Clipboard write with a transient "copied" flag for button feedback. */
export function useCopy(resetMs = 1500): {
  copied: boolean;
  copy: (text: string) => Promise<void>;
} {
  const [copied, setCopied] = useState(false);

  async function copy(text: string): Promise<void> {
    try {
      await navigator.clipboard?.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), resetMs);
    } catch {
      // Clipboard unavailable or denied — fail silently rather than disrupt the chat.
    }
  }

  return { copied, copy };
}
