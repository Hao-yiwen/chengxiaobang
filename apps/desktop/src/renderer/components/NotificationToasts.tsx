import {
  CheckCircleIcon,
  InfoCircleIcon,
  WarningCircleIcon,
  XCircleIcon,
  XMarkIcon
} from "@/assets/file-type-icons";
import { type ComponentType } from "react";
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

  return (
    <Toast
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
      <ToastCloseButton title={t("notifications.dismiss")} />
    </Toast>
  );
}

function ToastCloseButton(props: { title?: string }) {
  const { t } = useTranslation();
  return (
    <ToastClose
      title={props.title ?? t("notifications.dismiss")}
      className="flex size-6 flex-none items-center justify-center rounded-xs text-muted-foreground transition-colors hover:bg-canvas-soft-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <XMarkIcon className="size-3.5" />
    </ToastClose>
  );
}
