import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  collectArtifactsFromSession,
  hasArtifactDeclarationMarkup,
  logArtifactCollectionResult,
  type ArtifactSourceMessage,
  type CollectedArtifact,
  type CollectedArtifactDeclarations
} from "@/lib/artifact";
import { useVerifiedArtifacts } from "@/hooks/use-verified-artifacts";
import chatLayoutStyles from "@/components/ChatLayout.module.css";
import { iconForPath } from "@/lib/file-icon";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store";

const EMPTY_ARTIFACT_COLLECTION: CollectedArtifactDeclarations = {
  artifacts: [],
  diagnostics: []
};

function collectionLogKey(collection: ReturnType<typeof collectArtifactsFromSession>) {
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

function mergeArtifactCollections(
  settled: CollectedArtifactDeclarations,
  live: CollectedArtifactDeclarations
): CollectedArtifactDeclarations {
  const seen = new Set<string>();
  const artifacts: CollectedArtifact[] = [];
  const diagnostics = [...settled.diagnostics];
  for (const artifact of [...settled.artifacts, ...live.artifacts]) {
    if (seen.has(artifact.path)) {
      diagnostics.push({ type: "duplicate_path", path: artifact.path });
      continue;
    }
    seen.add(artifact.path);
    artifacts.push(artifact);
  }
  return { artifacts, diagnostics };
}

/** 对话右侧浮层产物面板：有最终 XML 产物声明时出现在进度浮层上方。 */
export function ArtifactFloatingPanel() {
  const { t } = useTranslation();
  const messages = useAppStore((state) => state.messages);
  const toolHistory = useAppStore((state) => state.toolHistory);
  const streamText = useAppStore((state) => state.streamText);
  const activeRunId = useAppStore((state) => state.activeRunId);
  const openArtifact = useAppStore((state) => state.openArtifact);

  const settledSources = useMemo<ArtifactSourceMessage[]>(
    () =>
      messages.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        createdAt: message.createdAt
      })),
    [messages]
  );
  const liveSources = useMemo<ArtifactSourceMessage[]>(
    () =>
      streamText.trim()
        ? [
            {
              id: "streaming",
              role: "assistant",
              content: streamText
            }
          ]
        : [],
    [streamText]
  );

  const settledToolHistory = useMemo(
    () => toolHistory.filter((toolCall) => !activeRunId || toolCall.runId !== activeRunId),
    [activeRunId, toolHistory]
  );
  const settledCollection = useMemo(
    () => collectArtifactsFromSession(settledSources, settledToolHistory),
    [settledSources, settledToolHistory]
  );
  const liveCollection = useMemo(
    () =>
      liveSources.length > 0
        ? collectArtifactsFromSession(liveSources, [])
        : EMPTY_ARTIFACT_COLLECTION,
    [liveSources]
  );
  const collection = useMemo(
    () => mergeArtifactCollections(settledCollection, liveCollection),
    [liveCollection, settledCollection]
  );
  const verified = useVerifiedArtifacts(collection.artifacts, "floating-panel");
  const verifiedCollection = useMemo<CollectedArtifactDeclarations>(
    () => ({
      artifacts: verified.artifacts,
      diagnostics: collection.diagnostics
    }),
    [collection.diagnostics, verified.artifacts]
  );
  const settledHasDeclarationMarkup = useMemo(
    () => hasArtifactDeclarationMarkup(settledSources),
    [settledSources]
  );
  const liveHasDeclarationMarkup = useMemo(
    () => liveSources.length > 0 && hasArtifactDeclarationMarkup(liveSources),
    [liveSources]
  );
  const logKey = collectionLogKey(verifiedCollection);

  useEffect(() => {
    if (verified.pending) {
      return;
    }
    if (
      verifiedCollection.artifacts.length === 0 &&
      verifiedCollection.diagnostics.length === 0 &&
      !settledHasDeclarationMarkup
    ) {
      return;
    }
    logArtifactCollectionResult("floating-panel", verifiedCollection, {
      messageCount: settledSources.length + liveSources.length,
      toolCallCount: settledToolHistory.length,
      hasDeclarationMarkup: settledHasDeclarationMarkup || liveHasDeclarationMarkup
    });
  }, [
    liveHasDeclarationMarkup,
    liveSources.length,
    logKey,
    settledHasDeclarationMarkup,
    settledSources.length,
    settledToolHistory.length,
    verified.pending
  ]);

  if (verified.pending || verifiedCollection.artifacts.length === 0) {
    return null;
  }

  return (
    <aside
      data-testid="artifact-floating-panel"
      aria-label={t("rightPanel.artifacts")}
      className={cn(
        "chat-artifact-floating pointer-events-auto rounded-xl border bg-card",
        chatLayoutStyles.artifactFloating
      )}
    >
      <header className="min-w-0 border-b px-4 pb-3 pt-4">
        <div className="font-mono text-mono-label uppercase text-muted-foreground">
          {t("rightPanel.artifacts")}
        </div>
        <p className="mt-0.5 truncate text-caption text-body">
          {t("rightPanel.artifactsCount", { count: verifiedCollection.artifacts.length })}
        </p>
      </header>
      <div
        data-testid="artifact-floating-scroll"
        className="min-h-0 overflow-y-auto overflow-x-hidden px-3 py-3 [scrollbar-gutter:stable]"
      >
        <div className="flex flex-col gap-2">
          {verifiedCollection.artifacts.map((artifact) => {
            const Icon = iconForPath(artifact.path, artifact.kind);
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
                <span className="flex size-7 flex-none items-center justify-center rounded-xs bg-canvas-soft-2 text-muted-foreground">
                  <Icon className="size-4" />
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
