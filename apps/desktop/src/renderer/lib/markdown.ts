/**
 * A tiny, dependency-free Markdown tokenizer tuned for what the assistant
 * actually emits: paragraphs, fenced code blocks, inline `code`, **bold**,
 * headings, and ordered/unordered lists. Pure and synchronous so it can be
 * unit-tested and rendered without a heavyweight Markdown library.
 *
 * The renderer ({@link "../components/Markdown"}) consumes these tokens.
 */

export type Inline =
  | { type: "text"; value: string }
  | { type: "code"; value: string }
  | { type: "bold"; value: string }
  | { type: "link"; value: string; href: string };

export type Block =
  | { type: "paragraph"; inlines: Inline[] }
  | { type: "heading"; level: number; inlines: Inline[] }
  | { type: "code"; lang?: string; content: string }
  | { type: "list"; ordered: boolean; items: Inline[][] };

const INLINE_RE = /`([^`]+)`|\*\*([^*]+?)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
const FENCE_RE = /^```(\w*)\s*$/;
const FENCE_CLOSE_RE = /^```\s*$/;
const HEADING_RE = /^(#{1,3})\s+(.*)$/;
const BULLET_RE = /^\s*[-*]\s+(.*)$/;
const ORDERED_RE = /^\s*\d+\.\s+(.*)$/;

/** Split a single line of text into inline runs (text / inline-code / bold). */
export function parseInline(text: string): Inline[] {
  const tokens: Inline[] = [];
  let lastIndex = 0;
  INLINE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = INLINE_RE.exec(text))) {
    if (match.index > lastIndex) {
      tokens.push({ type: "text", value: text.slice(lastIndex, match.index) });
    }
    if (match[1] !== undefined) {
      tokens.push({ type: "code", value: match[1] });
    } else if (match[2] !== undefined) {
      tokens.push({ type: "bold", value: match[2] });
    } else {
      tokens.push({ type: "link", value: match[3], href: match[4] });
    }
    lastIndex = INLINE_RE.lastIndex;
  }
  if (lastIndex < text.length) {
    tokens.push({ type: "text", value: text.slice(lastIndex) });
  }
  return tokens.length > 0 ? tokens : [{ type: "text", value: "" }];
}

/** Group raw Markdown text into block-level tokens. */
export function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let paragraph: string[] = [];

  function flushParagraph(): void {
    if (paragraph.length > 0) {
      blocks.push({ type: "paragraph", inlines: parseInline(paragraph.join("\n")) });
      paragraph = [];
    }
  }

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    const fence = line.match(FENCE_RE);
    if (fence) {
      flushParagraph();
      const buffer: string[] = [];
      i += 1;
      while (i < lines.length && !FENCE_CLOSE_RE.test(lines[i])) {
        buffer.push(lines[i]);
        i += 1;
      }
      i += 1; // skip the closing fence
      blocks.push({ type: "code", lang: fence[1] || undefined, content: buffer.join("\n") });
      continue;
    }

    if (line.trim() === "") {
      flushParagraph();
      i += 1;
      continue;
    }

    const heading = line.match(HEADING_RE);
    if (heading) {
      flushParagraph();
      blocks.push({ type: "heading", level: heading[1].length, inlines: parseInline(heading[2]) });
      i += 1;
      continue;
    }

    if (BULLET_RE.test(line) || ORDERED_RE.test(line)) {
      flushParagraph();
      const ordered = ORDERED_RE.test(line);
      const items: Inline[][] = [];
      while (i < lines.length) {
        const itemMatch = ordered ? lines[i].match(ORDERED_RE) : lines[i].match(BULLET_RE);
        if (!itemMatch) {
          break;
        }
        items.push(parseInline(itemMatch[1]));
        i += 1;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }

    paragraph.push(line);
    i += 1;
  }

  flushParagraph();
  return blocks;
}
