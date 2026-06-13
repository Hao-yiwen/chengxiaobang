export interface SystemNotificationInput {
  title: string;
  body?: string;
}

export async function showSystemNotification(input: SystemNotificationInput): Promise<boolean> {
  const NotificationCtor = window.Notification;
  if (!NotificationCtor) {
    console.info("[notifications] 当前环境不支持系统通知，使用应用内提示", {
      title: input.title
    });
    return false;
  }

  let permission = NotificationCtor.permission;
  if (permission === "default") {
    console.info("[notifications] 首次需要系统通知，申请通知权限", { title: input.title });
    try {
      permission = await NotificationCtor.requestPermission();
      console.info("[notifications] 通知权限申请完成", { permission });
    } catch (error) {
      console.warn("[notifications] 通知权限申请失败，使用应用内提示", {
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }

  if (permission !== "granted") {
    console.info("[notifications] 通知权限未授权，使用应用内提示", { permission });
    return false;
  }

  try {
    new NotificationCtor(input.title, input.body ? { body: input.body } : undefined);
    console.info("[notifications] 已发送系统通知", { title: input.title });
    return true;
  } catch (error) {
    console.warn("[notifications] 系统通知发送失败，使用应用内提示", {
      title: input.title,
      error: error instanceof Error ? error.message : String(error)
    });
    return false;
  }
}
