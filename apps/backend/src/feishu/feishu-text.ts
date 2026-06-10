/** Default chunk size — far below Feishu's limit but keeps messages readable. */
const DEFAULT_MAX_CHARS = 3800;

/** Splits a long reply into Feishu-sized chunks, preferring newline boundaries. */
export function chunkFeishuText(text: string, max = DEFAULT_MAX_CHARS): string[] {
  if (text.length <= max) {
    return [text];
  }
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > max) {
    let cut = remaining.lastIndexOf("\n", max);
    if (cut <= 0) {
      cut = max;
    }
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).replace(/^\n/, "");
  }
  if (remaining) {
    chunks.push(remaining);
  }
  return chunks;
}
