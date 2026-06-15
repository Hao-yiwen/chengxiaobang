import { type CSSProperties, type ReactNode, useState } from "react";
import { TextAlignLeftIcon as WrapText } from "@phosphor-icons/react";
import { CodeBlock, CodeBlockCopyButton } from "streamdown";
import { normalizeCodeLanguage, resolveCodeLanguageIcon } from "@/lib/code-language-icons";
import { cn } from "@/lib/utils";

export interface CodeBlockPanelProps {
  code: string;
  language?: string;
  isIncomplete?: boolean;
  className?: string;
  ariaLabel?: string;
}

type CodeBlockIconStyle = CSSProperties & {
  "--cxb-code-language-icon": string;
};

export function CodeBlockPanel({
  code,
  language,
  isIncomplete = false,
  className,
  ariaLabel
}: CodeBlockPanelProps) {
  const [wrap, setWrap] = useState(false);
  const normalizedLanguage = normalizeCodeLanguage(language);
  const iconUrl = resolveCodeLanguageIcon(normalizedLanguage);
  const iconStyle: CodeBlockIconStyle = {
    "--cxb-code-language-icon": `url("${iconUrl}")`
  };
  const actions = (
    <>
      <button
        type="button"
        className="cxb-code-block-wrap-button"
        data-streamdown="code-block-wrap-button"
        aria-label={wrap ? "关闭自动换行" : "自动换行"}
        aria-pressed={wrap}
        title={wrap ? "关闭自动换行" : "自动换行"}
        onClick={() => setWrap((value) => !value)}
      >
        <WrapText className="size-3.5" />
      </button>
      <CodeBlockCopyButton aria-label="复制代码" code={code} title="复制代码" />
    </>
  );

  return (
    <div
      className={cn("cxb-code-block-shell", wrap && "is-wrapped", className)}
      data-code-wrap={wrap ? "true" : "false"}
      style={iconStyle}
      aria-label={ariaLabel}
    >
      {normalizedLanguage === "text" ? (
        <PlainTextCodeBlock
          actions={actions}
          code={code}
          isIncomplete={isIncomplete}
          language={normalizedLanguage}
        />
      ) : (
        <CodeBlock
          code={code}
          isIncomplete={isIncomplete}
          language={normalizedLanguage}
          lineNumbers={false}
        >
          {actions}
        </CodeBlock>
      )}
    </div>
  );
}

function PlainTextCodeBlock({
  actions,
  code,
  isIncomplete,
  language
}: {
  actions: ReactNode;
  code: string;
  isIncomplete: boolean;
  language: string;
}) {
  return (
    <div
      data-incomplete={isIncomplete || undefined}
      data-language={language}
      data-streamdown="code-block"
    >
      <div data-language={language} data-streamdown="code-block-header">
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
