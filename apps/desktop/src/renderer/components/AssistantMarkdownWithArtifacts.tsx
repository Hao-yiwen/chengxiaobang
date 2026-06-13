import { useEffect, useMemo } from "react";
import { ArtifactCard } from "@/components/ArtifactCard";
import { Markdown } from "@/components/Markdown";
import { StreamingMarkdown } from "@/components/StreamingMarkdown";
import {
  logArtifactDeclarationResult,
  parseArtifactDeclarations
} from "@/lib/artifact";

export function AssistantMarkdownWithArtifacts({
  text,
  messageId,
  streaming = false
}: {
  text: string;
  messageId?: string;
  streaming?: boolean;
}) {
  const parsed = useMemo(() => parseArtifactDeclarations(text), [text]);
  const source = messageId ?? (streaming ? "streaming" : "assistant");

  useEffect(() => {
    if (streaming) {
      return;
    }
    if (parsed.artifacts.length === 0 && parsed.diagnostics.length === 0) {
      return;
    }
    logArtifactDeclarationResult(source, parsed);
  }, [parsed, source, streaming]);

  const MarkdownRenderer = streaming ? StreamingMarkdown : Markdown;
  return (
    <>
      {parsed.cleanMarkdown.trim() ? <MarkdownRenderer text={parsed.cleanMarkdown} /> : null}
      {parsed.artifacts.length > 0 ? (
        <div className="mt-3 flex max-w-full flex-col items-start gap-2">
          {parsed.artifacts.map((artifact) => (
            <ArtifactCard key={artifact.path} artifact={artifact} />
          ))}
        </div>
      ) : null}
    </>
  );
}
