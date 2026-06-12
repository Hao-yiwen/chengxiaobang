import { ArrowDown } from "lucide-react";
import { useTranslation } from "react-i18next";

/** Floating control shown when the user has scrolled away from the newest content. */
export function ScrollToBottomButton({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      aria-label={t("chat.scrollToBottom")}
      title={t("chat.scrollToBottom")}
      onClick={onClick}
      className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2 animate-scale-in rounded-full border bg-card p-2 text-muted-foreground shadow-overlay transition-colors hover:bg-muted hover:text-foreground"
    >
      <ArrowDown className="size-4" />
    </button>
  );
}
