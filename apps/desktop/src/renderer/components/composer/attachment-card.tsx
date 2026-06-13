import {
  FileAudioIcon as FileAudio,
  FileCodeIcon as FileCode,
  FileDocIcon as FileDoc,
  FileIcon as FileAttachment,
  FileImageIcon as FileImage,
  FilePdfIcon as FilePdf,
  FilePptIcon as FilePpt,
  FileTextIcon as FileText,
  FileVideoIcon as FileVideo,
  FileXlsIcon as FileSpreadsheet,
  XIcon as X,
  type Icon
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

const ATTACHMENT_CARD_TEXT_PREVIEW_BYTES = 1600;

export function ComposerAttachmentCard(props: {
  attachment: { path: string; name: string; size: number; kind?: string; text?: string };
  onOpen: () => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const [fileUrl, setFileUrl] = useState<string | undefined>();
  const [imageFailed, setImageFailed] = useState(false);
  const [textPreview, setTextPreview] = useState<string | undefined>();
  const isImage = props.attachment.kind === "image";
  const canShowTextPreview = isAttachmentTextPreviewKind(props.attachment.kind);

  useEffect(() => {
    let disposed = false;
    let objectUrl: string | undefined;
    setFileUrl(undefined);
    setImageFailed(false);
    if (!isImage) {
      return () => {
        disposed = true;
      };
    }
    const bridge = window.chengxiaobang;
    if (!bridge?.readFilePreviewBuffer || typeof URL.createObjectURL !== "function") {
      console.warn("[composer] 图片附件卡片二进制预览能力不可用", {
        path: props.attachment.path
      });
      return () => {
        disposed = true;
      };
    }
    void bridge.readFilePreviewBuffer(props.attachment.path).then((result) => {
      if (disposed) {
        return;
      }
      if (result.ok) {
        objectUrl = URL.createObjectURL(
          new Blob([result.data], { type: imageMimeTypeForPath(props.attachment.path) })
        );
        setFileUrl(objectUrl);
        return;
      }
      console.warn("[composer] 图片附件卡片二进制预览读取失败", {
        path: props.attachment.path,
        error: result.error
      });
    });
    return () => {
      disposed = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [isImage, props.attachment.path]);

  useEffect(() => {
    let disposed = false;
    setTextPreview(undefined);
    if (!canShowTextPreview) {
      return () => {
        disposed = true;
      };
    }

    const cachedText = normalizeAttachmentPreviewText(props.attachment.text);
    if (cachedText) {
      setTextPreview(cachedText);
      return () => {
        disposed = true;
      };
    }

    const bridge = window.chengxiaobang;
    if (!bridge?.readFilePreviewText) {
      console.warn("[composer] 附件卡片文本预览能力不可用", {
        path: props.attachment.path,
        kind: props.attachment.kind
      });
      return () => {
        disposed = true;
      };
    }

    // 卡片只读取很小一段内容，避免输入框预览影响正式附件准备链路。
    void bridge
      .readFilePreviewText(props.attachment.path, {
        maxBytes: ATTACHMENT_CARD_TEXT_PREVIEW_BYTES
      })
      .then((result) => {
        if (disposed) {
          return;
        }
        if (result.ok) {
          setTextPreview(normalizeAttachmentPreviewText(result.text));
          return;
        }
        console.warn("[composer] 附件卡片文本预览读取失败", {
          path: props.attachment.path,
          kind: props.attachment.kind,
          error: result.error
        });
      });

    return () => {
      disposed = true;
    };
  }, [canShowTextPreview, props.attachment.kind, props.attachment.path, props.attachment.text]);

  const Icon = attachmentIconForKind(props.attachment.kind);
  const imageReady = isImage && fileUrl && !imageFailed;
  const showName = !isImage;

  return (
    <div
      className="group relative h-[108px] w-[88px] flex-none"
      title={`${props.attachment.path} · ${formatSize(props.attachment.size)}`}
    >
      <button
        type="button"
        onClick={props.onOpen}
        className="block h-full w-full min-w-0 text-left"
        title={t("chat.openAttachment", { name: props.attachment.name })}
        aria-label={t("chat.openAttachment", { name: props.attachment.name })}
      >
        <span
          className={cn(
            "relative flex w-full items-center justify-center overflow-hidden rounded-md border border-border bg-canvas-soft-2 text-muted-foreground shadow-hairline transition-colors group-hover:border-hairline-strong group-hover:bg-canvas-soft",
            showName ? "h-[88px]" : "h-full"
          )}
        >
          {imageReady ? (
            <img
              src={fileUrl}
              alt={t("chat.attachmentImageAlt", { name: props.attachment.name })}
              className="h-full w-full object-cover"
              draggable={false}
              onError={() => {
                console.warn("[composer] 图片附件卡片预览加载失败", {
                  path: props.attachment.path
                });
                setImageFailed(true);
              }}
            />
          ) : textPreview ? (
            <span className="h-full w-full overflow-hidden whitespace-pre-wrap break-words px-1.5 py-1.5 font-mono text-caption leading-4 text-body">
              {textPreview}
            </span>
          ) : (
            <Icon className="size-6" />
          )}
        </span>
        {showName ? (
          <span className="mt-1 block h-4 truncate text-caption leading-4 text-body">
            {props.attachment.name}
          </span>
        ) : null}
      </button>
      <button
        type="button"
        aria-label={t("composer.removeAttachment", { name: props.attachment.name })}
        onClick={props.onRemove}
        className="absolute right-1.5 top-1.5 z-10 flex size-[18px] items-center justify-center rounded-full bg-primary/95 text-primary-foreground shadow-subtle transition-colors hover:bg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
      >
        <X className="size-2.5" />
      </button>
    </div>
  );
}

function isAttachmentTextPreviewKind(kind: string | undefined): boolean {
  return kind === "text" || kind === "code" || kind === "markdown" || kind === "json";
}

function normalizeAttachmentPreviewText(text: string | undefined): string | undefined {
  const normalized = text?.replace(/\r\n?/gu, "\n").trim();
  if (!normalized) {
    return undefined;
  }
  return normalized.length > 260 ? `${normalized.slice(0, 260)}...` : normalized;
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

function attachmentIconForKind(kind: string | undefined): Icon {
  switch (kind) {
    case "image":
      return FileImage;
    case "pdf":
      return FilePdf;
    case "code":
    case "json":
    case "html":
    case "markdown":
      return FileCode;
    case "docx":
      return FileDoc;
    case "presentation":
      return FilePpt;
    case "spreadsheet":
      return FileSpreadsheet;
    case "audio":
      return FileAudio;
    case "video":
      return FileVideo;
    case "text":
      return FileText;
    default:
      return FileAttachment;
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
