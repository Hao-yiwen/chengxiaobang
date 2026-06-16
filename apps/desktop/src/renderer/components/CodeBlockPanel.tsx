import { type ReactNode, useEffect, useRef, useState } from "react";
import { CheckIcon, CopyIcon, TextAlignLeftIcon as WrapText } from "@phosphor-icons/react";
import { CodeBlock } from "streamdown";
import {
  normalizeCodeLanguage,
  resolveCodeLanguageIcon,
  type FileIconComponent
} from "@/lib/code-language-icons";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from "@/components/ui/tooltip";
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
  const [wrap, setWrap] = useState(false);
  const normalizedLanguage = normalizeCodeLanguage(language);
  const Icon = resolveCodeLanguageIcon(normalizedLanguage);
  const wrapLabel = wrap ? "关闭自动换行" : "自动换行";
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
            onClick={() => setWrap((value) => !value)}
          >
            <WrapText className="size-3" />
          </button>
        </TooltipTrigger>
        <TooltipContent>{wrapLabel}</TooltipContent>
      </Tooltip>
      <CopyButton code={code} />
    </TooltipProvider>
  );

  return (
    <div
      className={cn("cxb-code-block-shell", wrap && "is-wrapped", className)}
      data-code-wrap={wrap ? "true" : "false"}
      aria-label={ariaLabel}
    >
      {normalizedLanguage === "text" ? (
        <PlainTextCodeBlock
          actions={actions}
          code={code}
          Icon={Icon}
          isIncomplete={isIncomplete}
          language={normalizedLanguage}
        />
      ) : (
        <>
          <Icon
            aria-hidden
            className="cxb-svg-icon cxb-code-block-header-icon size-3 flex-none opacity-70"
          />
          <CodeBlock
            code={code}
            isIncomplete={isIncomplete}
            language={normalizedLanguage}
            lineNumbers={false}
          >
            {actions}
          </CodeBlock>
        </>
      )}
    </div>
  );
}

function PlainTextCodeBlock({
  actions,
  code,
  Icon,
  isIncomplete,
  language
}: {
  actions: ReactNode;
  code: string;
  Icon: FileIconComponent;
  isIncomplete: boolean;
  language: string;
}) {
  return (
    <div
      data-incomplete={isIncomplete || undefined}
      data-language={language}
      data-streamdown="code-block"
    >
      <div data-has-inline-icon="true" data-language={language} data-streamdown="code-block-header">
        <Icon aria-hidden className="cxb-svg-icon size-3 flex-none opacity-70" />
        <span>{language}</span>
      </div>
      <div>
        <div data-streamdown="code-block-actions">{actions}</div>
      </div>
      <div data-language={language} data-streamdown="code-block-body">
        <pre>
          <code>{trimTrailingNewlines(code)}</code>
        </pre>
      </div>
    </div>
  );
}

function trimTrailingNewlines(value: string): string {
  return value.replace(/[\r\n]+$/g, "");
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
            <CheckIcon className="size-3" weight="bold" />
          ) : (
            <CopyIcon className="size-3" />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent>{copied ? "已复制" : "复制代码"}</TooltipContent>
    </Tooltip>
  );
}
