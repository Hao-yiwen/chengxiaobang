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
  "env",
  "gitignore",
  "ini",
  "lock",
  "log",
  "sql",
  "text",
  "toml",
  "txt",
  "yaml",
  "yml"
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

export function basenameOf(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
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
