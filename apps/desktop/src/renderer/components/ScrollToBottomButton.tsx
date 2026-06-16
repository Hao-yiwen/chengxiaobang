import { ArrowUpIcon } from "@/assets/file-type-icons";
import { useTranslation } from "react-i18next";

/** 用户离开最新内容时显示的回到底部浮动按钮。 */
export function ScrollToBottomButton({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      aria-label={t("chat.scrollToBottom")}
      title={t("chat.scrollToBottom")}
      onClick={onClick}
      className="pointer-events-auto animate-scale-in rounded-full border bg-card p-2 text-muted-foreground shadow-overlay transition-colors hover:bg-muted hover:text-foreground"
    >
      <ArrowUpIcon className="size-4 rotate-180" />
    </button>
  );
}
