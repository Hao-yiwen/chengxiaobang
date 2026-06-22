import {
  ArrowLeftIcon,
  ArrowTopRightIcon,
  CheckMediumIcon,
  CopyIcon,
  MinusIcon,
  PlusIcon,
  RefreshIcon,
  TextDocumentGrayIcon,
  UndoIcon,
  WarningCircleIcon
} from "@/assets/file-type-icons";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CodePreviewLines } from "@/components/CodePreviewLines";
import {
  resolveFileTypeIcon
} from "@/lib/code-language-icons";
import {
  codePreviewInlineStyle,
  normalizeCodePreviewText,
  splitCodePreviewLines,
  useShikiHighlight
} from "@/lib/code-highlight";
import { useTranslation } from "react-i18next";
import pdfjsModuleUrl from "pdfjs-dist/build/pdf.min.mjs?url";
import pdfjsWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { PptxViewer as PptxViewerInstance } from "@aiden0z/pptx-renderer";
import { Markdown } from "@/components/Markdown";
import { ProjectFileTree } from "./ProjectFileTree";
import {
  BINARY_PREVIEW_MAX_BYTES,
  TEXT_PREVIEW_MAX_BYTES,
  isFileUrlPreviewKind,
  isTextualPreviewKind,
  type PreviewKind
} from "../../../common/file-preview";
import { selectActiveProject, useAppStore } from "@/store";
import { RIGHT_PANEL_PROJECT_FILES_WIDTH } from "@/store/helpers/right-panel";
import type { FilePreviewInfo } from "@/global";
import { cn } from "@/lib/utils";

type PreviewState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; path?: string; name?: string; error: string }
  | {
      status: "ready";
      info: FilePreviewInfo;
      text?: string;
      data?: ArrayBuffer;
      fileUrl?: string;
      thumbnailUrl?: string;
      thumbnailError?: string;
      truncated?: boolean;
    };

const ICON_BUTTON =
  "flex size-7 flex-none items-center justify-center rounded-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40";

interface FilePreviewPanelProps {
  projectFilesOpen: boolean;
  onProjectFilesOpenChange(open: boolean): void;
}

