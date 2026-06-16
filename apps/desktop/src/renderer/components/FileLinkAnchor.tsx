import type { MouseEvent, ReactNode } from "react";
import { iconForPath } from "@/lib/file-icon";
import { useAppStore } from "@/store";
import { cn } from "@/lib/utils";

/**
 * 正文行内文件链接：把 AI 回答里指向本地文件的 Markdown 链接渲染成
 * 蓝色可点击的「图标 + 文件名」，点击后在右侧面板预览该文件（区别于末尾的 ArtifactCard 大卡片）。
 */
export function FileLinkAnchor({
  path,
  className,
  children
}: {
  path: string;
  className?: string;
  children?: ReactNode;
}) {
  const openFilePreview = useAppStore((state) => state.openFilePreview);
  const Icon = iconForPath(path);

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    // 拦截默认导航，改为在右侧文件预览面板打开本地文件
    event.preventDefault();
    console.info("[Markdown] 打开文件链接", { path });
    openFilePreview(path);
  }

  return (
    <a
      href={path}
      title={path}
      onClick={handleClick}
      className={cn(
        "wrap-anywhere font-medium text-primary underline underline-offset-2",
        className
      )}
    >
      <Icon className="mr-0.5 inline-block size-[1em] align-[-0.15em]" aria-hidden />
      {children}
    </a>
  );
}
