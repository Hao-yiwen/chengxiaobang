import { isValidElement, type MouseEvent, type ReactNode } from "react";
import { iconForPath } from "@/lib/file-icon";
import { basenameOf } from "../../common/file-preview";
import { useAppStore } from "@/store";
import { cn } from "@/lib/utils";

const GENERIC_FILE_LINK_LABELS = new Set([
  "",
  "链接",
  "文件",
  "下载",
  "打开",
  "查看",
  "预览",
  "link",
  "file",
  "download",
  "open",
  "view",
  "preview"
]);

function plainTextFromReactNode(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") {
    return "";
  }
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map((child) => plainTextFromReactNode(child)).join("");
  }
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return plainTextFromReactNode(node.props.children);
  }
  return "";
}

function shouldShowFileName(children: ReactNode): boolean {
  const label = plainTextFromReactNode(children).trim();
  return GENERIC_FILE_LINK_LABELS.has(label) || GENERIC_FILE_LINK_LABELS.has(label.toLowerCase());
}

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
  const label = shouldShowFileName(children) ? basenameOf(path) : children;

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
        className,
        "wrap-anywhere font-medium text-link no-underline transition-colors hover:text-link-deep hover:no-underline"
      )}
    >
      <Icon className="mr-0.5 inline-block size-[1em] align-[-0.15em] text-muted-foreground" aria-hidden />
      {label}
    </a>
  );
}