export function FilePreviewPanel({
  projectFilesOpen,
  onProjectFilesOpenChange
}: FilePreviewPanelProps) {
  const { t } = useTranslation();
  const previewFile = useAppStore((state) => state.previewFile);
  const openFilePreview = useAppStore((state) => state.openFilePreview);
  const setNotice = useAppStore((state) => state.setNotice);
  const project = useAppStore(selectActiveProject);
  const [preview, setPreview] = useState<PreviewState>({ status: "idle" });
  const [refreshKey, setRefreshKey] = useState(0);
  const path = previewFile?.path;
  const previewContext = useMemo(
    () => ({
      ...(previewFile?.projectPath ? { projectPath: previewFile.projectPath } : {}),
      ...(previewFile?.sessionId ? { sessionId: previewFile.sessionId } : {}),
      ...(previewFile?.allowCwdFallback === false ? { allowCwdFallback: false } : {})
    }),
    [previewFile?.allowCwdFallback, previewFile?.projectPath, previewFile?.sessionId]
  );

  const loadPreview = useCallback(async (
    targetPath: string,
    context: { projectPath?: string; sessionId?: string; allowCwdFallback?: boolean }
  ): Promise<PreviewState> => {
    const bridge = window.chengxiaobang;
    if (!bridge?.getFilePreviewInfo) {
      console.warn("[FilePreviewPanel] 缺少文件预览 IPC 能力");
      return { status: "error", path: targetPath, error: t("rightPanel.fileDesktopOnly") };
    }
    const info = await bridge.getFilePreviewInfo(targetPath, context);
    if (!info.ok) {
      console.warn("[FilePreviewPanel] 文件信息读取失败", { path: targetPath, error: info.error });
      return { status: "error", path: targetPath, name: info.name, error: info.error };
    }
    if (info.kind === "unsupported") {
      console.info("[FilePreviewPanel] 文件类型暂无内嵌预览，进入兜底页", {
        path: info.path,
        extension: info.extension
      });
      return { status: "ready", info };
    }
    if (isTextualPreviewKind(info.kind)) {
      if (!bridge.readFilePreviewText) {
        return { status: "error", path: info.path, name: info.name, error: t("rightPanel.fileDesktopOnly") };
      }
      const result = await bridge.readFilePreviewText(info.path, { maxBytes: TEXT_PREVIEW_MAX_BYTES });
      if (!result.ok) {
        console.warn("[FilePreviewPanel] 文本预览读取失败", { path: info.path, error: result.error });
        return { status: "error", path: info.path, name: info.name, error: result.error };
      }
      return {
        status: "ready",
        info,
        text: normalizeTextForKind(info.kind, result.text),
        truncated: result.truncated
      };
    }
    if (info.kind === "image") {
      if (!bridge.readFilePreviewBuffer) {
        return { status: "error", path: info.path, name: info.name, error: t("rightPanel.fileDesktopOnly") };
      }
      console.info("[FilePreviewPanel] 图片进入二进制预览", {
        path: info.path,
        size: info.size
      });
      const result = await bridge.readFilePreviewBuffer(info.path, { maxBytes: BINARY_PREVIEW_MAX_BYTES });
      if (!result.ok) {
        console.warn("[FilePreviewPanel] 图片预览读取失败", { path: info.path, error: result.error });
        return { status: "error", path: info.path, name: info.name, error: result.error };
      }
      return { status: "ready", info, data: result.data, truncated: result.truncated };
    }
    if (isFileUrlPreviewKind(info.kind)) {
      if (!bridge.createFileUrl) {
        return { status: "error", path: info.path, name: info.name, error: t("rightPanel.fileDesktopOnly") };
      }
      const result = await bridge.createFileUrl(info.path);
      if (!result.ok) {
        console.warn("[FilePreviewPanel] 本地预览 URL 创建失败", { path: info.path, error: result.error });
        return { status: "error", path: info.path, name: info.name, error: result.error };
      }
      return { status: "ready", info, fileUrl: result.url };
    }
    if (info.kind === "presentation" && info.extension === "pptx") {
      if (!bridge.readFilePreviewBuffer) {
        return { status: "error", path: info.path, name: info.name, error: t("rightPanel.fileDesktopOnly") };
      }
      console.info("[FilePreviewPanel] PPTX 进入本地多页预览", {
        path: info.path,
        size: info.size
      });
      const result = await bridge.readFilePreviewBuffer(info.path, { maxBytes: BINARY_PREVIEW_MAX_BYTES });
      if (!result.ok) {
        console.warn("[FilePreviewPanel] PPTX 预览读取失败", { path: info.path, error: result.error });
        return { status: "error", path: info.path, name: info.name, error: result.error };
      }
      return { status: "ready", info, data: result.data, truncated: result.truncated };
    }
    if (info.kind === "presentation" || (info.kind === "docx" && info.extension === "doc")) {
      const thumbnail = await bridge.createQuickLookThumbnail?.(info.path);
      if (!thumbnail?.ok) {
        console.info("[FilePreviewPanel] Quick Look 缩略图不可用，展示兜底页", {
          path: info.path,
          error: thumbnail?.error
        });
      }
      return {
        status: "ready",
        info,
        thumbnailUrl: thumbnail?.ok ? thumbnail.url : undefined,
        thumbnailError: thumbnail?.ok ? undefined : thumbnail?.error
      };
    }
    if (!bridge.readFilePreviewBuffer) {
      return { status: "error", path: info.path, name: info.name, error: t("rightPanel.fileDesktopOnly") };
    }
    const result = await bridge.readFilePreviewBuffer(info.path, { maxBytes: BINARY_PREVIEW_MAX_BYTES });
    if (!result.ok) {
      console.warn("[FilePreviewPanel] 二进制预览读取失败", { path: info.path, error: result.error });
      return { status: "error", path: info.path, name: info.name, error: result.error };
    }
    return { status: "ready", info, data: result.data, truncated: result.truncated };
  }, [t]);

  useEffect(() => {
    if (!path) {
      setPreview({ status: "idle" });
      return;
    }
    let cancelled = false;
    setPreview({ status: "loading" });
    void loadPreview(path, previewContext).then((result) => {
      if (!cancelled) {
        setPreview(result);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [path, previewContext, refreshKey, loadPreview]);

  async function openSystem(pathToOpen: string): Promise<void> {
    if (!window.chengxiaobang?.openPath) {
      setNotice(t("notice.openArtifactDesktopOnly"));
      return;
    }
    const result = await window.chengxiaobang.openPath(pathToOpen);
    if (!result.ok) {
      console.warn("[FilePreviewPanel] 系统打开文件失败", { path: pathToOpen, error: result.error });
      setNotice(result.error ? `打开文件失败：${result.error}` : t("rightPanel.fileLoadFailed"));
    }
  }

  function openProjectFile(relativePath: string): void {
    console.info("[FilePreviewPanel] 从常驻项目文件树打开预览", {
      projectId: project?.id,
      path: relativePath
    });
    openFilePreview(relativePath, { source: "project-tree" });
  }

  function collapseProjectFilesFromPreviewContent(): void {
    if (!projectFilesOpen) {
      return;
    }
    console.debug("[FilePreviewPanel] 点击文件预览内容，自动收起项目文件树", {
      projectId: project?.id,
      previewPath: path
    });
    onProjectFilesOpenChange(false);
  }

  const content = renderPreviewContent();
  if (project) {
    return (
      <div className="relative h-full min-h-0 overflow-hidden">
        <section
          data-testid="file-preview-content-region"
          className="h-full min-w-0 overflow-hidden"
          onPointerDown={collapseProjectFilesFromPreviewContent}
        >
          {content}
        </section>
        {projectFilesOpen ? (
          <div
            data-testid="project-file-tree-region"
            className="absolute bottom-0 right-0 top-0 z-20 border-l bg-background"
            style={{ width: RIGHT_PANEL_PROJECT_FILES_WIDTH }}
          >
            <ProjectFileTree
              project={project}
              selectedPath={path}
              onOpenFile={openProjectFile}
              className="h-full"
            />
          </div>
        ) : null}
      </div>
    );
  }

  return content;

  function renderPreviewContent(): ReactNode {
    if (preview.status === "loading" || (path && preview.status === "idle")) {
      return (
        <div className="flex h-full items-center justify-center">
          <RefreshIcon className="size-5 animate-spin text-muted-foreground" />
        </div>
      );
    }

    if (preview.status === "idle") {
      return <EmptyPreview projectMode={Boolean(project)} />;
    }

    if (preview.status === "error") {
      return (
        <PreviewFailure
          title={preview.name ?? t("rightPanel.files")}
          path={preview.path}
          message={`${t("rightPanel.fileLoadFailed")}${preview.error ? `：${preview.error}` : ""}`}
          onOpenSystem={preview.path ? () => void openSystem(preview.path as string) : undefined}
        />
      );
    }

    const { info } = preview;
    const HeaderIcon = resolveFileTypeIcon(info.path);
    return (
      <div className="flex h-full min-h-0 flex-col">
        <header className="flex flex-none items-start justify-between gap-3 border-b px-4 py-2.5">
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <HeaderIcon aria-hidden className="cxb-svg-icon size-4 flex-none shrink-0" />
              <p className="truncate font-mono text-micro font-medium">{info.name}</p>
            </div>
            <p
              className="mt-1 truncate font-mono text-micro text-muted-foreground"
              title={info.path}
            >
              {info.path}
            </p>
            <p className="mt-1 font-mono text-micro text-muted-slate">
              {info.label} · {formatBytes(info.size)}
              {preview.truncated ? ` · ${t("rightPanel.fileTruncated")}` : ""}
            </p>
          </div>
          <div className="flex flex-none items-center gap-1">
            <button
              type="button"
              title={t("rightPanel.refresh")}
              onClick={() => setRefreshKey((value) => value + 1)}
              className={ICON_BUTTON}
            >
              <RefreshIcon className="size-3.5" />
            </button>
            <button
              type="button"
              title={t("rightPanel.openExternal")}
              onClick={() => void openSystem(info.path)}
              className={ICON_BUTTON}
            >
              <ArrowTopRightIcon className="size-3.5" />
            </button>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-hidden">
          <PreviewBody state={preview} onOpenSystem={() => void openSystem(info.path)} />
        </div>
      </div>
    );
  }
}

function PreviewBody(props: {
  state: Extract<PreviewState, { status: "ready" }>;
  onOpenSystem: () => void;
}) {
  const { state } = props;
  switch (state.info.kind) {
    case "markdown":
      return <MarkdownPreview text={state.text ?? ""} />;
    case "json":
    case "code":
    case "text":
      return <CodePreview text={state.text ?? ""} extension={state.info.extension} />;
    case "html":
      return state.fileUrl ? <HtmlPreview url={state.fileUrl} name={state.info.name} /> : <MissingPreview />;
    case "image":
      return state.data ? (
        <ImagePreview data={state.data} name={state.info.name} />
      ) : state.fileUrl ? (
        <ImagePreview url={state.fileUrl} name={state.info.name} />
      ) : (
        <MissingPreview />
      );
    case "audio":
      return state.fileUrl ? <AudioPreview url={state.fileUrl} /> : <MissingPreview />;
    case "video":
      return state.fileUrl ? <VideoPreview url={state.fileUrl} /> : <MissingPreview />;
    case "pdf":
      return state.data ? <PdfPreview data={state.data} /> : <MissingPreview />;
    case "docx":
      return state.data ? (
        <DocxPreview data={state.data} />
      ) : (
        <ThumbnailFallback state={state} onOpenSystem={props.onOpenSystem} />
      );
    case "spreadsheet":
      return state.data ? <SpreadsheetPreview data={state.data} /> : <MissingPreview />;
    case "presentation":
      return state.data ? (
        <PptxPreview data={state.data} name={state.info.name} onOpenSystem={props.onOpenSystem} />
      ) : (
        <ThumbnailFallback state={state} onOpenSystem={props.onOpenSystem} />
      );
    case "unsupported":
      return <ThumbnailFallback state={state} onOpenSystem={props.onOpenSystem} />;
  }
}

function EmptyPreview({
  projectMode = false
}: {
  projectMode?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-caption text-muted-foreground">
      <p>{t(projectMode ? "rightPanel.filesChooseFromTree" : "rightPanel.filesEmpty")}</p>
    </div>
  );
}

function PreviewFailure(props: {
  title: string;
  path?: string;
  message: string;
  onOpenSystem?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-caption text-muted-foreground">
      <WarningCircleIcon className="size-5 text-warning" />
      <div className="space-y-1">
        <p className="text-foreground">{props.title}</p>
        {props.path ? <p className="break-all font-mono text-micro">{props.path}</p> : null}
        <p>{props.message}</p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {props.onOpenSystem ? (
          <button
            type="button"
            onClick={props.onOpenSystem}
            className="rounded-sm border bg-card px-3 py-1.5 text-micro text-foreground transition-colors hover:bg-muted"
          >
            {t("rightPanel.openWithSystem")}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function CodePreview({ text, extension }: { text: string; extension: string }) {
  const settings = useAppStore((state) => state.codePreviewSettings);
  const setCodePreviewSettings = useAppStore((state) => state.setCodePreviewSettings);
  const displayText = useMemo(() => normalizeCodePreviewText(text), [text]);
  const plainLines = useMemo(() => splitCodePreviewLines(displayText), [displayText]);
  const highlight = useShikiHighlight(displayText, extension, settings, "FilePreviewPanel");
  const language = highlight.language;
  const wrap = settings.wrapLongLines;
  const [copied, setCopied] = useState(false);
  const wrapLabel = wrap ? "关闭自动换行" : "自动换行";

  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = window.setTimeout(() => setCopied(false), 1200);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function copyFileContent(): Promise<void> {
    if (!navigator.clipboard?.writeText) {
      console.warn("[FilePreviewPanel] 当前环境缺少剪贴板能力，无法复制文件预览内容", {
        chars: displayText.length
      });
      return;
    }
    try {
      await navigator.clipboard.writeText(displayText);
      setCopied(true);
      console.info("[FilePreviewPanel] 已复制文件预览内容", { chars: displayText.length });
    } catch (error) {
      console.warn("[FilePreviewPanel] 复制文件预览内容失败", {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return (
    <div
      className="relative h-full min-h-0 bg-canvas"
      data-code-font-size={settings.fontSize}
      data-code-line-numbers="true"
      data-language={language}
      data-testid="file-code-preview"
      style={codePreviewInlineStyle(settings)}
    >
      <div className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-xs border border-border bg-canvas p-0.5">
        <button
          type="button"
          aria-label={wrapLabel}
          aria-pressed={wrap}
          title={wrapLabel}
          className={ICON_BUTTON}
          onClick={() => setCodePreviewSettings({ wrapLongLines: !wrap })}
        >
          <UndoIcon className="size-3.5" />
        </button>
        <button
          type="button"
          aria-label="复制文件内容"
          title="复制文件内容"
          className={ICON_BUTTON}
          onClick={() => void copyFileContent()}
        >
          {copied ? <CheckMediumIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
        </button>
      </div>
      <div
        className={cn("h-full overflow-auto py-3 pl-4 pr-20 font-mono text-[var(--cxb-code-font-size,12px)] leading-[var(--cxb-code-line-height,20px)]", wrap && "overflow-x-hidden")}
        data-code-wrap={wrap ? "true" : "false"}
      >
        <pre className={cn("m-0", wrap && "whitespace-pre-wrap break-all")}>
          <code>
            <CodePreviewLines
              highlightedLines={highlight.lines}
              lineNumbers={true}
              plainLines={plainLines}
              wrap={wrap}
            />
          </code>
        </pre>
      </div>
    </div>
  );
}

function MarkdownPreview({ text }: { text: string }) {
  return (
    <div className="h-full overflow-auto px-4 py-4">
      <Markdown text={text} />
    </div>
  );
}

function HtmlPreview({ url, name }: { url: string; name: string }) {
  const hasWebview = Boolean(window.chengxiaobang);
  if (hasWebview) {
    return (
      <webview
        src={url}
        title={name}
        webpreferences="contextIsolation=yes,nodeIntegration=no,sandbox=yes"
        className="h-full w-full bg-white"
      />
    );
  }
  return (
    <iframe
      title={name}
      src={url}
      sandbox="allow-scripts allow-forms allow-same-origin allow-popups"
      className="h-full w-full border-0 bg-white"
    />
  );
}

function ImagePreview({ data, url, name }: { data?: ArrayBuffer; url?: string; name: string }) {
  const [objectUrl, setObjectUrl] = useState<string>();

  useEffect(() => {
    if (!data) {
      setObjectUrl(undefined);
      return;
    }
    if (typeof URL.createObjectURL !== "function") {
      console.warn("[FilePreviewPanel] 图片 Blob URL 能力不可用", { name });
      setObjectUrl(undefined);
      return;
    }
    const nextUrl = URL.createObjectURL(new Blob([data], { type: imageMimeTypeForPath(name) }));
    setObjectUrl(nextUrl);
    return () => {
      URL.revokeObjectURL(nextUrl);
    };
  }, [data, name]);

  const src = objectUrl ?? url;
  if (!src) {
    return <MissingPreview />;
  }

  return (
    <div className="flex h-full items-center justify-center overflow-auto bg-canvas-soft-2 p-4">
      <img src={src} alt={name} className="max-h-full max-w-full object-contain shadow-sm" />
    </div>
  );
}

function imageMimeTypeForPath(path: string): string {
  const extension = path.split(".").pop()?.toLowerCase();
  switch (extension) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "avif":
      return "image/avif";
    case "bmp":
      return "image/bmp";
    case "svg":
      return "image/svg+xml";
    case "png":
    default:
      return "image/png";
  }
}

function AudioPreview({ url }: { url: string }) {
  return (
    <div className="flex h-full items-center justify-center px-6">
      <audio src={url} controls className="w-full max-w-[420px]" />
    </div>
  );
}

function VideoPreview({ url }: { url: string }) {
  return (
    <div className="flex h-full items-center justify-center bg-black">
      <video src={url} controls className="max-h-full max-w-full" />
    </div>
  );
}

function MissingPreview() {
  const { t } = useTranslation();
  return (
    <div className="flex h-full items-center justify-center px-6 text-center text-caption text-muted-foreground">
      {t("rightPanel.fileLoadFailed")}
    </div>
  );
}

function PdfPreview({ data }: { data: ArrayBuffer }) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // 单一 PDF 文档实例:文档只加载一次(随 data 变化重载),翻页/缩放只 getPage+render,
  // 不再重复 getDocument。避免同一文件解析两遍,以及两份文档实例交错 cleanup 触发
  // "Transport destroyed"。
  const pdfDocRef = useRef<PDFDocumentProxy | null>(null);
  const [state, setState] = useState<{
    status: "loading" | "ready" | "error";
    error?: string;
    page: number;
    pageCount: number;
    scale: number;
  }>({ status: "loading", page: 1, pageCount: 0, scale: 1.15 });

  useEffect(() => {
    let cancelled = false;
    pdfDocRef.current = null;
    setState((current) => ({ ...current, status: "loading", page: 1, pageCount: 0 }));
    void (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
        const pdf = await pdfjs.getDocument({ data: pdfData(data) }).promise;
        if (cancelled) {
          await pdf.cleanup();
          return;
        }
        pdfDocRef.current = pdf;
        setState((current) => ({ ...current, status: "ready", pageCount: pdf.numPages }));
      } catch (error) {
        if (!cancelled) {
          console.warn("[FilePreviewPanel] PDF 加载失败", error);
          setState((current) => ({
            ...current,
            status: "error",
            error: error instanceof Error ? error.message : String(error)
          }));
        }
      }
    })();
    return () => {
      cancelled = true;
      const pdf = pdfDocRef.current;
      pdfDocRef.current = null;
      void pdf?.cleanup();
    };
  }, [data]);

  useEffect(() => {
    if (state.status !== "ready" || !canvasRef.current) {
      return;
    }
    const pdf = pdfDocRef.current;
    if (!pdf) {
      return;
    }
    let cancelled = false;
    let renderTask: { cancel(): void; promise: Promise<unknown> } | undefined;
    void (async () => {
      try {
        const page = await pdf.getPage(state.page);
        const viewport = page.getViewport({ scale: state.scale });
        const canvas = canvasRef.current;
        if (!canvas || cancelled) {
          return;
        }
        const outputScale = window.devicePixelRatio || 1;
        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        renderTask = page.render({
          canvas,
          viewport,
          transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined
        });
        await renderTask.promise;
      } catch (error) {
        if (!cancelled && !(error instanceof Error && error.name === "RenderingCancelledException")) {
          console.warn("[FilePreviewPanel] PDF 页面渲染失败", error);
          setState((current) => ({
            ...current,
            status: "error",
            error: error instanceof Error ? error.message : String(error)
          }));
        }
      }
    })();
    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [state.page, state.scale, state.status]);

  if (state.status === "loading") {
    return <CenteredLoader />;
  }
  if (state.status === "error") {
    return <InlineError message={`${t("rightPanel.fileLoadFailed")}：${state.error ?? ""}`} />;
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-none items-center justify-center gap-1 border-b px-3 py-2">
        <button
          type="button"
          title={t("rightPanel.prevPage")}
          disabled={state.page <= 1}
          onClick={() => setState((current) => ({ ...current, page: Math.max(1, current.page - 1) }))}
          className={ICON_BUTTON}
        >
          <ArrowLeftIcon className="size-3.5" />
        </button>
        <span className="px-2 font-mono text-micro text-muted-foreground">
          {state.page} / {state.pageCount}
        </span>
        <button
          type="button"
          title={t("rightPanel.nextPage")}
          disabled={state.page >= state.pageCount}
          onClick={() =>
            setState((current) => ({ ...current, page: Math.min(current.pageCount, current.page + 1) }))
          }
          className={ICON_BUTTON}
        >
          <ArrowLeftIcon className="size-3.5 rotate-180" />
        </button>
        <span className="mx-1 h-4 w-px bg-border" />
        <button
          type="button"
          title={t("rightPanel.zoomOut")}
          onClick={() => setState((current) => ({ ...current, scale: Math.max(0.6, current.scale - 0.15) }))}
          className={ICON_BUTTON}
        >
          <MinusIcon className="size-3.5" />
        </button>
        <button
          type="button"
          title={t("rightPanel.zoomIn")}
          onClick={() => setState((current) => ({ ...current, scale: Math.min(2.4, current.scale + 0.15) }))}
          className={ICON_BUTTON}
        >
          <PlusIcon className="size-3.5" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-canvas-soft-2 p-4">
        <canvas ref={canvasRef} className="mx-auto bg-white shadow-sm" />
      </div>
    </div>
  );
}

function DocxPreview({ data }: { data: ArrayBuffer }) {
  const { t } = useTranslation();
  const [state, setState] = useState<{ status: "loading" | "ready" | "error"; html?: string; error?: string }>(
    { status: "loading" }
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const mammoth = (await import("mammoth")).default;
        const result = await mammoth.convertToHtml({ arrayBuffer: data }, { externalFileAccess: false });
        if (!cancelled) {
          setState({ status: "ready", html: result.value });
        }
      } catch (error) {
        if (!cancelled) {
          console.warn("[FilePreviewPanel] DOCX 转换失败", error);
          setState({ status: "error", error: error instanceof Error ? error.message : String(error) });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [data]);

  if (state.status === "loading") return <CenteredLoader />;
  if (state.status === "error") {
    return <InlineError message={`${t("rightPanel.fileLoadFailed")}：${state.error ?? ""}`} />;
  }
  return (
    <iframe
      title="docx-preview"
      srcDoc={documentPreviewHtml(state.html ?? "")}
      sandbox=""
      className="h-full w-full border-0 bg-white"
    />
  );
}

function SpreadsheetPreview({ data }: { data: ArrayBuffer }) {
  const { t } = useTranslation();
  const [state, setState] = useState<{
    status: "loading" | "ready" | "error";
    sheets: Array<{ name: string; rows: unknown[][] }>;
    active: number;
    error?: string;
  }>({ status: "loading", sheets: [], active: 0 });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const XLSX = await import("xlsx");
        const workbook = XLSX.read(data, { type: "array", cellDates: true });
        const sheets = workbook.SheetNames.map((name) => ({
          name,
          rows: XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], {
            header: 1,
            blankrows: false,
            defval: ""
          })
        }));
        if (!cancelled) {
          setState({ status: "ready", sheets, active: 0 });
        }
      } catch (error) {
        if (!cancelled) {
          console.warn("[FilePreviewPanel] 表格解析失败", error);
          setState({
            status: "error",
            sheets: [],
            active: 0,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [data]);

  if (state.status === "loading") return <CenteredLoader />;
  if (state.status === "error") {
    return <InlineError message={`${t("rightPanel.fileLoadFailed")}：${state.error ?? ""}`} />;
  }
  const active = state.sheets[state.active];
  const rows = active?.rows.slice(0, 200) ?? [];
  const columnCount = Math.min(40, Math.max(0, ...rows.map((row) => row.length)));
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-none gap-1 overflow-x-auto border-b px-3 py-2">
        {state.sheets.map((sheet, index) => (
          <button
            key={sheet.name}
            type="button"
            onClick={() => setState((current) => ({ ...current, active: index }))}
            className={cn(
              "rounded-xs px-2 py-1 font-mono text-micro transition-colors",
              index === state.active
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            {sheet.name}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="min-w-full border-separate border-spacing-0 font-mono text-micro">
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                <th className="sticky left-0 z-10 border-b border-r bg-canvas-soft-2 px-2 py-1 text-right font-normal text-muted-slate">
                  {rowIndex + 1}
                </th>
                {Array.from({ length: columnCount }).map((_, columnIndex) => (
                  <td
                    key={columnIndex}
                    className="max-w-[220px] truncate border-b border-r px-2 py-1 text-foreground"
                    title={String(row[columnIndex] ?? "")}
                  >
                    {String(row[columnIndex] ?? "")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {active && active.rows.length > rows.length ? (
          <p className="px-4 py-2 text-micro text-muted-foreground">
            {t("rightPanel.sheetTruncated", { count: rows.length })}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function PptxPreview({
  data,
  name,
  onOpenSystem
}: {
  data: ArrayBuffer;
  name: string;
  onOpenSystem: () => void;
}) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<PptxViewerInstance | null>(null);
  const [state, setState] = useState<{
    status: "loading" | "ready" | "error";
    error?: string;
    page: number;
    pageCount: number;
    zoom: number;
    busy: boolean;
  }>({ status: "loading", page: 1, pageCount: 0, zoom: 100, busy: false });

  useEffect(() => {
    const container = containerRef.current;
    const scrollContainer = scrollRef.current;
    if (!container || !scrollContainer) {
      return;
    }
    const abortController = new AbortController();
    let cancelled = false;
    container.innerHTML = "";
    viewerRef.current = null;
    setState({ status: "loading", page: 1, pageCount: 0, zoom: 100, busy: false });

    void (async () => {
      try {
        console.info("[FilePreviewPanel] 开始渲染 PPTX 预览", { name, bytes: data.byteLength });
        const { PptxViewer, RECOMMENDED_ZIP_LIMITS } = await import("@aiden0z/pptx-renderer");
        const viewer = await PptxViewer.open(data.slice(0), container, {
          fitMode: "contain",
          zoomPercent: 100,
          scrollContainer,
          zipLimits: RECOMMENDED_ZIP_LIMITS,
          pdfjs: {
            moduleUrl: pdfjsModuleUrl,
            workerUrl: pdfjsWorkerUrl
          },
          listOptions: {
            windowed: true,
            batchSize: 8,
            initialSlides: 4,
            overscanViewport: 1.5,
            showSlideLabels: true
          },
          signal: abortController.signal,
          onSlideChange: (index) => {
            setState((current) => ({ ...current, page: index + 1 }));
          },
          onSlideError: (index, error) => {
            console.warn("[FilePreviewPanel] PPTX 单页渲染失败", { name, page: index + 1, error });
          },
          onNodeError: (nodeId, error) => {
            console.warn("[FilePreviewPanel] PPTX 节点渲染失败", { name, nodeId, error });
          }
        });
        if (cancelled) {
          viewer.destroy();
          return;
        }
        viewerRef.current = viewer;
        console.info("[FilePreviewPanel] PPTX 预览渲染完成", {
          name,
          slideCount: viewer.slideCount
        });
        setState({
          status: "ready",
          page: Math.max(1, viewer.currentSlideIndex + 1),
          pageCount: viewer.slideCount,
          zoom: viewer.zoomPercent,
          busy: false
        });
      } catch (error) {
        if (!cancelled && !abortController.signal.aborted) {
          console.warn("[FilePreviewPanel] PPTX 预览渲染失败", { name, error });
          setState({
            status: "error",
            page: 1,
            pageCount: 0,
            zoom: 100,
            busy: false,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
    })();

    return () => {
      cancelled = true;
      abortController.abort();
      viewerRef.current?.destroy();
      viewerRef.current = null;
      container.innerHTML = "";
    };
  }, [data, name]);

  async function goToSlide(page: number): Promise<void> {
    const viewer = viewerRef.current;
    if (!viewer) {
      return;
    }
    const targetPage = Math.min(Math.max(1, page), Math.max(1, state.pageCount));
    setState((current) => ({ ...current, busy: true }));
    try {
      await viewer.goToSlide(targetPage - 1, { behavior: "smooth", block: "start" });
      setState((current) => ({ ...current, page: targetPage, busy: false }));
    } catch (error) {
      console.warn("[FilePreviewPanel] PPTX 跳转页面失败", { name, page: targetPage, error });
      setState((current) => ({ ...current, busy: false }));
    }
  }

  async function setZoom(zoom: number): Promise<void> {
    const viewer = viewerRef.current;
    if (!viewer) {
      return;
    }
    const nextZoom = Math.min(200, Math.max(50, zoom));
    setState((current) => ({ ...current, busy: true }));
    try {
      await viewer.setZoom(nextZoom);
      setState((current) => ({ ...current, zoom: viewer.zoomPercent, busy: false }));
    } catch (error) {
      console.warn("[FilePreviewPanel] PPTX 缩放失败", { name, zoom: nextZoom, error });
      setState((current) => ({ ...current, busy: false }));
    }
  }

  if (state.status === "error") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-caption text-muted-foreground">
        <WarningCircleIcon className="size-5 text-warning" />
        <div className="max-w-[360px] space-y-1">
          <p className="text-foreground">PPTX 内嵌预览失败</p>
          <p>{`${t("rightPanel.fileLoadFailed")}：${state.error ?? ""}`}</p>
        </div>
        <button
          type="button"
          onClick={onOpenSystem}
          className="rounded-sm border bg-card px-3 py-1.5 text-micro text-foreground transition-colors hover:bg-muted"
        >
          {t("rightPanel.openWithSystem")}
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-none items-center justify-center gap-1 border-b px-3 py-2">
        <button
          type="button"
          title={t("rightPanel.prevPage")}
          disabled={state.status !== "ready" || state.busy || state.page <= 1}
          onClick={() => void goToSlide(state.page - 1)}
          className={ICON_BUTTON}
        >
          <ArrowLeftIcon className="size-3.5" />
        </button>
        <span className="px-2 font-mono text-micro text-muted-foreground">
          {state.status === "ready" ? `${state.page} / ${state.pageCount}` : "PPTX"}
        </span>
        <button
          type="button"
          title={t("rightPanel.nextPage")}
          disabled={state.status !== "ready" || state.busy || state.page >= state.pageCount}
          onClick={() => void goToSlide(state.page + 1)}
          className={ICON_BUTTON}
        >
          <ArrowLeftIcon className="size-3.5 rotate-180" />
        </button>
        <span className="mx-1 h-4 w-px bg-border" />
        <button
          type="button"
          title={t("rightPanel.zoomOut")}
          disabled={state.status !== "ready" || state.busy || state.zoom <= 50}
          onClick={() => void setZoom(state.zoom - 10)}
          className={ICON_BUTTON}
        >
          <MinusIcon className="size-3.5" />
        </button>
        <span className="w-12 text-center font-mono text-micro text-muted-foreground">
          {state.status === "ready" ? `${state.zoom}%` : ""}
        </span>
        <button
          type="button"
          title={t("rightPanel.zoomIn")}
          disabled={state.status !== "ready" || state.busy || state.zoom >= 200}
          onClick={() => void setZoom(state.zoom + 10)}
          className={ICON_BUTTON}
        >
          <PlusIcon className="size-3.5" />
        </button>
      </div>
      <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-auto bg-canvas-soft-2 px-4 py-4">
        {state.status === "loading" ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-canvas-soft-2/80">
            <RefreshIcon className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : null}
        <div ref={containerRef} className="mx-auto min-h-full w-full max-w-[1280px]" />
      </div>
    </div>
  );
}

function ThumbnailFallback(props: {
  state: Extract<PreviewState, { status: "ready" }>;
  onOpenSystem: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
      {props.state.thumbnailUrl ? (
        <img
          src={props.state.thumbnailUrl}
          alt={props.state.info.name}
          className="max-h-[70%] max-w-full rounded-sm border bg-white object-contain shadow-sm"
        />
      ) : (
        <div className="flex size-20 items-center justify-center rounded-sm border bg-canvas-soft-2 text-muted-foreground">
          <TextDocumentGrayIcon className="size-8" />
        </div>
      )}
      <div className="max-w-[360px] space-y-1 text-caption text-muted-foreground">
        <p className="text-foreground">{fallbackMessageForKind(props.state.info.kind, props.state.info.extension)}</p>
        {props.state.thumbnailError ? <p>{props.state.thumbnailError}</p> : null}
      </div>
      <button
        type="button"
        onClick={props.onOpenSystem}
        className="rounded-sm border bg-card px-3 py-1.5 text-micro text-foreground transition-colors hover:bg-muted"
      >
        {t("rightPanel.openWithSystem")}
      </button>
    </div>
  );
}

function CenteredLoader() {
  return (
    <div className="flex h-full items-center justify-center">
      <RefreshIcon className="size-5 animate-spin text-muted-foreground" />
    </div>
  );
}

function InlineError({ message }: { message: string }) {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center text-caption text-muted-foreground">
      {message}
    </div>
  );
}

function normalizeTextForKind(kind: PreviewKind, text: string): string {
  if (kind !== "json") {
    return text;
  }
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

function pdfData(data: ArrayBuffer): Uint8Array {
  return new Uint8Array(data.slice(0));
}

function fallbackMessageForKind(kind: PreviewKind, extension: string): string {
  if (kind === "presentation") {
    if (extension === "ppt") {
      return "旧版 PPT 演示文稿暂无法内嵌解析，请用系统应用打开。";
    }
    return "PPTX 内嵌预览不可用，请用系统应用打开。";
  }
  if (kind === "docx" && extension === "doc") {
    return "旧版 Word 文档暂无法内嵌解析，请用系统应用打开。";
  }
  return "该文件类型暂无法内嵌预览，请用系统应用打开。";
}

function documentPreviewHtml(body: string): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  body { margin: 0; background: #fafafa; color: #171717; font: 14px/1.7 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  main { max-width: 760px; min-height: 100vh; margin: 0 auto; padding: 40px 48px; background: #fff; box-sizing: border-box; }
  img { max-width: 100%; height: auto; }
  table { border-collapse: collapse; max-width: 100%; }
  td, th { border: 1px solid #ebebeb; padding: 4px 6px; }
  p { margin: 0 0 12px; }
  h1, h2, h3 { line-height: 1.25; }
</style>
</head>
<body><main>${body}</main></body>
</html>`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb >= 10 ? 0 : 1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}
