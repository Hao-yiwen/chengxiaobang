import {
  FileAudioIcon as FileAudio,
  FileCodeIcon as FileCode,
  FileDocIcon as FileDoc,
  FileHtmlIcon as FileHtml,
  FileImageIcon as FileImage,
  FilePdfIcon as FilePdf,
  FilePptIcon as FilePpt,
  FileTextIcon as FileText,
  FileVideoIcon as FileVideo,
  FileXlsIcon as FileSpreadsheet,
  type Icon
} from "@phosphor-icons/react";
import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  collectArtifactsFromAssistantMessages,
  logArtifactCollectionResult,
  type ArtifactSourceMessage,
  type CollectedArtifact
} from "@/lib/artifact";
import { useAppStore } from "@/store";

const KIND_ICON: Partial<Record<CollectedArtifact["kind"], Icon>> = {
  code: FileCode,
  markdown: FileText,
  json: FileCode,
  html: FileHtml,
  pdf: FilePdf,
  image: FileImage,
  audio: FileAudio,
  video: FileVideo,
  spreadsheet: FileSpreadsheet,
  docx: FileDoc,
  presentation: FilePpt,
  text: FileText,
  unsupported: FileText
};

function collectionLogKey(collection: ReturnType<typeof collectArtifactsFromAssistantMessages>) {
  return [
    collection.artifacts.map((artifact) => artifact.path).join("\u0000"),
    collection.diagnostics
      .map((diagnostic) =>
        diagnostic.type === "missing_path"
          ? `${diagnostic.type}:${diagnostic.tag}`
          : `${diagnostic.type}:${diagnostic.path}`
      )
      .join("\u0000")
  ].join("\u0001");
}

/** 对话右侧浮层产物面板：有最终 XML 产物声明时出现在进度浮层上方。 */
export function ArtifactFloatingPanel() {
  const { t } = useTranslation();
  const messages = useAppStore((state) => state.messages);
  const streamText = useAppStore((state) => state.streamText);
  const openArtifact = useAppStore((state) => state.openArtifact);

  const sources = useMemo<ArtifactSourceMessage[]>(() => {
    const assistantMessages = messages.map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      createdAt: message.createdAt
    }));
    if (!streamText.trim()) {
      return assistantMessages;
    }
    return [
      ...assistantMessages,
      {
        id: "streaming",
        role: "assistant",
        content: streamText
      }
    ];
  }, [messages, streamText]);

  const collection = useMemo(() => collectArtifactsFromAssistantMessages(sources), [sources]);
  const logKey = collectionLogKey(collection);

  useEffect(() => {
    if (collection.artifacts.length === 0 && collection.diagnostics.length === 0) {
      return;
    }
    logArtifactCollectionResult("floating-panel", collection);
  }, [logKey]);

  if (collection.artifacts.length === 0) {
    return null;
  }

  return (
    <aside
      data-testid="artifact-floating-panel"
      aria-label={t("rightPanel.artifacts")}
      className="chat-artifact-floating pointer-events-auto rounded-xl border bg-card"
    >
      <header className="min-w-0 border-b px-4 pb-3 pt-4">
        <div className="font-mono text-mono-label uppercase text-muted-foreground">
          {t("rightPanel.artifacts")}
        </div>
        <p className="mt-0.5 truncate text-caption text-body">
          {t("rightPanel.artifactsCount", { count: collection.artifacts.length })}
        </p>
      </header>
      <div
        data-testid="artifact-floating-scroll"
        className="min-h-0 overflow-y-auto overflow-x-hidden px-3 py-3 [scrollbar-gutter:stable]"
      >
        <div className="flex flex-col gap-2">
          {collection.artifacts.map((artifact) => {
            const Icon = KIND_ICON[artifact.kind] ?? FileText;
            return (
              <button
                key={artifact.path}
                type="button"
                title={artifact.path}
                onClick={() => {
                  console.info("[artifact-floating-panel] 打开会话产物", {
                    path: artifact.path,
                    kind: artifact.kind,
                    messageId: artifact.messageId
                  });
                  openArtifact(artifact.path, artifact.kind);
                }}
                className="flex w-full min-w-0 items-center gap-2.5 rounded-sm border bg-canvas px-2.5 py-2 text-left transition-colors hover:bg-canvas-soft-2"
              >
                <span className="flex size-7 flex-none items-center justify-center rounded-xs bg-canvas-soft-2 text-ink">
                  <Icon className="size-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-caption font-medium text-foreground">
                    {artifact.name}
                  </span>
                  <span className="block truncate font-mono text-micro text-muted-foreground">
                    {artifact.path}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
