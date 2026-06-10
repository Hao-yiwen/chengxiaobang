const EXTENSIONS: Record<string, string> = {
  bash: "sh",
  c: "c",
  "c++": "cpp",
  cc: "cpp",
  cjs: "js",
  cpp: "cpp",
  css: "css",
  diff: "diff",
  go: "go",
  h: "c",
  html: "html",
  ini: "ini",
  java: "java",
  javascript: "js",
  js: "js",
  json: "json",
  jsx: "jsx",
  kotlin: "kt",
  kt: "kt",
  markdown: "md",
  md: "md",
  mjs: "js",
  php: "php",
  plaintext: "txt",
  py: "py",
  python: "py",
  rb: "rb",
  rs: "rs",
  ruby: "rb",
  rust: "rs",
  scss: "scss",
  sh: "sh",
  shell: "sh",
  sql: "sql",
  swift: "swift",
  text: "txt",
  toml: "toml",
  ts: "ts",
  tsx: "tsx",
  typescript: "ts",
  xml: "xml",
  yaml: "yml",
  yml: "yml",
  zsh: "sh"
};

/** File extension for a fenced-code language tag; unknown languages get txt. */
export function extensionForLanguage(language?: string): string {
  if (!language) {
    return "txt";
  }
  return EXTENSIONS[language.toLowerCase()] ?? "txt";
}

/** Timestamped download name so consecutive code downloads don't collide. */
export function codeFileName(language?: string, now: Date = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").slice(0, 15);
  return `code-${stamp}.${extensionForLanguage(language)}`;
}
