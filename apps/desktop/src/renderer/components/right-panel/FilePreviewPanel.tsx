import {
  ArrowClockwiseIcon as RefreshCw,
  ArrowLeftIcon as ArrowLeft,
  ArrowRightIcon as ArrowRight,
  ArrowSquareOutIcon as ExternalLink,
  CircleNotchIcon as Loader2,
  FileTextIcon as FileText,
  FolderOpenIcon as FolderOpen,
  MagnifyingGlassMinusIcon as ZoomOut,
  MagnifyingGlassPlusIcon as ZoomIn,
  WarningCircleIcon as WarningCircle
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
import { Markdown } from "@/components/Markdown";
import {
  BINARY_PREVIEW_MAX_BYTES,
  TEXT_PREVIEW_MAX_BYTES,
  isFileUrlPreviewKind,
  isTextualPreviewKind,
  type PreviewKind
} from "../../../common/file-preview";
import { useAppStore } from "@/store";
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

export function FilePreviewPanel() {
  const { t } = useTranslation();
  const previewFile = useAppStore((state) => state.previewFile);
  const openFilePreview = useAppStore((state) => state.openFilePreview);
  const setNotice = useAppStore((state) => state.setNotice);
  const [preview, setPreview] = useState<PreviewState>({ status: "idle" });
  const [refreshKey, setRefreshKey] = useState(0);
  const path = previewFile?.path;
  const previewContext = useMemo(
    () => ({
      ...(previewFile?.projectPath ? { projectPath: previewFile.projectPath } : {}),
      ...(previewFile?.sessionId ? { sessionId: previewFile.sessionId } : {})
    }),
    [previewFile?.projectPath, previewFile?.sessionId]
  );

  const loadPreview = useCallback(async (
    targetPath: string,
    context: { projectPath?: string; sessionId?: string }
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

  async function pickFile(): Promise<void> {
    const paths = (await window.chengxiaobang?.pickFiles?.()) ?? [];
    if (paths[0]) {
      openFilePreview(paths[0]);
    }
  }

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

  if (preview.status === "loading") {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (preview.status === "idle") {
    return <EmptyPreview onPickFile={pickFile} />;
  }

  if (preview.status === "error") {
    return (
      <PreviewFailure
        title={preview.name ?? t("rightPanel.files")}
        path={preview.path}
        message={`${t("rightPanel.fileLoadFailed")}${preview.error ? `：${preview.error}` : ""}`}
        onPickFile={pickFile}
        onOpenSystem={preview.path ? () => void openSystem(preview.path as string) : undefined}
      />
    );
  }

  const { info } = preview;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-none items-start justify-between gap-3 border-b px-4 py-2.5">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <FileText className="size-4 flex-none text-muted-foreground" />
            <p className="truncate font-mono text-micro font-medium">{info.name}</p>
          </div>
          <p className="mt-1 truncate font-mono text-micro text-muted-foreground" title={info.path}>
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
            <RefreshCw className="size-3.5" />
          </button>
          <button
            type="button"
            title={t("rightPanel.openExternal")}
            onClick={() => void openSystem(info.path)}
            className={ICON_BUTTON}
          >
            <ExternalLink className="size-3.5" />
          </button>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-hidden">
        <PreviewBody state={preview} onOpenSystem={() => void openSystem(info.path)} />
      </div>
    </div>
  );
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
      return <TextPreview text={state.text ?? ""} />;
    case "html":
      return state.fileUrl ? <HtmlPreview url={state.fileUrl} name={state.info.name} /> : <MissingPreview />;
    case "image":
      return state.fileUrl ? <ImagePreview url={state.fileUrl} name={state.info.name} /> : <MissingPreview />;
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
    case "unsupported":
      return <ThumbnailFallback state={state} onOpenSystem={props.onOpenSystem} />;
  }
}

function EmptyPreview({ onPickFile }: { onPickFile: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-caption text-muted-foreground">
      <p>{t("rightPanel.filesEmpty")}</p>
      {window.chengxiaobang?.pickFiles ? (
        <button
          type="button"
          onClick={() => void onPickFile()}
          className="flex items-center gap-1.5 rounded-sm border bg-card px-3 py-1.5 text-micro text-foreground transition-colors hover:bg-muted"
        >
          <FolderOpen className="size-3.5" />
          {t("rightPanel.pickFile")}
        </button>
      ) : null}
    </div>
  );
}

function PreviewFailure(props: {
  title: string;
  path?: string;
  message: string;
  onPickFile: () => void;
  onOpenSystem?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-caption text-muted-foreground">
      <WarningCircle className="size-5 text-warning" />
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
        {window.chengxiaobang?.pickFiles ? (
          <button
            type="button"
            onClick={() => void props.onPickFile()}
            className="rounded-sm border bg-card px-3 py-1.5 text-micro text-foreground transition-colors hover:bg-muted"
          >
            {t("rightPanel.pickFile")}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function TextPreview({ text }: { text: string }) {
  const lines = useMemo(() => text.split("\n"), [text]);
  return (
    <div className="h-full overflow-auto py-2 font-mono text-micro leading-relaxed">
      {lines.map((line, index) => (
        <div key={index} className="flex px-3">
          <span className="w-10 flex-none select-none pr-3 text-right text-muted-slate/70">
            {index + 1}
          </span>
          <span className="min-w-0 flex-1 whitespace-pre-wrap break-all">{line || " "}</span>
        </div>
      ))}
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

function ImagePreview({ url, name }: { url: string; name: string }) {
  return (
    <div className="flex h-full items-center justify-center overflow-auto bg-canvas-soft-2 p-4">
      <img src={url} alt={name} className="max-h-full max-w-full object-contain shadow-sm" />
    </div>
  );
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
  const [state, setState] = useState<{
    status: "loading" | "ready" | "error";
    error?: string;
    page: number;
    pageCount: number;
    scale: number;
  }>({ status: "loading", page: 1, pageCount: 0, scale: 1.15 });

  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | undefined;
    void (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
        const task = pdfjs.getDocument({ data: pdfData(data) });
        const pdf = await task.promise;
        if (cancelled) {
          await pdf.cleanup();
          return;
        }
        setState((current) => ({ ...current, status: "ready", pageCount: pdf.numPages }));
        cleanup = () => {
          void pdf.cleanup();
        };
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
      cleanup?.();
    };
  }, [data]);

  useEffect(() => {
    if (state.status !== "ready" || !canvasRef.current) {
      return;
    }
    let cancelled = false;
    let renderTask: { cancel(): void; promise: Promise<unknown> } | undefined;
    void (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
        const pdf = await pdfjs.getDocument({ data: pdfData(data) }).promise;
        const page = await pdf.getPage(state.page);
        const viewport = page.getViewport({ scale: state.scale });
        const canvas = canvasRef.current;
        if (!canvas || cancelled) {
          await pdf.cleanup();
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
        await pdf.cleanup();
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
  }, [data, state.page, state.scale, state.status]);

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
          <ArrowLeft className="size-3.5" />
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
          <ArrowRight className="size-3.5" />
        </button>
        <span className="mx-1 h-4 w-px bg-border" />
        <button
          type="button"
          title={t("rightPanel.zoomOut")}
          onClick={() => setState((current) => ({ ...current, scale: Math.max(0.6, current.scale - 0.15) }))}
          className={ICON_BUTTON}
        >
          <ZoomOut className="size-3.5" />
        </button>
        <button
          type="button"
          title={t("rightPanel.zoomIn")}
          onClick={() => setState((current) => ({ ...current, scale: Math.min(2.4, current.scale + 0.15) }))}
          className={ICON_BUTTON}
        >
          <ZoomIn className="size-3.5" />
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
          <FileText className="size-8" />
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
      <Loader2 className="size-5 animate-spin text-muted-foreground" />
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
    return "演示文稿暂以缩略图和系统打开为主。";
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
