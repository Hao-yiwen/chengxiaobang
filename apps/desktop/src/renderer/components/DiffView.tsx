import { useTranslation } from "react-i18next";
import type { DiffLine } from "@/lib/diff";
import { cn } from "@/lib/utils";

// Vercel 语义色：新增行用链接蓝淡底，删除行用错误红淡底。
const LINE_STYLES: Record<DiffLine["type"], string> = {
  added: "bg-link-bg-soft/55 text-ink",
  removed: "bg-error-soft/70 text-muted-foreground",
  context: "text-muted-foreground"
};

/** edit_file / write_file 工具结果的逐行 diff 渲染。 */
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
