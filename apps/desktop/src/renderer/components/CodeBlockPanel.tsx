import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { CheckMediumIcon, CopyIcon, UndoIcon } from "@/assets/file-type-icons";
import { CodePreviewLines } from "@/components/CodePreviewLines";
import {
  normalizeCodeLanguage,
  resolveCodeLanguageIcon
} from "@/lib/code-language-icons";
import {
  codePreviewInlineStyle,
  type HighlightLine,
  normalizeCodePreviewText,
  splitCodePreviewLines,
  useShikiHighlight
} from "@/lib/code-highlight";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from "@/components/ui/tooltip";
import { useAppStore } from "@/store";
import { cn } from "@/lib/utils";

export interface CodeBlockPanelProps {
  code: string;
  language?: string;
  isIncomplete?: boolean;
  className?: string;
  ariaLabel?: string;
}

export function CodeBlockPanel({
  code,
  language,
  isIncomplete = false,
  className,
  ariaLabel
}: CodeBlockPanelProps) {
  const settings = useAppStore((state) => state.codePreviewSettings);
  const [wrapOverride, setWrapOverride] = useState<boolean | undefined>();
  const normalizedLanguage = normalizeCodeLanguage(language);
  const Icon = resolveCodeLanguageIcon(normalizedLanguage);
  const displayCode = useMemo(() => trimCodeBlockBoundaryNewlines(normalizeCodePreviewText(code)), [code]);
  const plainLines = useMemo(() => splitCodePreviewLines(displayCode), [displayCode]);
  const highlight = useShikiHighlight(displayCode, normalizedLanguage, settings, "CodeBlockPanel");
  const wrap = wrapOverride ?? settings.wrapLongLines;
  const wrapLabel = wrap ? "关闭自动换行" : "自动换行";

  useEffect(() => {
    setWrapOverride(undefined);
  }, [settings.wrapLongLines]);

  const actions = (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="cxb-code-block-wrap-button"
            data-streamdown="code-block-wrap-button"
            aria-label={wrapLabel}
            aria-pressed={wrap}
            onClick={() => setWrapOverride((value) => !(value ?? settings.wrapLongLines))}
          >
            <UndoIcon className="size-3" />
          </button>
        </TooltipTrigger>
        <TooltipContent>{wrapLabel}</TooltipContent>
      </Tooltip>
      <CopyButton code={displayCode} />
    </TooltipProvider>
  );

  return (
    <div
      className={cn("cxb-code-block-shell", wrap && "is-wrapped", className)}
      data-code-wrap={wrap ? "true" : "false"}
      data-code-line-numbers="false"
      data-code-font-size={settings.fontSize}
      aria-label={ariaLabel}
      style={codePreviewInlineStyle(settings)}
    >
      <CodeBlockFrame
        actions={actions}
        headerIcon={
          <Icon
            aria-hidden
            className="cxb-svg-icon cxb-code-block-header-icon size-3 flex-none opacity-70"
          />
        }
        highlightedLines={highlight.lines}
        isIncomplete={isIncomplete}
        language={normalizedLanguage}
        lineNumbers={false}
        plainLines={plainLines}
        wrap={wrap}
      />
    </div>
  );
}

function CodeBlockFrame({
  actions,
  headerIcon,
  highlightedLines,
  isIncomplete,
  language,
  lineNumbers,
  plainLines,
  wrap
}: {
  actions: ReactNode;
  headerIcon: ReactNode;
  highlightedLines?: HighlightLine[];
  isIncomplete: boolean;
  language: string;
  lineNumbers: boolean;
  plainLines: string[];
  wrap: boolean;
}) {
  return (
    <div
      data-incomplete={isIncomplete || undefined}
      data-language={language}
      data-streamdown="code-block"
    >
      <div data-language={language} data-streamdown="code-block-header">
        <span data-code-block-header-label>
          {headerIcon}
          <span>{language}</span>
        </span>
      </div>
      <div>
        <div data-streamdown="code-block-actions">{actions}</div>
      </div>
      <div data-language={language} data-streamdown="code-block-body">
        <pre>
          <code>
            <CodePreviewLines
              highlightedLines={highlightedLines}
              lineNumbers={lineNumbers}
              plainLines={plainLines}
              wrap={wrap}
            />
          </code>
        </pre>
      </div>
    </div>
  );
}

function trimCodeBlockBoundaryNewlines(value: string): string {
  return value.replace(/^(?:[ \t]*\n)+/, "").replace(/(?:\n[ \t]*)+$/g, "");
}

function CopyButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current);
      }
    },
    []
  );

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current);
      }
      resetTimerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error("[CodeBlock] 复制代码到剪贴板失败", {
        codeLength: code.length,
        error
      });
    }
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="cxb-code-block-copy-button"
          aria-label="复制代码"
          onClick={handleCopy}
        >
          {copied ? (
            <CheckMediumIcon className="size-3" />
          ) : (
            <CopyIcon className="size-3" />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent>{copied ? "已复制" : "复制代码"}</TooltipContent>
    </Tooltip>
  );
}
