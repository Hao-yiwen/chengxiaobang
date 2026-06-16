import { useState } from "react";

/** 写入剪贴板，成功后短暂展示「已复制」反馈。 */
export function useCopy(resetMs = 1500): {
  copied: boolean;
  copy: (text: string) => Promise<void>;
} {
  const [copied, setCopied] = useState(false);

  async function copy(text: string): Promise<void> {
    const writeText = navigator.clipboard?.writeText;
    if (!writeText) {
      console.warn("[clipboard] 复制失败：当前环境没有剪贴板写入能力", {
        textLength: text.length
      });
      return;
    }
    try {
      await writeText.call(navigator.clipboard, text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), resetMs);
    } catch (error) {
      console.warn("[clipboard] 复制到剪贴板失败", {
        textLength: text.length,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return { copied, copy };
}
