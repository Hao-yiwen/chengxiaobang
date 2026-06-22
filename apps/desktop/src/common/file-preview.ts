export type PreviewKind =
  | "text"
  | "code"
  | "markdown"
  | "json"
  | "html"
  | "pdf"
  | "image"
  | "audio"
  | "video"
  | "spreadsheet"
  | "docx"
  | "presentation"
  | "unsupported";

export interface PreviewDescriptor {
  kind: PreviewKind;
  label: string;
  canPreview: boolean;
  binary: boolean;
}

export const TEXT_PREVIEW_MAX_BYTES = 512 * 1024;
export const BINARY_PREVIEW_MAX_BYTES = 25 * 1024 * 1024;
export const QUICK_LOOK_THUMBNAIL_SIZE = 1100;

const MARKDOWN_EXTENSIONS = new Set(["md", "markdown", "mdx"]);
const JSON_EXTENSIONS = new Set(["json", "jsonc", "map"]);
const HTML_EXTENSIONS = new Set(["html", "htm", "svg"]);
const PDF_EXTENSIONS = new Set(["pdf"]);
const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "ico",
  "avif",
  "heic"
]);
const AUDIO_EXTENSIONS = new Set(["mp3", "wav", "m4a", "aac", "ogg", "oga", "flac"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "mov", "m4v", "ogv", "avi"]);
const SPREADSHEET_EXTENSIONS = new Set(["xlsx", "xls", "xlsm", "csv", "tsv"]);
const DOCX_EXTENSIONS = new Set(["docx", "doc"]);
const PRESENTATION_EXTENSIONS = new Set(["pptx", "ppt"]);
const CODE_EXTENSIONS = new Set([
  "c",
  "cc",
  "cpp",
  "cs",
  "css",
  "dart",
  "go",
  "graphql",
  "java",
  "js",
  "jsx",
  "kt",
  "less",
  "lua",
  "m",
  "mm",
  "php",
  "py",
  "rb",
  "rs",
  "sass",
  "scss",
  "sh",
  "swift",
  "ts",
  "tsx",
  "vue",
  "xml"
]);
const TEXT_EXTENSIONS = new Set([
  "conf",
  "babelrc",
  "browserslistrc",
  "dockerignore",
  "editorconfig",
  "env",
  "eslintrc",
  "eslintignore",
  "gitignore",
  "ini",
  "lock",
  "log",
  "node-version",
  "npmrc",
  "npmignore",
  "prettierignore",
  "prettierrc",
  "stylelintrc",
  "sql",
  "text",
  "toml",
  "tool-versions",
  "txt",
  "yaml",
  "yml",
  "yarnrc"
]);

const DESCRIPTORS: Record<PreviewKind, PreviewDescriptor> = {
  text: { kind: "text", label: "文本", canPreview: true, binary: false },
  code: { kind: "code", label: "代码", canPreview: true, binary: false },
  markdown: { kind: "markdown", label: "Markdown", canPreview: true, binary: false },
  json: { kind: "json", label: "JSON", canPreview: true, binary: false },
  html: { kind: "html", label: "HTML / SVG", canPreview: true, binary: true },
  pdf: { kind: "pdf", label: "PDF", canPreview: true, binary: true },
  image: { kind: "image", label: "图片", canPreview: true, binary: true },
  audio: { kind: "audio", label: "音频", canPreview: true, binary: true },
  video: { kind: "video", label: "视频", canPreview: true, binary: true },
  spreadsheet: { kind: "spreadsheet", label: "表格", canPreview: true, binary: true },
  docx: { kind: "docx", label: "Word 文档", canPreview: true, binary: true },
  presentation: { kind: "presentation", label: "演示文稿", canPreview: true, binary: true },
  unsupported: { kind: "unsupported", label: "未知文件", canPreview: false, binary: true }
};

// 可作为产物卡展示的预览类型。这里使用归一化后的 kind，不直接列扩展名。
const ARTIFACT_PREVIEW_KINDS = new Set<PreviewKind>([
  "html",
  "pdf",
  "image",
  "audio",
  "video",
  "spreadsheet",
  "docx",
  "presentation",
  "markdown",
  "json"
]);

export function basenameOf(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  if (!trimmed) {
    return path;
  }
  return trimmed.split(/[\\/]/).pop() ?? trimmed;
}

export function isAbsolutePathLike(path: string): boolean {
  return path.startsWith("/") || path.startsWith("\\\\") || /^[A-Za-z]:[\\/]/.test(path);
}

