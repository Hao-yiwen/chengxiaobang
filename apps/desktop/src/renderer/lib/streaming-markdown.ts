import { Lexer } from "marked";
import remend from "remend";

// Keep documents with footnotes as a single block — splitting would separate
// references from their definitions and break remark-gfm's footnote rendering.
// (Patterns mirror streamdown's parse-blocks.)
const FOOTNOTE_REFERENCE = /\[\^[\w-]{1,200}\](?!:)/;
const FOOTNOTE_DEFINITION = /\[\^[\w-]{1,200}\]:/;

/**
 * 入场动画保险丝（UI-SPEC §4.3）：单次 flush 涌入的 delta 文本超过该字节数
 * （大段代码粘贴/工具输出）时，本批新块跳过 `animate-msg-in` 直接渲染，
 * 杜绝动画排队的爬行感。
 */
export const STREAM_ANIM_FUSE_BYTES = 2048;

/**
 * Repairs the incomplete tail of streaming Markdown (remend, the library
 * behind streamdown's `parseIncompleteMarkdown`): closes dangling `**`/`*`/
 * `~~`/`` ` ``, rewrites half-arrived links to the `streamdown:incomplete-link`
 * placeholder (which our renderer shows as plain text), and drops half-arrived
 * images — so formatting appears immediately instead of flickering in as raw
 * marker characters.
 */
export function repairStreamingMarkdown(text: string): string {
  return remend(text);
}

/**
 * 两串的最小改写偏移 = 公共前缀长度（UI-SPEC §4.2 规则 1）。
 *
 * 两种用法：
 * - `repairStart(原文, remend(原文))` —— remend 本次实际改写的最小偏移
 *   （remend 只返回字符串，不返回偏移，自行 diff 求得）；
 * - `repairStart(上一帧修复文, 本帧修复文)` —— 跨 delta 的稳定边界：完全位于
 *   该偏移之前的块，其 key 必须保持不变。
 *
 * 两串相同时返回串长（即「改写从末尾开始」＝什么都没改）。
 */
export function repairStart(before: string, after: string): number {
  const max = Math.min(before.length, after.length);
  let i = 0;
  while (i < max && before.charCodeAt(i) === after.charCodeAt(i)) {
    i += 1;
  }
  return i;
}

/** 流式渲染管线里的一个顶层块（UI-SPEC §4.2）。 */
export interface StreamBlock {
  /** `${blockStartOffset}:${blockType}`，作为 React key。 */
  key: string;
  /** 块原文（lexer 的 token.raw，无损）。 */
  raw: string;
  /** marked 的 token 类型（paragraph/list/code/heading…；脚注整文档为 "document"）。 */
  type: string;
  /** 块在（修复后）全文中的起始偏移（UTF-16 码元计）。 */
  startOffset: number;
}

/**
 * 以 marked lexer 切顶层块并标注偏移哈希 key（UI-SPEC §4.2）。
 *
 * key 稳定性的生效前提（勿破坏）：流式输入是 **append-only**，remend 修复只
 * 改写尾部切片。因此前缀块的 startOffset/type 在 delta 间恒定 → key 稳定，
 * 只有 `startOffset ≥ repairStart` 的尾部块（合并/分裂场景，通常仅最后 1–2 块）
 * 允许 key 失效重渲。
 *
 * 偏移按 lexer 全部 token（含被丢弃的纯空行 token）的 raw 长度累加，保证无损；
 * 纯空行 token 不输出（块间距由 CSS 负责）。
 */
export function lexStreamBlocks(markdown: string): StreamBlock[] {
  if (FOOTNOTE_REFERENCE.test(markdown) || FOOTNOTE_DEFINITION.test(markdown)) {
    return [{ key: "0:document", raw: markdown, type: "document", startOffset: 0 }];
  }
  const blocks: StreamBlock[] = [];
  let offset = 0;
  for (const token of Lexer.lex(markdown, { gfm: true })) {
    const { raw, type } = token;
    if (raw.trim().length > 0) {
      blocks.push({ key: `${offset}:${type}`, raw, type, startOffset: offset });
    }
    offset += raw.length;
  }
  return blocks;
}

/**
 * Splits Markdown into top-level blocks via marked's lexer so each block can
 * be rendered as its own memoized component during streaming — per delta only
 * the trailing block re-parses. The lexer is lossless and keeps multi-line
 * constructs (fenced code, loose lists, tables) as single blocks; pure
 * blank-line tokens are dropped because block spacing comes from CSS.
 */
export function splitMarkdownBlocks(markdown: string): string[] {
  return lexStreamBlocks(markdown).map((block) => block.raw);
}

/** UTF-8 字节数（§4.3 保险丝以字节计，2KB＝2048 bytes）。 */
export function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}
