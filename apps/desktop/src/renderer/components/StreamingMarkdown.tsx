import { memo } from "react";
import { StreamdownMarkdown } from "@/components/Markdown";

/**
 * 流式 assistant 输出使用 Streamdown streaming 模式，未闭合 Markdown、动画和光标
 * 统一交给 Streamdown 处理，避免本地继续维护流式分块逻辑。
 */
export const StreamingMarkdown = memo(function StreamingMarkdown({
  text,
  className
}: {
  text: string;
  className?: string;
}) {
  return <StreamdownMarkdown text={text} className={className} mode="streaming" isAnimating />;
});