export function extensionOf(path: string): string {
  const base = basenameOf(path);
  if (base.startsWith(".") && !base.includes(".", 1)) {
    return base.slice(1).toLowerCase();
  }
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

export function previewKindForPath(path: string): PreviewKind {
  const ext = extensionOf(path);
  if (MARKDOWN_EXTENSIONS.has(ext)) return "markdown";
  if (JSON_EXTENSIONS.has(ext)) return "json";
  if (HTML_EXTENSIONS.has(ext)) return "html";
  if (PDF_EXTENSIONS.has(ext)) return "pdf";
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (AUDIO_EXTENSIONS.has(ext)) return "audio";
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  if (SPREADSHEET_EXTENSIONS.has(ext)) return "spreadsheet";
  if (DOCX_EXTENSIONS.has(ext)) return "docx";
  if (PRESENTATION_EXTENSIONS.has(ext)) return "presentation";
  if (CODE_EXTENSIONS.has(ext)) return "code";
  if (TEXT_EXTENSIONS.has(ext)) return "text";
  return "unsupported";
}

export function previewDescriptorForPath(path: string): PreviewDescriptor {
  return DESCRIPTORS[previewKindForPath(path)];
}

export function previewDescriptorForKind(kind: PreviewKind): PreviewDescriptor {
  return DESCRIPTORS[kind];
}

export function isArtifactPreviewKind(kind: PreviewKind): boolean {
  return ARTIFACT_PREVIEW_KINDS.has(kind);
}

export function isTextualPreviewKind(kind: PreviewKind): boolean {
  return kind === "text" || kind === "code" || kind === "markdown" || kind === "json";
}

export function isFileUrlPreviewKind(kind: PreviewKind): boolean {
  return kind === "html" || kind === "image" || kind === "audio" || kind === "video";
}

export function isOfficePreviewKind(kind: PreviewKind): boolean {
  return kind === "docx" || kind === "spreadsheet" || kind === "presentation";
}

export function previewReadLimitForKind(kind: PreviewKind): number {
  return isTextualPreviewKind(kind) ? TEXT_PREVIEW_MAX_BYTES : BINARY_PREVIEW_MAX_BYTES;
}

const MARKDOWN_LOCAL_FILE_HREF_PREFIX = "https://chengxiaobang.local-file.invalid/file/";

export function markdownLocalFileHrefFromPath(path: string): string {
  return `${MARKDOWN_LOCAL_FILE_HREF_PREFIX}${encodeURIComponent(path)}`;
}

function markdownLocalFilePathFromHref(raw: string): string | null {
  if (!raw.startsWith(MARKDOWN_LOCAL_FILE_HREF_PREFIX)) {
    return null;
  }
  const encoded = raw.slice(MARKDOWN_LOCAL_FILE_HREF_PREFIX.length).split(/[?#]/, 1)[0] ?? "";
  if (!encoded) {
    return null;
  }
  try {
    return localFilePathCandidateFromHref(decodeURIComponent(encoded), { decode: false });
  } catch {
    return null;
  }
}

function localFilePathCandidateFromHref(
  raw: string,
  options: { decode?: boolean } = {}
): string | null {
  let path = raw.replace(/^file:\/\//i, "");
  if (options.decode !== false) {
    try {
      path = decodeURIComponent(path);
    } catch {
      // 解码失败时保留原始字符串，避免因非法转义序列抛错
    }
  }
  path = path.trim();
  if (!path || path.startsWith("#") || path.startsWith("?")) {
    return null;
  }
  if (isAbsolutePathLike(path) || previewKindForPath(path) !== "unsupported") {
    return path;
  }
  return null;
}

// 从 Markdown 链接的 href 中识别“可在右侧预览的本地文件引用”。
// - http(s)/mailto/tel 等网络链接返回 null（仍按外链处理，由系统浏览器打开）；
// - 显式拒绝 javascript:/vbscript:/data:/blob: 等危险或不可预览的协议；
// - 支持 file:// 前缀（剥离后按本地路径处理），并对百分号编码做一次解码；
// - 支持 Markdown 渲染层包裹过的内部本地文件 href，并还原成原始路径；
// - 仅当是绝对路径，或带已知可预览扩展名时，才认定为本地文件。
// 命中返回规整后的路径，否则返回 null。
export function localFilePathFromHref(href: string): string | null {
  const raw = href.trim();
  if (!raw) {
    return null;
  }
  const markdownLocalPath = markdownLocalFilePathFromHref(raw);
  if (markdownLocalPath) {
    return markdownLocalPath;
  }
  if (/^(https?|mailto|tel):/i.test(raw)) {
    return null;
  }
  if (/^(javascript|vbscript|data|blob):/i.test(raw)) {
    return null;
  }
  return localFilePathCandidateFromHref(raw);
}
