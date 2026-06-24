import type { ComponentType } from "react";
import {
  AstroIcon,
  BabelIcon,
  BashIcon,
  BiomeIcon,
  BrowserslistIcon,
  BunIcon,
  CIcon,
  CppIcon,
  CssIcon,
  DatabaseIcon,
  DefaultIcon,
  DockerIcon,
  EslintIcon,
  ExcelDocumentIcon,
  GitIcon,
  GoIcon,
  GraphqlIcon,
  HtmlIcon,
  ImageIcon,
  JavaIcon,
  JavascriptIcon,
  JsonIcon,
  MarkdownIcon,
  McpIcon,
  NextjsIcon,
  NotebookIcon,
  NpmIcon,
  PdfIcon,
  PhpIcon,
  PostcssIcon,
  PrettierIcon,
  PythonIcon,
  ReactIcon,
  RubyIcon,
  RustIcon,
  SassIcon,
  StylelintIcon,
  SvgIcon,
  SvelteIcon,
  SwiftIcon,
  TailwindIcon,
  TerraformIcon,
  TextIcon,
  TomlIcon,
  TypescriptIcon,
  ViteIcon,
  VueIcon,
  WasmIcon,
  WebpackIcon,
  WordDocumentFileIcon,
  YmlIcon,
  ZigIcon,
  ZipIcon,
  type FileIconSvgProps
} from "@/assets/file-type-icons";

export type FileIconComponent = ComponentType<FileIconSvgProps>;

const LANGUAGE_ICON_BY_NAME: Record<string, FileIconComponent> = {
  astro: AstroIcon,
  bash: BashIcon,
  c: CIcon,
  cc: CppIcon,
  cjs: JavascriptIcon,
  cts: TypescriptIcon,
  cpp: CppIcon,
  csharp: DefaultIcon,
  css: CssIcon,
  dockerfile: DockerIcon,
  go: GoIcon,
  golang: GoIcon,
  graphql: GraphqlIcon,
  gql: GraphqlIcon,
  html: HtmlIcon,
  javascript: JavascriptIcon,
  js: JavascriptIcon,
  json: JsonIcon,
  jsonc: JsonIcon,
  jsx: ReactIcon,
  markdown: MarkdownIcon,
  md: MarkdownIcon,
  mdx: MarkdownIcon,
  mjs: JavascriptIcon,
  mts: TypescriptIcon,
  py: PythonIcon,
  python: PythonIcon,
  rb: RubyIcon,
  ruby: RubyIcon,
  rs: RustIcon,
  rust: RustIcon,
  sass: SassIcon,
  scss: SassIcon,
  sh: BashIcon,
  shell: BashIcon,
  shellscript: BashIcon,
  shellsession: BashIcon,
  sql: DatabaseIcon,
  svelte: SvelteIcon,
  swift: SwiftIcon,
  ts: TypescriptIcon,
  tsx: ReactIcon,
  text: TextIcon,
  plaintext: TextIcon,
  txt: TextIcon,
  typescript: TypescriptIcon,
  vue: VueIcon,
  wasm: WasmIcon,
  yaml: YmlIcon,
  yml: YmlIcon,
  zig: ZigIcon,
  zsh: BashIcon
};

const FILE_NAME_ICON_BY_NAME: Record<string, FileIconComponent> = {
  ".babelrc": BabelIcon,
  ".browserslistrc": BrowserslistIcon,
  ".dockerignore": DockerIcon,
  ".eslintignore": EslintIcon,
  ".eslintrc": EslintIcon,
  ".gitattributes": GitIcon,
  ".gitignore": GitIcon,
  ".gitlab-ci.yml": YmlIcon,
  ".gitmodules": GitIcon,
  ".npmrc": NpmIcon,
  ".prettierignore": PrettierIcon,
  ".prettierrc": PrettierIcon,
  ".stylelintrc": StylelintIcon,
  "babel.config.js": BabelIcon,
  "babel.config.json": BabelIcon,
  "babel.config.mjs": BabelIcon,
  "bun.lock": BunIcon,
  "bun.lockb": BunIcon,
  "dockerfile": DockerIcon,
  "eslint.config.cjs": EslintIcon,
  "eslint.config.js": EslintIcon,
  "eslint.config.mjs": EslintIcon,
  "eslint.config.ts": EslintIcon,
  "mcp.json": McpIcon,
  "next.config.js": NextjsIcon,
  "next.config.mjs": NextjsIcon,
  "next.config.ts": NextjsIcon,
  "package-lock.json": NpmIcon,
  "package.json": NpmIcon,
  "pnpm-lock.yaml": NpmIcon,
  "postcss.config.cjs": PostcssIcon,
  "postcss.config.js": PostcssIcon,
  "postcss.config.mjs": PostcssIcon,
  "postcss.config.ts": PostcssIcon,
  "prettier.config.cjs": PrettierIcon,
  "prettier.config.js": PrettierIcon,
  "prettier.config.mjs": PrettierIcon,
  "prettier.config.ts": PrettierIcon,
  "stylelint.config.cjs": StylelintIcon,
  "stylelint.config.js": StylelintIcon,
  "stylelint.config.mjs": StylelintIcon,
  "stylelint.config.ts": StylelintIcon,
  "tailwind.config.cjs": TailwindIcon,
  "tailwind.config.js": TailwindIcon,
  "tailwind.config.mjs": TailwindIcon,
  "tailwind.config.ts": TailwindIcon,
  "tsconfig.json": TypescriptIcon,
  "vite.config.js": ViteIcon,
  "vite.config.mjs": ViteIcon,
  "vite.config.ts": ViteIcon,
  "webpack.config.cjs": WebpackIcon,
  "webpack.config.js": WebpackIcon,
  "webpack.config.mjs": WebpackIcon,
  "webpack.config.ts": WebpackIcon,
  "yarn.lock": NpmIcon
};

