import { Check, Copy, GitFork, Pencil, RefreshCw } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Message } from "@chengxiaobang/shared";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useCopy } from "@/lib/use-copy";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store";

/**
 * Hover action bar under a chat message: copy for everyone, regenerate on the
 * latest assistant answer, edit-and-resend on user messages. Mutating actions
 * hide while a run is active.
 */
export function MessageActions({
  message,
  isLastAssistant = false,
  onEdit
}: {
  message: Message;
  isLastAssistant?: boolean;
  onEdit?: () => void;
}) {
  const { t } = useTranslation();
  const isRunning = useAppStore((state) => state.isRunning);
  const regenerateLast = useAppStore((state) => state.regenerateLast);
  const forkSession = useAppStore((state) => state.forkSession);
  const { copied, copy } = useCopy();
  const isUser = message.role === "user";

  return (
    <div
      className={cn(
        "mt-0.5 flex items-center gap-0.5 opacity-0 transition-opacity",
        "group-hover/msg:opacity-100 focus-within:opacity-100",
        isUser ? "justify-end" : "justify-start"
      )}
    >
      <ActionButton
        label={copied ? t("chat.copied") : t("chat.copy")}
        onClick={() => void copy(message.content)}
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </ActionButton>
      {!isUser && isLastAssistant && !isRunning ? (
        <ActionButton label={t("chat.regenerate")} onClick={() => void regenerateLast()}>
          <RefreshCw className="size-3.5" />
        </ActionButton>
      ) : null}
      {isUser && !isRunning && onEdit ? (
        <ActionButton label={t("chat.edit")} onClick={onEdit}>
          <Pencil className="size-3.5" />
        </ActionButton>
      ) : null}
      {!isRunning ? (
        <ActionButton
          label={t("chat.forkFromHere")}
          onClick={() => void forkSession(message.id)}
        >
          <GitFork className="size-3.5" />
        </ActionButton>
      ) : null}
    </div>
  );
}

function ActionButton({
  label,
  onClick,
  children
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      {children}
    </button>
  );
}

/** Inline editor swapped in for a user bubble during edit-and-resend. */
export function MessageEditor({
  initial,
  onCancel,
  onSubmit
}: {
  initial: string;
  onCancel: () => void;
  onSubmit: (content: string) => void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState(initial);
  const canSend = value.trim().length > 0;

  return (
    <div className="w-full rounded-xl border bg-card p-2 shadow-soft">
      <Textarea
        autoFocus
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && canSend) {
            event.preventDefault();
            onSubmit(value);
          }
          if (event.key === "Escape") {
            onCancel();
          }
        }}
        aria-label={t("chat.edit")}
        className="min-h-[56px] border-none shadow-none focus-visible:ring-0"
      />
      <div className="flex justify-end gap-2 pt-1.5">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          {t("chat.editCancel")}
        </Button>
        <Button size="sm" disabled={!canSend} onClick={() => onSubmit(value)}>
          {t("chat.editSend")}
        </Button>
      </div>
    </div>
  );
}
