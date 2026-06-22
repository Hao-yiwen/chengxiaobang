import { useMemo, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import {
  FileDiff,
  MultiFileDiff
} from "@pierre/diffs/react";
import type { FileDiffOptions } from "@pierre/diffs";
import {
  textDiffFiles,
  type DiffViewHeight,
  type PatchDiffBlock,
  type TextDiffSource
} from "@/lib/diff";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store";

type DiffViewCommonProps = {
  height?: DiffViewHeight;
  hideScrollbar?: boolean;
  compactBlockGap?: boolean;
};

type DiffViewProps =
  | ({
      source: TextDiffSource;
      blocks?: never;
    } & DiffViewCommonProps)
  | ({
      blocks: PatchDiffBlock[];
      source?: never;
    } & DiffViewCommonProps);

/** @pierre/diffs 的统一包装层，外层 UI 负责文件标题和状态展示。 */
export function DiffView({
  source,
  blocks,
  height = "inline",
  hideScrollbar = false,
  compactBlockGap = false
}: DiffViewProps) {
  const { t } = useTranslation();
  const settings = useAppStore((state) => state.codePreviewSettings);
  const options = useMemo(
    () =>
      ({
        diffStyle: "unified",
        diffIndicators: "classic",
        disableFileHeader: true,
        hunkSeparators: "line-info-basic",
        lineDiffType: "word",
        overflow: settings.wrapLongLines ? "wrap" : "scroll",
        theme: {
          light: settings.lightTheme,
          dark: settings.darkTheme
        },
        tokenizeMaxLineLength: 20_000
      }) satisfies FileDiffOptions<undefined>,
    [settings.darkTheme, settings.lightTheme, settings.wrapLongLines]
  );
  const style = useMemo(
    () => pierreDiffStyle(settings.fontSize, compactBlockGap),
    [compactBlockGap, settings.fontSize]
  );
  const textFiles = useMemo(
    () => (source ? textDiffFiles(source) : undefined),
    [source]
  );

  return (
    <div
      aria-label={t("chat.diffView")}
      data-testid="pierre-diff-view"
      className={cn(
        "min-w-0 bg-background font-mono text-micro",
        diffViewOverflowClass(height),
        hideScrollbar ? "scrollbar-hidden [scrollbar-gutter:auto]" : "[scrollbar-gutter:stable]",
        diffViewHeightClass(height)
      )}
      style={style}
    >
      {textFiles ? (
        <MultiFileDiff
          oldFile={textFiles.oldFile}
          newFile={textFiles.newFile}
          options={options}
          disableWorkerPool
        />
      ) : null}
      {blocks?.map((block) =>
        block.kind === "file" ? (
          <FileDiff
            key={block.id}
            fileDiff={block.fileDiff}
            options={options}
            disableWorkerPool
          />
        ) : (
          <RawPatchFallback key={block.id} block={block} />
        )
      )}
    </div>
  );
}

function diffViewHeightClass(height: DiffViewHeight): string {
  if (height === "fill") {
    return "h-full";
  }
  if (height === "review") {
    return "";
  }
  return "max-h-[420px]";
}

function diffViewOverflowClass(height: DiffViewHeight): string {
  return height === "review" ? "overflow-visible" : "overflow-auto";
}

function RawPatchFallback({ block }: { block: Extract<PatchDiffBlock, { kind: "raw" }> }) {
  const { t } = useTranslation();
  return (
    <div className="border-t bg-card">
      <div className="border-b px-3 py-1.5 text-caption text-muted-foreground">
        {t("rightPanel.changesPatchParseFailed")}
      </div>
      <pre className="whitespace-pre-wrap break-words px-3 py-2 font-mono text-micro leading-relaxed text-muted-foreground">
        {block.raw}
      </pre>
    </div>
  );
}

function pierreDiffStyle(fontSize: number, compactBlockGap: boolean): CSSProperties {
  const lineHeight = fontSize + 8;
  return {
    "--diffs-font-size": `${fontSize}px`,
    "--diffs-line-height": `${lineHeight}px`,
    ...(compactBlockGap ? { "--diffs-gap-block": "0px" } : {}),
    "--diffs-font-family": "\"JetBrains Mono\", \"SF Mono\", Menlo, monospace",
    "--diffs-header-font-family": "ui-sans-serif, system-ui, sans-serif",
    "--diffs-light-bg": "rgb(var(--background))",
    "--diffs-light": "rgb(var(--foreground))",
    "--diffs-bg-context-override": "rgb(var(--background))",
    "--diffs-bg-context-gutter-override": "rgb(var(--canvas-soft-2))",
    "--diffs-bg-separator-override": "rgb(var(--canvas-soft-2))"
  } as CSSProperties;
}
