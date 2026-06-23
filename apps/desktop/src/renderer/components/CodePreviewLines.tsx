import type { HighlightLine } from "@/lib/code-highlight";
import { shikiTokenStyle } from "@/lib/code-highlight";
import { cn } from "@/lib/utils";
import styles from "@/components/CodePreviewLines.module.css";

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
            <span className={cn("cxb-code-line-number", styles.lineNumber)}>
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
        <span key={index} className={cn("cxb-shiki-token", styles.token)} style={shikiTokenStyle(token)}>
          {token.content}
        </span>
      ))}
    </>
  );
}
