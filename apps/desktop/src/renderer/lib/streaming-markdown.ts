import { Lexer } from "marked";
import remend from "remend";

// Keep documents with footnotes as a single block — splitting would separate
// references from their definitions and break remark-gfm's footnote rendering.
// (Patterns mirror streamdown's parse-blocks.)
const FOOTNOTE_REFERENCE = /\[\^[\w-]{1,200}\](?!:)/;
const FOOTNOTE_DEFINITION = /\[\^[\w-]{1,200}\]:/;

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
 * Splits Markdown into top-level blocks via marked's lexer so each block can
 * be rendered as its own memoized component during streaming — per delta only
 * the trailing block re-parses. The lexer is lossless and keeps multi-line
 * constructs (fenced code, loose lists, tables) as single blocks; pure
 * blank-line tokens are dropped because block spacing comes from CSS.
 */
export function splitMarkdownBlocks(markdown: string): string[] {
  if (FOOTNOTE_REFERENCE.test(markdown) || FOOTNOTE_DEFINITION.test(markdown)) {
    return [markdown];
  }
  return Lexer.lex(markdown, { gfm: true })
    .map((token) => token.raw)
    .filter((block) => block.trim().length > 0);
}
