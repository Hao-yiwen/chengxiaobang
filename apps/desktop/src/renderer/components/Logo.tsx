import iconUrl from "../../../assets/icon.png";
import { cn } from "@/lib/utils";

/**
 * 程小帮品牌图标 —— 应用图标（卡通形象）。默认 size-8，可由 className 覆盖尺寸。
 * 图标本身已含圆角，这里用 rounded-lg 让缩放后边角依旧贴合容器。
 */
export function Logo({ className }: { className?: string }) {
  return (
    <img
      src={iconUrl}
      alt="程小帮"
      className={cn("size-8 rounded-lg object-cover", className)}
    />
  );
}