const FILE_NAME_PREFIX_ICONS: Array<[prefix: string, icon: FileIconComponent]> = [
  ["dockerfile.", DockerIcon],
  [".eslintrc.", EslintIcon],
  [".prettierrc.", PrettierIcon],
  [".stylelintrc.", StylelintIcon]
];

const FILE_EXTENSION_ICONS: Record<string, FileIconComponent> = {
  astro: AstroIcon,
  bash: BashIcon,
  biome: BiomeIcon,
  c: CIcon,
  cc: CppIcon,
  cjs: JavascriptIcon,
  cts: TypescriptIcon,
  cpp: CppIcon,
  csv: ExcelDocumentIcon,
  css: CssIcon,
  db: DatabaseIcon,
  doc: WordDocumentFileIcon,
  docx: WordDocumentFileIcon,
  go: GoIcon,
  gql: GraphqlIcon,
  graphql: GraphqlIcon,
  h: CIcon,
  hh: CppIcon,
  hpp: CppIcon,
  hxx: CppIcon,
  html: HtmlIcon,
  ipynb: NotebookIcon,
  java: JavaIcon,
  jpeg: ImageIcon,
  jpg: ImageIcon,
  js: JavascriptIcon,
  json: JsonIcon,
  jsonc: JsonIcon,
  jsx: ReactIcon,
  lock: NpmIcon,
  log: TextIcon,
  md: MarkdownIcon,
  mdx: MarkdownIcon,
  mjs: JavascriptIcon,
  mts: TypescriptIcon,
  pdf: PdfIcon,
  php: PhpIcon,
  png: ImageIcon,
  py: PythonIcon,
  rb: RubyIcon,
  rs: RustIcon,
  sass: SassIcon,
  scss: SassIcon,
  sh: BashIcon,
  sqlite: DatabaseIcon,
  sqlite3: DatabaseIcon,
  sql: DatabaseIcon,
  svg: SvgIcon,
  svelte: SvelteIcon,
  swift: SwiftIcon,
  tf: TerraformIcon,
  tfvars: TerraformIcon,
  toml: TomlIcon,
  ts: TypescriptIcon,
  tsx: ReactIcon,
  txt: TextIcon,
  vue: VueIcon,
  wasm: WasmIcon,
  xls: ExcelDocumentIcon,
  xlsx: ExcelDocumentIcon,
  yaml: YmlIcon,
  yml: YmlIcon,
  zig: ZigIcon,
  zsh: BashIcon,
  zip: ZipIcon
};

export function normalizeCodeLanguage(language: string | undefined): string {
  const normalized = (language ?? "").trim().toLowerCase();
  if (!normalized) {
    return "text";
  }
  return normalized.replace(/^language-/, "");
}

export function resolveCodeLanguageIcon(language: string | undefined): FileIconComponent {
  const normalized = normalizeCodeLanguage(language);
  return LANGUAGE_ICON_BY_NAME[normalized] ?? FILE_EXTENSION_ICONS[normalized] ?? DefaultIcon;
}

export function resolveFileTypeIcon(path: string | undefined): FileIconComponent {
  const baseName = basenameOf(path ?? "").toLowerCase();
  const nameIcon = FILE_NAME_ICON_BY_NAME[baseName] ?? prefixIconForName(baseName);
  if (nameIcon) {
    return nameIcon;
  }
  return resolveCodeLanguageIcon(extensionOf(baseName));
}

function basenameOf(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  if (!trimmed) {
    return path;
  }
  return trimmed.split(/[\\/]/).pop() ?? trimmed;
}

function extensionOf(path: string): string {
  const base = basenameOf(path);
  if (base.startsWith(".") && !base.includes(".", 1)) {
    return base.slice(1).toLowerCase();
  }
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

function prefixIconForName(name: string): FileIconComponent | undefined {
  return FILE_NAME_PREFIX_ICONS.find(([prefix]) => name.startsWith(prefix))?.[1];
}
