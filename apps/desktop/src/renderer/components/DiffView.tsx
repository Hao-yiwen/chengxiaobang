import { useTranslation } from "react-i18next";
import type { DiffLine } from "@/lib/diff";
import { cn } from "@/lib/utils";

// DESIGN.md washes: pale-green for additions, quiet muted for removals.
const LINE_STYLES: Record<DiffLine["type"], string> = {
  added: "bg-pale-green text-ink",
  removed: "bg-muted text-muted-foreground/70",
  context: "text-muted-foreground"
};

/** Line-based diff rendering for edit_file / write_file tool calls. */
export function DiffView({ lines }: { lines: DiffLine[] }) {
  const { t } = useTranslation();
  return (
    <div
      aria-label={t("chat.diffView")}
      className="max-h-[220px] overflow-auto border-t bg-background py-1 font-mono text-micro leading-relaxed"
    >
      {lines.map((line, index) => (
        <div key={index} className={cn("flex px-3", LINE_STYLES[line.type])}>
          <span className="w-4 flex-none select-none">
            {line.type === "added" ? "+" : line.type === "removed" ? "-" : " "}
          </span>
          <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">{line.text}</span>
        </div>
      ))}
    </div>
  );
}
