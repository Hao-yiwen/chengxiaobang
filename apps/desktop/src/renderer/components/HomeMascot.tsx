import mascotUrl from "../../../assets/home-mascot-cutout.png";
import { cn } from "@/lib/utils";

/**
 * 首页人物抠图，只用于欢迎态 hero；应用图标仍由 Logo 组件承载。
 */
export function HomeMascot({ className }: { className?: string }) {
  return (
    <img
      src={mascotUrl}
      alt="程小帮人物"
      className={cn("size-24 object-contain", className)}
    />
  );
}
