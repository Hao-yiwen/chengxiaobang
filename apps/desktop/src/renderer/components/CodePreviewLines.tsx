import type { HighlightLine } from "@/lib/code-highlight";
import { shikiTokenStyle } from "@/lib/code-highlight";
import { cn } from "@/lib/utils";

export function CodePreviewLines({
  highlightedLines,
  lineNumbers,
  plainLines,
  wrap
}: {
  highlightedLines?: HighlightLine[];
  lineNumbers: boolean;
  plainLines: string[];
  wrap: boolean;
}) {
  return (
    <>
      {plainLines.map((plainLine, index) => (
        <span key={index} className={cn("flex", !wrap && "min-w-max")}>
          {lineNumbers ? (
            <span className="cxb-code-line-number">
              {index + 1}
            </span>
          ) : null}
          <span className={cn("min-h-5 min-w-0 flex-1", wrap ? "whitespace-pre-wrap break-all" : "whitespace-pre")}>
            <CodePreviewLine highlightedLine={highlightedLines?.[index]} plainLine={plainLine} />
          </span>
        </span>
      ))}
    </>
  );
}

function CodePreviewLine({
  highlightedLine,
  plainLine
}: {
  highlightedLine?: HighlightLine;
  plainLine: string;
}) {
  if (!highlightedLine) {
    return plainLine || " ";
  }
  if (highlightedLine.length === 0) {
    return " ";
  }
  return (
    <>
      {highlightedLine.map((token, index) => (
        <span key={index} className="cxb-shiki-token" style={shikiTokenStyle(token)}>
          {token.content}
        </span>
      ))}
    </>
  );
}
