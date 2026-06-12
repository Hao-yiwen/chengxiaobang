import { FolderOpen, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "@/store";

interface PreviewState {
  status: "idle" | "loading" | "ready" | "error";
  name?: string;
  text?: string;
  error?: string;
}

/**
 * Plain-text file preview with line numbers. Reads through the existing
 * read-file-text IPC bridge (256KB cap, binary detection) — opened from the
 * file chips on tool-call rows or via the picker below.
 */
export function FilePreviewPanel() {
  const { t } = useTranslation();
  const previewFile = useAppStore((state) => state.previewFile);
  const openFilePreview = useAppStore((state) => state.openFilePreview);
  const [preview, setPreview] = useState<PreviewState>({ status: "idle" });
  const path = previewFile?.path;

  useEffect(() => {
    if (!path) {
      setPreview({ status: "idle" });
      return;
    }
    if (!window.chengxiaobang?.readFileText) {
      setPreview({ status: "error", error: t("rightPanel.fileDesktopOnly") });
      return;
    }
    let cancelled = false;
    setPreview({ status: "loading" });
    void window.chengxiaobang.readFileText(path).then((result) => {
      if (cancelled) {
        return;
      }
      if (result.ok) {
        setPreview({ status: "ready", name: result.name, text: result.text });
      } else {
        setPreview({ status: "error", name: result.name, error: result.error });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [path, t]);

  async function pickFile(): Promise<void> {
    const paths = (await window.chengxiaobang?.pickFiles?.()) ?? [];
    if (paths[0]) {
      openFilePreview(paths[0]);
    }
  }

  if (preview.status === "loading") {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (preview.status !== "ready") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-caption text-muted-foreground">
        <p>
          {preview.status === "error"
            ? `${t("rightPanel.fileLoadFailed")}${preview.error ? `：${preview.error}` : ""}`
            : t("rightPanel.filesEmpty")}
        </p>
        {window.chengxiaobang?.pickFiles ? (
          <button
            type="button"
            onClick={() => void pickFile()}
            className="flex items-center gap-1.5 rounded-sm border bg-card px-3 py-1.5 text-micro text-foreground transition-colors hover:bg-muted"
          >
            <FolderOpen className="size-3.5" />
            {t("rightPanel.pickFile")}
          </button>
        ) : null}
      </div>
    );
  }

  const lines = (preview.text ?? "").split("\n");
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex-none border-b px-4 py-2">
        <p className="truncate font-mono text-micro font-medium">{preview.name}</p>
        <p className="truncate font-mono text-micro text-muted-foreground" title={path}>
          {path}
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-auto py-2 font-mono text-micro leading-relaxed">
        {lines.map((line, index) => (
          <div key={index} className="flex px-3">
            <span className="w-10 flex-none select-none pr-3 text-right text-muted-slate/70">
              {index + 1}
            </span>
            <span className="min-w-0 flex-1 whitespace-pre-wrap break-all">{line || " "}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
