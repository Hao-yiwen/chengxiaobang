import {
  CheckMediumIcon,
  CopyIcon,
  PencilOutlineIcon,
  PullRequestOpenIcon,
  RefreshIcon
} from "@/assets/file-type-icons";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Message } from "@chengxiaobang/shared";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useCopy } from "@/lib/use-copy";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store";

/** 聊天气泡下方的操作栏：历史消息悬浮展示，当前底部消息可默认展示。 */
export function MessageActions({
  message,
  isLastAssistant = false,
  onEdit,
  canFork = false,
  copyContent,
  alwaysVisible = false
}: {
  message: Message;
  isLastAssistant?: boolean;
  onEdit?: () => void;
  canFork?: boolean;
  copyContent?: string;
  alwaysVisible?: boolean;
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
        "mt-1 flex items-center gap-2 transition-opacity",
        alwaysVisible
          ? "opacity-100"
          : "opacity-0 group-hover/msg:opacity-100 focus-within:opacity-100",
        isUser ? "justify-end" : "justify-start"
      )}
    >
      <ActionButton
        label={copied ? t("chat.copied") : t("chat.copy")}
        onClick={() => void copy(copyContent ?? message.content)}
      >
        {copied ? <CheckMediumIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
      </ActionButton>
      {!isUser && isLastAssistant && !isRunning ? (
        <ActionButton label={t("chat.regenerate")} onClick={() => void regenerateLast()}>
          <RefreshIcon className="size-3.5" />
        </ActionButton>
      ) : null}
      {isUser && !isRunning && onEdit ? (
        <ActionButton label={t("chat.edit")} onClick={onEdit}>
          <PencilOutlineIcon className="size-3.5" />
        </ActionButton>
      ) : null}
      {canFork && !isRunning ? (
        <ActionButton
          label={t("chat.forkFromHere")}
          onClick={() => void forkSession(message.id)}
        >
          <PullRequestOpenIcon className="size-3.5" />
        </ActionButton>
      ) : null}
    </div>
  );
}

const ActionButton = MetaActionButton;

export function MetaActionButton({
  label,
  onClick,
  children
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          onClick={onClick}
          className="rounded-xs p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
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
    <div className="w-full rounded-md border bg-card p-2">
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
        className="min-h-[56px] border-none focus-visible:ring-0"
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
