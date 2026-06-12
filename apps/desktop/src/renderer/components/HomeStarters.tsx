import {
  FileCodeIcon as FileCode2,
  FileTextIcon as FileText,
  FlaskIcon as FlaskConical,
  PresentationChartIcon as Presentation,
  type Icon
} from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "@/store";

/**
 * Quick-start task chips shown on the empty home screen. Each starter is a
 * complete, self-contained task; clicking one fills the composer and submits it
 * straight away, so the run starts and completes without further editing.
 */
const STARTERS: {
  key: "ppt" | "doc" | "explain" | "test";
  icon: Icon;
}[] = [
  { key: "ppt", icon: Presentation },
  { key: "doc", icon: FileText },
  { key: "explain", icon: FileCode2 },
  { key: "test", icon: FlaskConical }
];

export function HomeStarters() {
  const { t } = useTranslation();
  const setInput = useAppStore((state) => state.setInput);
  const submit = useAppStore((state) => state.submit);

  function pick(prompt: string): void {
    // 直接把完整任务写入输入框并提交运行；未配置模型时 submit 会弹出配置弹窗并保留输入。
    setInput(prompt);
    void submit();
  }

  return (
    <div className="flex flex-wrap justify-center gap-2">
      {STARTERS.map(({ key, icon: Icon }) => (
        <button
          key={key}
          type="button"
          onClick={() => pick(t(`home.starters.${key}Prompt` as const))}
          className="inline-flex items-center gap-1.5 rounded-pill border border-border bg-card px-3.5 py-1.5 text-caption text-foreground transition-colors hover:border-hairline-strong hover:bg-canvas-soft-2"
        >
          <Icon className="size-3.5 flex-none stroke-[1.75]" />
          {t(`home.starters.${key}Title` as const)}
        </button>
      ))}
    </div>
  );
}
