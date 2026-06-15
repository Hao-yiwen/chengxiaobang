const iconModules = import.meta.glob<string>("../assets/file-type-icons/*.svg", {
  eager: true,
  import: "default",
  query: "?url"
});

const LANGUAGE_ICON_ALIASES: Record<string, string> = {
  bash: "bash",
  c: "c",
  cc: "cpp",
  cjs: "javascript",
  cpp: "cpp",
  csharp: "default",
  css: "css",
  dockerfile: "docker",
  go: "go",
  golang: "go",
  graphql: "graphql",
  gql: "graphql",
  html: "html",
  javascript: "javascript",
  js: "javascript",
  json: "json",
  jsonc: "json",
  jsx: "react",
  markdown: "markdown",
  md: "markdown",
  mdx: "markdown",
  mjs: "javascript",
  py: "python",
  python: "python",
  rb: "ruby",
  ruby: "ruby",
  rs: "rust",
  rust: "rust",
  sass: "sass",
  scss: "sass",
  sh: "bash",
  shell: "bash",
  shellscript: "bash",
  shellsession: "bash",
  sql: "database",
  svelte: "svelte",
  swift: "swift",
  ts: "typescript",
  tsx: "react",
  text: "text",
  plaintext: "text",
  txt: "text",
  typescript: "typescript",
  vue: "vue",
  yaml: "yml",
  yml: "yml",
  zig: "zig",
  zsh: "bash"
};

const DEFAULT_ICON_TOKEN = "default";

export function normalizeCodeLanguage(language: string | undefined): string {
  const normalized = (language ?? "").trim().toLowerCase();
  if (!normalized) {
    return "text";
  }
  return normalized.replace(/^language-/, "");
}

export function resolveCodeLanguageIcon(language: string | undefined): string {
  const normalized = normalizeCodeLanguage(language);
  const token = LANGUAGE_ICON_ALIASES[normalized] ?? normalized;
  return iconForToken(token) ?? iconForToken(DEFAULT_ICON_TOKEN) ?? "";
}

function iconForToken(token: string): string | undefined {
  return iconModules[`../assets/file-type-icons/${token}.svg`];
}
