import {
  CheckCircleIcon,
  CheckMediumIcon,
  CopyIcon,
  InfoCircleIcon,
  WarningCircleIcon,
  XCircleIcon,
  XMarkIcon
} from "@/assets/file-type-icons";
import { type ComponentType, type MouseEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport
} from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { type NotificationToast, useAppStore } from "@/store";

const AUTO_DISMISS_MS = 6_000;

const iconByKind: Record<NotificationToast["kind"], ComponentType<{ className?: string }>> = {
  success: CheckCircleIcon,
  warning: WarningCircleIcon,
  error: XCircleIcon
};

const toneByKind: Record<NotificationToast["kind"], string> = {
  success: "text-link",
  warning: "text-warning-deep",
  error: "text-error-deep"
};

export function NotificationToasts() {
  const { t } = useTranslation();
  const notice = useAppStore((state) => state.notice);
  const setNotice = useAppStore((state) => state.setNotice);
  const toasts = useAppStore((state) => state.notificationToasts);
  const dismiss = useAppStore((state) => state.dismissNotificationToast);

  if (!notice && toasts.length === 0) {
    return null;
  }

  return (
    <ToastProvider swipeDirection="right" duration={AUTO_DISMISS_MS}>
      {notice ? (
        <Toast
          open
          onOpenChange={(open) => {
            if (!open) {
              console.debug("[notifications] 关闭全局提示", { source: "notice" });
              setNotice(undefined);
            }
          }}
        >
          <InfoCircleIcon className="mt-0.5 size-[18px] flex-none text-link" />
          <div className="min-w-0 max-h-[200px] overflow-y-auto">
            <ToastTitle>{notice}</ToastTitle>
          </div>
          <CopyToastButton text={notice} label={t("notifications.copy")} />
          <ToastCloseButton />
        </Toast>
      ) : null}
      {toasts.map((toast) => (
        <NotificationToastItem key={toast.id} toast={toast} onDismiss={() => dismiss(toast.id)} />
      ))}
      <ToastViewport />
    </ToastProvider>
  );
}

function NotificationToastItem(props: { toast: NotificationToast; onDismiss(): void }) {
  const { t } = useTranslation();
  const Icon = iconByKind[props.toast.kind];
  const selectSession = useAppStore((state) => state.selectSession);
  const canOpenSession = Boolean(props.toast.sessionId);
  const copyText = toastTextForCopy(props.toast);

  function openSessionFromToast(): void {
    if (!props.toast.sessionId) {
      return;
    }
    console.info("[notifications] 点击会话通知，切换到目标会话", {
      sessionId: props.toast.sessionId,
      runId: props.toast.runId
    });
    props.onDismiss();
    void selectSession(props.toast.sessionId);
  }

  return (
    <Toast
      role={canOpenSession ? "button" : undefined}
      tabIndex={canOpenSession ? 0 : undefined}
      title={canOpenSession ? t("notifications.openSession") : undefined}
      className={cn(canOpenSession && "cursor-pointer transition-colors hover:bg-canvas-soft")}
      onClick={canOpenSession ? openSessionFromToast : undefined}
      onKeyDown={
        canOpenSession
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                openSessionFromToast();
              }
            }
          : undefined
      }
      onOpenChange={(open) => {
        if (!open) {
          props.onDismiss();
        }
      }}
    >
      <Icon className={cn("mt-0.5 size-[18px] flex-none", toneByKind[props.toast.kind])} />
      <div className="min-w-0 max-h-[200px] overflow-y-auto">
        <ToastTitle>{props.toast.title}</ToastTitle>
        {props.toast.description ? (
          <ToastDescription>{props.toast.description}</ToastDescription>
        ) : null}
      </div>
      <CopyToastButton text={copyText} label={t("notifications.copy")} />
      <ToastCloseButton title={t("notifications.dismiss")} />
    </Toast>
  );
}

function CopyToastButton(props: { text: string; label: string }) {
  const { t } = useTranslation();
  const setNotice = useAppStore((state) => state.setNotice);
  const [copied, setCopied] = useState(false);

  async function copy(event: MouseEvent<HTMLButtonElement>): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    const text = props.text.trim();
    if (!text) {
      return;
    }
    const writeText = navigator.clipboard?.writeText;
    if (!writeText) {
      console.warn("[notifications] 复制通知失败：当前环境没有剪贴板写入能力", {
        textLength: text.length
      });
      setNotice(t("notifications.copyFailed"));
      return;
    }
    try {
      await writeText.call(navigator.clipboard, text);
      console.info("[notifications] 已复制通知内容", { textLength: text.length });
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn("[notifications] 复制通知失败", {
        textLength: text.length,
        error: message
      });
      setNotice(t("notifications.copyFailed"));
    }
  }

  return (
    <button
      type="button"
      aria-label={copied ? t("notifications.copySuccess") : props.label}
      title={copied ? t("notifications.copySuccess") : props.label}
      onClick={(event) => void copy(event)}
      className="flex size-6 flex-none items-center justify-center rounded-xs text-muted-foreground transition-colors hover:bg-canvas-soft-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {copied ? <CheckMediumIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
    </button>
  );
}

function ToastCloseButton(props: { title?: string }) {
  const { t } = useTranslation();
  return (
    <ToastClose
      title={props.title ?? t("notifications.dismiss")}
      onClick={(event) => event.stopPropagation()}
      className="flex size-6 flex-none items-center justify-center rounded-xs text-muted-foreground transition-colors hover:bg-canvas-soft-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <XMarkIcon className="size-3.5" />
    </ToastClose>
  );
}

function toastTextForCopy(toast: NotificationToast): string {
  return [toast.title, toast.description].filter(Boolean).join("\n");
}
