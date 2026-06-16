import { memo } from "react";
import { StreamdownMarkdown } from "@/components/Markdown";

/**
 * 流式 assistant 输出使用 Streamdown streaming 模式，未闭合 Markdown 和动画
 * 统一交给 Streamdown 处理；外层可在已有工具 loading 时关闭内置光标。
 */
export const StreamingMarkdown = memo(function StreamingMarkdown({
  text,
  className,
  showCaret = true
}: {
  text: string;
  className?: string;
  showCaret?: boolean;
}) {
  return (
    <StreamdownMarkdown
      text={text}
      className={className}
      mode="streaming"
      isAnimating
      showCaret={showCaret}
    />
  );
});
