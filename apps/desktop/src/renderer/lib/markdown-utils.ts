/**
 * Pure helpers behind the Markdown renderer (components/Markdown.tsx).
 * Dependency-free and node-testable.
 */

/** Minimal structural view of a hast node, compatible with react-markdown's. */
export interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  children?: HastNode[];
  properties?: Record<string, unknown>;
}

/** Only http(s) links are linkified — the main process opens those externally. */
export function isSafeHref(href: string): boolean {
  return /^https?:\/\//i.test(href);
}

/** Concatenated text content of a hast subtree (e.g. highlighted code spans). */
export function hastText(node: HastNode | undefined): string {
  if (!node) {
    return "";
  }
  if (node.type === "text") {
    return node.value ?? "";
  }
  return (node.children ?? []).map(hastText).join("");
}

/** Extracts `x` from a `language-x` class, given a string or hast class list. */
export function languageFromClass(className: unknown): string | undefined {
  const classes = Array.isArray(className)
    ? className.map(String)
    : typeof className === "string"
      ? className.split(/\s+/)
      : [];
  const entry = classes.find((value) => value.startsWith("language-"));
  return entry ? entry.slice("language-".length).toLowerCase() : undefined;
}

/**
 * Rehype plugin tagging `pre > code` with `data-code-block` so the `code`
 * renderer can tell blocks from inline code — class names alone can't, since
 * rehype-highlight leaves language-less blocks untouched.
 */
export function rehypeMarkCodeBlocks() {
  return (tree: HastNode): void => {
    walk(tree);
  };
}

function walk(node: HastNode): void {
  for (const child of node.children ?? []) {
    if (node.tagName === "pre" && child.tagName === "code") {
      child.properties = { ...child.properties, dataCodeBlock: "" };
    }
    walk(child);
  }
}
