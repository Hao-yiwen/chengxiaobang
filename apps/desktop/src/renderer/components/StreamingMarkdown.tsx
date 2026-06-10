import { useMemo } from "react";
import { Markdown } from "@/components/Markdown";
import { repairStreamingMarkdown, splitMarkdownBlocks } from "@/lib/streaming-markdown";
import { cn } from "@/lib/utils";

/**
 * Streaming variant of `Markdown`, modeled on DeepSeek-GUI's renderer
 * (streamdown): the accumulated text is tail-repaired first, then split into
 * top-level blocks rendered as individually memoized `Markdown` instances.
 * Settled blocks keep identical text between deltas, so `Markdown`'s memo
 * skips them and only the trailing block re-parses per delta.
 */
export function StreamingMarkdown({ text, className }: { text: string; className?: string }) {
  const blocks = useMemo(() => splitMarkdownBlocks(repairStreamingMarkdown(text)), [text]);
  return (
    <div className={cn("space-y-3", className)}>
      {blocks.map((block, index) => (
        <Markdown key={index} text={block} />
      ))}
    </div>
  );
}
