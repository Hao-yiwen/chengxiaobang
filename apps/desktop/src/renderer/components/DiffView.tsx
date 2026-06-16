import { useTranslation } from "react-i18next";
import type { DiffLine } from "@/lib/diff";
import { cn } from "@/lib/utils";

// Vercel 语义色：新增行用链接蓝淡底，删除行用错误红淡底。
const LINE_STYLES: Record<DiffLine["type"], string> = {
  added: "bg-link-bg-soft/55 text-ink",
  removed: "bg-error-soft/70 text-muted-foreground",
  context: "text-muted-foreground"
};

/** Edit / Write 工具结果的逐行 diff 渲染。 */
export function DiffView({
  lines,
  height = "inline"
}: {
  lines: DiffLine[];
  height?: "inline" | "fill";
}) {
  const { t } = useTranslation();
  const showLineNumbers = lines.some(
    (line) =>
      line.hunk ||
      line.oldLineNumber !== undefined ||
      line.newLineNumber !== undefined
  );
  return (
    <div
      aria-label={t("chat.diffView")}
      className={cn(
        "overflow-auto border-t bg-background py-1 font-mono text-micro leading-relaxed",
        height === "fill" ? "h-full" : "max-h-[220px]"
      )}
    >
      {lines.map((line, index) => (
        <div
          key={index}
          className={cn(
            "flex px-3",
            line.hunk ? "bg-canvas-soft-2 text-muted-foreground" : LINE_STYLES[line.type]
          )}
        >
          {showLineNumbers ? (
            <>
              <span className="w-9 flex-none select-none pr-2 text-right text-muted-slate/70">
                {line.oldLineNumber ?? ""}
              </span>
              <span className="w-9 flex-none select-none pr-2 text-right text-muted-slate/70">
                {line.newLineNumber ?? ""}
              </span>
            </>
          ) : null}
          <span className="w-4 flex-none select-none">
            {line.hunk ? "" : line.type === "added" ? "+" : line.type === "removed" ? "-" : " "}
          </span>
          <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">
            {line.text || " "}
          </span>
        </div>
      ))}
    </div>
  );
}
