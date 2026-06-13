import { createId } from "@chengxiaobang/shared";
import i18n from "../../i18n";
import type { AppState, NotificationToast, ScheduledTaskFinishedEvent } from "../types";

export function addNotificationToast(
  state: AppState,
  toast: Omit<NotificationToast, "id" | "createdAt">
): Pick<AppState, "notificationToasts"> {
  const item: NotificationToast = {
    ...toast,
    id: createId("toast"),
    createdAt: Date.now()
  };
  return {
    notificationToasts: [...state.notificationToasts, item].slice(-4)
  };
}

export function scheduledTaskToastKind(
  status: ScheduledTaskFinishedEvent["status"]
): NotificationToast["kind"] {
  if (status === "completed") {
    return "success";
  }
  return status === "aborted" ? "warning" : "error";
}

export function scheduledTaskFinishedTitle(event: ScheduledTaskFinishedEvent): string {
  if (event.status === "completed") {
    return i18n.t("notifications.scheduledTask.completedTitle", { name: event.name });
  }
  if (event.status === "aborted") {
    return i18n.t("notifications.scheduledTask.abortedTitle", { name: event.name });
  }
  return i18n.t("notifications.scheduledTask.failedTitle", { name: event.name });
}

export function scheduledTaskFinishedDescription(event: ScheduledTaskFinishedEvent): string {
  if (event.error) {
    return i18n.t("notifications.scheduledTask.errorDetail", {
      error: truncateNotificationText(event.error)
    });
  }
  return i18n.t("notifications.scheduledTask.savedToSession");
}

export function truncateNotificationText(text: string): string {
  return text.length > 160 ? `${text.slice(0, 157)}...` : text;
}
