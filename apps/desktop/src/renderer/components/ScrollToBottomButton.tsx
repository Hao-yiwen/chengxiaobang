import { ArrowDownIcon as ArrowDown } from "@phosphor-icons/react";
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
      className="absolute inset-x-0 bottom-4 z-10 mx-auto w-fit animate-scale-in rounded-full border bg-card p-2 text-muted-foreground shadow-overlay transition-colors hover:bg-muted hover:text-foreground"
    >
      <ArrowDown className="size-4" />
    </button>
  );
}
