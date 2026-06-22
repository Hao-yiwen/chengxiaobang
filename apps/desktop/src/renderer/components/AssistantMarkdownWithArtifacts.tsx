import { useEffect, useMemo } from "react";
import { ArtifactCard } from "@/components/ArtifactCard";
import { Markdown } from "@/components/Markdown";
import { StreamingMarkdown } from "@/components/StreamingMarkdown";
import { useVerifiedArtifacts } from "@/hooks/use-verified-artifacts";
import {
  cleanMarkdownForVerifiedArtifacts,
  logArtifactDeclarationResult,
  parseArtifactDeclarations
} from "@/lib/artifact";

export function AssistantMarkdownWithArtifacts({
  text,
  messageId,
  streaming = false,
  showCaret = true
}: {
  text: string;
  messageId?: string;
  streaming?: boolean;
  showCaret?: boolean;
}) {
  const parsed = useMemo(() => parseArtifactDeclarations(text), [text]);
  const source = messageId ?? (streaming ? "streaming" : "assistant");
  const verified = useVerifiedArtifacts(parsed.artifactDeclarations, source);
  const cleanMarkdown = useMemo(
    () => cleanMarkdownForVerifiedArtifacts(text, parsed, verified.artifacts),
    [parsed, text, verified.artifacts]
  );

  useEffect(() => {
    if (streaming) {
      return;
    }
    if (parsed.artifacts.length === 0 && parsed.diagnostics.length === 0) {
      return;
    }
    logArtifactDeclarationResult(source, parsed);
  }, [parsed, source, streaming]);

  const markdown = !cleanMarkdown.trim()
    ? null
    : streaming
      ? <StreamingMarkdown text={cleanMarkdown} showCaret={showCaret} />
      : <Markdown text={cleanMarkdown} />;
  return (
    <>
      {markdown}
      {verified.artifacts.length > 0 ? (
        <div className="mt-3 flex max-w-full flex-col items-start gap-2">
          {verified.artifacts.map((artifact) => (
            <ArtifactCard key={artifact.path} artifact={artifact} />
          ))}
        </div>
      ) : null}
    </>
  );
}
